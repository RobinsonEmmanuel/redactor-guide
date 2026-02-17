import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { OpenAIService } from '../services/openai.service';
import { GeocodingService } from '../services/geocoding.service';
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
  const geocodingService = new GeocodingService();

  /**
   * POST /guides/:guideId/pois/generate
   * Génère les POIs depuis les articles WordPress via IA
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

        const destination = guide.destinations?.[0] || guide.destination || 'Destination inconnue';

        // 2. Vérifier qu'il y a des articles
        const articlesCount = await db.collection('articles_raw').countDocuments({ 
          site_id: guide.slug
        });

        if (articlesCount === 0) {
          return reply.code(400).send({ 
            error: 'Aucun article trouvé', 
            message: 'Récupérez d\'abord les articles WordPress' 
          });
        }

        console.log(`📚 ${articlesCount} articles disponibles pour génération POIs`);

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
                'Upstash-Retries': '2',
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

        // 2. Extraire le token JWT de l'utilisateur depuis les cookies
        const userToken = request.cookies?.accessToken;
        
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

        // 3. Transformer et grouper par cluster
        const poisByCluster: Record<string, any[]> = {};
        const dataArray = Array.isArray(data) ? data : (data.drafts || []);

        for (const item of dataArray) {
          const clusterId = item.cluster_id || 'non_affecte';
          const clusterName = item.cluster_name || 'Non affecté';

          if (!poisByCluster[clusterId]) {
            poisByCluster[clusterId] = [];
          }

          poisByCluster[clusterId].push({
            region_lovers_id: item._id,
            nom: item.place_name || item.nom,
            type: item.place_type || 'autre',
            cluster_id: clusterId,
            cluster_name: clusterName,
            coordinates: item.coordinates,
          });
        }

        // 4. Trier alphabétiquement dans chaque cluster
        for (const clusterId in poisByCluster) {
          poisByCluster[clusterId].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        }

        console.log(`📚 [Library] ${dataArray.length} POI(s) récupéré(s) depuis Region Lovers`);

        return reply.send({
          clusters: poisByCluster,
          total: dataArray.length,
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
}
