import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { env } from '../config/env';
import { z } from 'zod';

const ManualPOISchema = z.object({
  nom: z.string().min(1),
  type: z.string(),
  coordinates: z.object({
    lat: z.number(),
    lon: z.number(),
  }).optional(),
});

export default async function poisManagementRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;

  /**
   * POST /guides/:guideId/pois/generate
   * Génère les POIs depuis les articles WordPress via IA (asynchrone via QStash)
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/generate',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`🔍 [POIs] Génération POIs pour guide ${guideId}`);

        // 1. Vérifier que le guide existe
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        // 2. Vérifier qu'il y a des articles filtrés par destination
        const destination: string = guide.destination ?? guide.destinations?.[0] ?? '';
        const destinationFilter = destination
          ? { categories: { $regex: destination, $options: 'i' } }
          : {};

        const articlesCount = await db.collection('articles_raw').countDocuments(destinationFilter);

        if (articlesCount === 0) {
          return reply.code(400).send({ 
            error: `Aucun article trouvé pour la destination "${destination}"`, 
            message: 'Récupérez d\'abord les articles WordPress depuis l\'onglet Articles' 
          });
        }

        console.log(`📚 ${articlesCount} articles disponibles pour "${destination}"`);

        // 3. Créer un job de génération
        const jobId = new ObjectId();
        await db.collection('pois_generation_jobs').insertOne({
          _id: jobId,
          guide_id: guideId,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        });

        // 4. Envoyer vers QStash (worker asynchrone)
        const qstashToken = env.QSTASH_TOKEN;
        let workerUrl = env.INGEST_WORKER_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.API_URL;
        
        // Ajouter https:// si absent
        if (workerUrl && !workerUrl.startsWith('http')) {
          workerUrl = `https://${workerUrl}`;
        }

        console.log(`🔧 [Config] QSTASH_TOKEN: ${qstashToken ? '✅ présent' : '❌ manquant'}`);
        console.log(`🔧 [Config] workerUrl: ${workerUrl || '❌ manquant'}`);

        if (qstashToken && workerUrl) {
          // Worker asynchrone via QStash
          const fullWorkerUrl = `${workerUrl}/api/v1/workers/generate-pois`;
          
          console.log(`📤 [QStash] Envoi job vers ${fullWorkerUrl}`);
          
          try {
            const qstashResponse = await fetch(`https://qstash.upstash.io/v2/publish/${fullWorkerUrl}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${qstashToken}`,
                'Content-Type': 'application/json',
                'Upstash-Retries': '0',
              },
              body: JSON.stringify({ guideId, jobId: jobId.toString() }),
            });

            if (!qstashResponse.ok) {
              const qstashError = await qstashResponse.text();
              console.error('❌ [QStash] Erreur:', qstashError);
              
              // Marquer le job comme failed
              await db.collection('pois_generation_jobs').updateOne(
                { _id: jobId },
                { 
                  $set: { 
                    status: 'failed',
                    error: `Erreur QStash: ${qstashError}`,
                    updated_at: new Date() 
                  } 
                }
              );

              throw new Error(`QStash error: ${qstashError}`);
            }

            console.log(`✅ [QStash] Job envoyé avec succès`);

            return reply.send({ 
              success: true, 
              jobId: jobId.toString(),
              message: 'Génération des POIs lancée en arrière-plan'
            });

          } catch (qstashErr: any) {
            console.error('❌ [QStash] Exception:', qstashErr);
            throw qstashErr;
          }
        } else {
          // Fallback : impossible sans QStash
          console.error('⚠️ QStash non configuré - impossible de générer les POIs');
          
          await db.collection('pois_generation_jobs').deleteOne({ _id: jobId });
          
          return reply.code(503).send({
            error: 'QStash non configuré',
            message: 'La génération asynchrone n\'est pas disponible. Configurez QSTASH_TOKEN.',
          });
        }

      } catch (error: any) {
        console.error('❌ [POIs] Erreur génération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la génération des POIs',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois/latest-job
   * Retourne le job le plus récent nécessitant une action (extraction_complete, deduplicating, dedup_complete)
   * Permet de reprendre le workflow après un rafraîchissement de page.
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/latest-job',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const job = await db.collection('pois_generation_jobs').findOne(
          {
            guide_id: guideId,
            status: { $in: ['extraction_complete', 'deduplicating', 'dedup_complete'] },
          },
          { sort: { created_at: -1 } }
        );

        if (!job) {
          return reply.send({ job: null });
        }

        return reply.send({
          job: {
            jobId: job._id.toString(),
            status: job.status,
            raw_count: job.raw_count || job.preview_pois?.length || 0,
            preview_pois: job.preview_pois || [],
            preview_batches: job.preview_batches || [],
            classification_log: job.classification_log || [],
            mono_count: job.mono_count ?? null,
            multi_count: job.multi_count ?? null,
            excluded_count: job.excluded_count ?? null,
            deduplicated_pois: job.deduplicated_pois || [],
            created_at: job.created_at,
            updated_at: job.updated_at,
          },
        });
      } catch (error: any) {
        console.error('❌ [POIs] Erreur latest-job:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois/job-status/:jobId
   * Vérifie le statut d'un job de génération POIs
   */
  fastify.get<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/job-status/:jobId',
    async (request, reply) => {
      const { jobId } = request.params;

      try {
        if (!ObjectId.isValid(jobId)) {
          return reply.code(400).send({ error: 'Job ID invalide' });
        }

        const job = await db.collection('pois_generation_jobs').findOne({
          _id: new ObjectId(jobId),
        });

        if (!job) {
          return reply.code(404).send({ error: 'Job non trouvé' });
        }

        return reply.send({
          status: job.status,
          count: job.count || 0,
          raw_count: job.raw_count || 0,
          progress: job.progress || null,
          preview_pois: job.preview_pois || [],
          preview_batches: job.preview_batches || [],
          classification_log: job.classification_log || [],
          mono_count: job.mono_count ?? null,
          multi_count: job.multi_count ?? null,
          excluded_count: job.excluded_count ?? null,
          deduplicated_pois: job.deduplicated_pois || [],
          error: job.error || null,
          created_at: job.created_at,
          updated_at: job.updated_at,
        });
      } catch (error: any) {
        console.error('❌ [POIs] Erreur statut job:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/jobs/:jobId/deduplicate
   * Déclenche le dédoublonnage de manière asynchrone via QStash.
   * Répond immédiatement (pas de timeout) — le frontend poll le statut du job.
   */
  fastify.post<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/jobs/:jobId/deduplicate',
    async (request, reply) => {
      const { guideId, jobId } = request.params;

      try {
        if (!ObjectId.isValid(jobId)) return reply.code(400).send({ error: 'Job ID invalide' });

        const job = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
        if (!job) return reply.code(404).send({ error: 'Job non trouvé' });

        const rawPois: any[] = job.preview_pois || [];
        if (rawPois.length === 0) return reply.code(400).send({ error: 'Aucun POI extrait à dédoublonner' });

        // Marquer le job comme en cours de déduplication
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'deduplicating', updated_at: new Date() } }
        );

        // Déclencher le worker via QStash (réponse immédiate, pas de timeout)
        const qstashToken = env.QSTASH_TOKEN;
        let workerUrl = env.INGEST_WORKER_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.API_URL;
        if (workerUrl && !workerUrl.startsWith('http')) workerUrl = `https://${workerUrl}`;

        if (!qstashToken || !workerUrl) {
          return reply.code(503).send({ error: 'QStash non configuré' });
        }

        const fullWorkerUrl = `${workerUrl}/api/v1/workers/deduplicate-pois`;
        const qstashResponse = await fetch(`https://qstash.upstash.io/v2/publish/${fullWorkerUrl}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Retries': '0',
          },
          body: JSON.stringify({ guideId, jobId }),
        });

        if (!qstashResponse.ok) {
          const err = await qstashResponse.text();
          await db.collection('pois_generation_jobs').updateOne(
            { _id: new ObjectId(jobId) },
            { $set: { status: 'extraction_complete', updated_at: new Date() } }
          ).catch(() => {});
          return reply.code(500).send({ error: `QStash error: ${err}` });
        }

        console.log(`✅ [DEDUP] Job ${jobId} envoyé à QStash pour dédoublonnage`);
        return reply.send({ success: true, status: 'deduplicating', raw_count: rawPois.length });

      } catch (error: any) {
        console.error('❌ [DEDUP] Erreur:', error);
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'extraction_complete', updated_at: new Date() } }
        ).catch(() => {});
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/confirm
   * Remplace pois_selection par les POIs dédoublonnés du job (après confirmation utilisateur).
   */
  fastify.post<{ Params: { guideId: string }; Body: { jobId: string; validatedPois?: any[] } }>(
    '/guides/:guideId/pois/confirm',
    async (request, reply) => {
      const { guideId } = request.params;
      const { jobId, validatedPois } = request.body as { jobId: string; validatedPois?: any[] };

      try {
        if (!ObjectId.isValid(jobId)) return reply.code(400).send({ error: 'Job ID invalide' });

        const job = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
        if (!job) return reply.code(404).send({ error: 'Job non trouvé' });

        // Si une liste validée est fournie par l'UI, on l'utilise directement
        const rawDedupPois: any[] = validatedPois?.length
          ? validatedPois
          : (job.deduplicated_pois || job.preview_pois || []);
        if (rawDedupPois.length === 0) return reply.code(400).send({ error: 'Aucun POI à sauvegarder' });

        const pois = rawDedupPois.map((poi: any) => ({
          poi_id: poi.poi_id,
          nom: poi.nom,
          type: poi.type,
          source: 'article',
          article_source: poi.article_source,
          url_source: poi.url_source || '',
          mentions: poi.mentions || 'secondaire',
          raison_selection: poi.raison_selection,
          autres_articles_mentions: poi.autres_articles_mentions || [],
        }));

        const now = new Date();
        await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $set: { guide_id: guideId, pois, updated_at: now },
            $setOnInsert: { created_at: now },
          },
          { upsert: true }
        );

        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'completed', count: pois.length, updated_at: new Date() } }
        );

        console.log(`✅ [CONFIRM] ${pois.length} POIs sauvegardés dans pois_selection pour guide ${guideId}`);
        return reply.send({ success: true, count: pois.length });

      } catch (error: any) {
        console.error('❌ [CONFIRM] Erreur:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/pois/jobs
   * Supprime tous les jobs de génération POIs pour repartir sur une base propre
   */
  fastify.delete<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/jobs',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        // Marquer les jobs en cours comme "cancelled" pour que le worker s'arrête proprement
        const cancelResult = await db.collection('pois_generation_jobs').updateMany(
          { guide_id: guideId, status: { $in: ['pending', 'processing', 'deduplicating'] } },
          { $set: { status: 'cancelled', updated_at: new Date() } }
        );

        // Supprimer les jobs terminés ou échoués (historique)
        const deleteResult = await db.collection('pois_generation_jobs').deleteMany(
          { guide_id: guideId, status: { $in: ['completed', 'failed', 'cancelled', 'extraction_complete', 'dedup_complete'] } }
        );

        const total = cancelResult.modifiedCount + deleteResult.deletedCount;
        console.log(`🧹 [POIs] ${cancelResult.modifiedCount} job(s) annulé(s), ${deleteResult.deletedCount} supprimé(s) pour guide ${guideId}`);
        return reply.send({ cancelled: cancelResult.modifiedCount, deleted: deleteResult.deletedCount, total });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois
   * Récupère la liste des POIs sélectionnés pour un guide
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const selection = await db.collection('pois_selection').findOne({ guide_id: guideId });
        
        if (!selection) {
          return reply.send({ pois: [] });
        }

        return reply.send({
          pois: selection.pois || [],
          count: selection.pois?.length || 0,
        });
      } catch (error: any) {
        console.error('❌ [POIs] Erreur récupération:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/add-manual
   * Ajoute un POI créé manuellement
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/add-manual',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const data = ManualPOISchema.parse(request.body);
        
        // Générer un ID unique
        const poi_id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newPOI = {
          poi_id,
          nom: data.nom,
          type: data.type,
          source: 'manual' as const,
          coordinates: data.coordinates,
        };

        // Ajouter à la collection
        const now = new Date();
        await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $push: { pois: newPOI } as any,
            $set: { updated_at: now },
            $setOnInsert: { guide_id: guideId, created_at: now },
          },
          { upsert: true }
        );

        console.log(`✅ [POIs] POI manuel ajouté: ${data.nom}`);

        return reply.send({
          success: true,
          poi: newPOI,
        });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur ajout manuel:', error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/add-from-library
   * Ajoute un POI depuis la bibliothèque Region Lovers
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/add-from-library',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const { region_lovers_id, nom, type, coordinates, cluster_id } = request.body as any;

        if (!region_lovers_id || !nom) {
          return reply.code(400).send({ error: 'region_lovers_id et nom requis' });
        }

        const poi_id = `library_${region_lovers_id}`;

        const newPOI = {
          poi_id,
          nom,
          type: type || 'autre',
          source: 'library' as const,
          region_lovers_id,
          cluster_id,
          coordinates,
        };

        // Ajouter à la collection (si pas déjà présent)
        const now = new Date();
        const result = await db.collection('pois_selection').updateOne(
          { 
            guide_id: guideId,
            'pois.region_lovers_id': { $ne: region_lovers_id },
          },
          {
            $push: { pois: newPOI } as any,
            $set: { updated_at: now },
            $setOnInsert: { guide_id: guideId, created_at: now },
          },
          { upsert: true }
        );

        if (result.matchedCount === 0 && result.upsertedCount === 0) {
          return reply.code(400).send({ error: 'Ce POI est déjà dans la sélection' });
        }

        console.log(`✅ [POIs] POI bibliothèque ajouté: ${nom}`);

        return reply.send({
          success: true,
          poi: newPOI,
        });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur ajout bibliothèque:', error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/pois/:poiId
   * Supprime un POI de la sélection
   */
  fastify.delete<{ Params: { guideId: string; poiId: string } }>(
    '/guides/:guideId/pois/:poiId',
    async (request, reply) => {
      const { guideId, poiId } = request.params;

      try {
        const result = await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $pull: { pois: { poi_id: poiId } } as any,
            $set: { updated_at: new Date() },
          }
        );

        if (result.matchedCount === 0) {
          return reply.code(404).send({ error: 'Sélection POIs non trouvée' });
        }

        console.log(`🗑️ [POIs] POI supprimé: ${poiId}`);

        return reply.send({ success: true });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur suppression:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/library
   * Récupère tous les POIs de la bibliothèque Region Lovers pour cette région
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/library',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        // 1. Récupérer le guide pour obtenir destination_rl_id
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        if (!guide.destination_rl_id) {
          return reply.code(400).send({ 
            error: 'destination_rl_id manquant',
            message: 'Configurez l\'ID Region Lovers dans les paramètres du guide' 
          });
        }

        // 2. Extraire le token JWT de l'utilisateur (cookies OU Authorization header)
        const userToken = 
          request.cookies?.accessToken || 
          request.headers.authorization?.replace('Bearer ', '');
        
        if (!userToken) {
          return reply.code(401).send({ 
            error: 'Non authentifié',
            message: 'Token JWT manquant. Veuillez vous reconnecter.' 
          });
        }

        // 3. Appeler l'API Region Lovers avec le token de l'utilisateur
        const regionId = guide.destination_rl_id;
        const rlApiUrl = env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';

        const response = await fetch(
          `${rlApiUrl}/place-instance-drafts/region/${regionId}`,
          {
            headers: {
              'Authorization': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Erreur API RL: ${response.status}`);
        }

        const data: any = await response.json();

        // 3. Parser la structure de l'API Region Lovers (comme dans le matching)
        const poisByCluster: Record<string, any[]> = {};
        
        let clustersArray: any[] = [];
        if (Array.isArray(data)) {
          clustersArray = data;
        } else if (data?.clusters && Array.isArray(data.clusters)) {
          clustersArray = data.clusters;
        } else if (data?.data && Array.isArray(data.data)) {
          clustersArray = data.data;
        }

        console.log(`📚 [Library] ${clustersArray.length} cluster(s) trouvé(s)`);

        // 4. Extraire les POIs de chaque cluster
        let totalPois = 0;
        for (const cluster of clustersArray) {
          const clusterId = cluster.id || cluster._id || cluster.cluster_id || 'non_affecte';
          const clusterName = cluster.name || cluster.cluster_name || 'Non affecté';
          const drafts = cluster.drafts || cluster.place_instances || [];

          if (drafts.length === 0) continue;

          poisByCluster[clusterId] = [];

          for (const draft of drafts) {
            // Extraire le VRAI nom depuis blocks > general_info > fields > name
            let realPlaceName = draft.place_name || draft.name || 'Sans nom';
            
            try {
              const generalInfoBlock = draft.blocks?.find((b: any) => b.block_id === 'general_info');
              const generalSection = generalInfoBlock?.sections?.find((s: any) => s.section_id === 'general_info_general');
              const nameField = generalSection?.fields?.find((f: any) => f.field_id === 'name');
              
              if (nameField?.value) {
                realPlaceName = nameField.value;
              }
            } catch (err) {
              console.warn('⚠️ Impossible d\'extraire le nom réel pour draft', draft._id);
            }

            poisByCluster[clusterId].push({
              region_lovers_id: draft._id || draft.id,
              nom: realPlaceName,
              type: draft.place_type || draft.type || 'autre',
              cluster_id: clusterId,
              cluster_name: clusterName,
              coordinates: draft.coordinates,
            });
            totalPois++;
          }

          // Trier alphabétiquement
          poisByCluster[clusterId].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        }

        console.log(`📚 [Library] ${totalPois} POI(s) récupéré(s) répartis dans ${Object.keys(poisByCluster).length} cluster(s)`);

        return reply.send({
          clusters: poisByCluster,
          total: totalPois,
        });

      } catch (error: any) {
        console.error('❌ [Library] Erreur récupération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la récupération de la bibliothèque',
          details: error.message,
        });
      }
    }
  );

  /**
   * PATCH /guides/:guideId/pois/:poiId/cluster
   * Réaffecter un POI à un cluster
   */
  fastify.patch<{
    Params: { guideId: string; poiId: string };
    Body: { cluster_id: string | null; cluster_name?: string };
  }>(
    '/guides/:guideId/pois/:poiId/cluster',
    async (request, reply) => {
      const { guideId, poiId } = request.params;
      const { cluster_id, cluster_name } = request.body;

      try {
        console.log(`🔄 [POI] Réaffectation POI ${poiId} → cluster ${cluster_id || 'unassigned'}`);

        // 1. Récupérer le document pois_selection
        const poisSelection = await db.collection('pois_selection').findOne({ guide_id: guideId });
        
        if (!poisSelection) {
          return reply.code(404).send({ error: 'Aucune sélection de POIs trouvée pour ce guide' });
        }

        // 2. Trouver et mettre à jour le POI
        const poiIndex = poisSelection.pois.findIndex((p: any) => p.poi_id === poiId);
        
        if (poiIndex === -1) {
          return reply.code(404).send({ error: 'POI non trouvé dans la sélection' });
        }

        // 3. Mettre à jour le POI avec le nouveau cluster
        const updatedPoi = {
          ...poisSelection.pois[poiIndex],
          cluster_id: cluster_id || null,
          cluster_name: cluster_name || null,
          matched_automatically: false, // C'est une réaffectation manuelle
          updated_at: new Date(),
        };

        poisSelection.pois[poiIndex] = updatedPoi;

        // 4. Sauvegarder dans MongoDB
        await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $set: {
              pois: poisSelection.pois,
              updated_at: new Date(),
            },
          }
        );

        console.log(`✅ [POI] POI ${poiId} réaffecté avec succès`);

        return reply.send({
          success: true,
          poi: updatedPoi,
        });

      } catch (error: any) {
        console.error('❌ [POI] Erreur réaffectation:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la réaffectation',
          details: error.message,
        });
      }
    }
  );
}
