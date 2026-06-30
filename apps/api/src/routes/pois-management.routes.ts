import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { env } from '../config/env';
import { z } from 'zod';
import { COLLECTIONS } from '../config/collections.js';

const ManualPOISchema = z.object({
  nom: z.string().min(1),
  url_source: z.string().optional(),
});

const ReusePoisSchema = z.object({
  sourceGuideId: z.string().min(1),
  includeMatching: z.boolean().optional().default(true),
});

function normalizeGuideSiteUrl(guide: any): string | null {
  const siteUrl = guide?.wpConfig?.siteUrl;
  if (!siteUrl || typeof siteUrl !== 'string') return null;
  try {
    const url = new URL(siteUrl);
    return `${url.protocol}//${url.hostname.replace(/^www\./, '').toLowerCase()}`;
  } catch {
    return siteUrl.trim().replace(/\/$/, '').replace(/^https?:\/\/www\./i, '').toLowerCase() || null;
  }
}

function canReuseClusterMatching(targetGuide: any, sourceGuide: any): boolean {
  const targetDestination = targetGuide?.destination_rl_id;
  const sourceDestination = sourceGuide?.destination_rl_id;
  return !targetDestination || !sourceDestination || targetDestination === sourceDestination;
}

function copyClusterAssignmentsToPois(sourcePois: any[], sourceAssignment: any | null): any[] {
  if (!sourceAssignment) return sourcePois.map((poi: any) => ({ ...poi }));

  const clusterNames = new Map<string, string>();
  for (const cluster of sourceAssignment.clusters_metadata || []) {
    if (cluster.cluster_id) clusterNames.set(cluster.cluster_id, cluster.cluster_name);
  }

  const assignedByPoiId = new Map<string, any>();
  const clusters = sourceAssignment.assignment?.clusters || sourceAssignment.clusters || {};
  for (const [clusterId, items] of Object.entries(clusters)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const poiId = item?.poi?.poi_id || item?.poi_id;
      if (!poiId) continue;
      assignedByPoiId.set(poiId, {
        ...item,
        cluster_id: clusterId,
        cluster_name: item?.poi?.cluster_name || item?.cluster_name || clusterNames.get(clusterId),
      });
    }
  }

  const unassignedItems = sourceAssignment.assignment?.unassigned || sourceAssignment.unassigned || [];
  if (Array.isArray(unassignedItems)) {
    for (const item of unassignedItems) {
      const poiId = item?.poi?.poi_id || item?.poi_id;
      if (!poiId || assignedByPoiId.has(poiId)) continue;
      assignedByPoiId.set(poiId, { ...item, cluster_id: null, cluster_name: null });
    }
  }

  return sourcePois.map((poi: any) => {
    const assignment = assignedByPoiId.get(poi.poi_id);
    if (!assignment) return { ...poi };

    const suggestion = assignment.suggested_match;
    return {
      ...poi,
      cluster_id: assignment.cluster_id || null,
      cluster_name: assignment.cluster_name || undefined,
      place_instance_id: assignment.place_instance_id,
      matched_automatically: assignment.matched_automatically ?? poi.matched_automatically,
      confidence: suggestion?.confidence || poi.confidence,
      score: suggestion?.score ?? poi.score,
      validated: poi.validated,
    };
  });
}

export default async function poisManagementRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;

  // ─── Helper proxy vers poi-service ──────────────────────────────────────

  async function proxyToPoiService(request: any, reply: any, targetPath: string, method?: string, bodyOverride?: unknown) {
    const serviceUrl = env.POI_SERVICE_URL;
    if (!serviceUrl) {
      return reply.status(503).send({ error: 'POI service non disponible', message: 'POI_SERVICE_URL doit être configuré.' });
    }
    const targetUrl = `${serviceUrl.replace(/\/$/, '')}/api/v1${targetPath}`;
    const reqMethod = method || request.method;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (env.POI_SERVICE_API_KEY) headers['X-Api-Key'] = env.POI_SERVICE_API_KEY;
      if (request.headers.authorization) headers['Authorization'] = request.headers.authorization as string;
      if (request.headers.cookie) headers['Cookie'] = request.headers.cookie as string;
      const fetchOptions: RequestInit = { method: reqMethod, headers };
      const effectiveBody = bodyOverride ?? request.body;
      if (reqMethod !== 'GET' && reqMethod !== 'HEAD' && effectiveBody) {
        fetchOptions.body = JSON.stringify(effectiveBody);
      }
      const res = await fetch(targetUrl, fetchOptions);
      const data = await res.json().catch(() => ({ error: 'Réponse non-JSON du microservice' }));
      return reply.status(res.status).send(data);
    } catch (error: any) {
      fastify.log.error({ error: error.message, targetUrl }, 'Proxy poi-service error');
      return reply.status(502).send({ error: 'Erreur de communication avec le POI service', details: error.message });
    }
  }

  /**
   * POST /guides/:guideId/pois/generate
   * Enrichit le body avec les données du guide avant de proxifier vers le poi-service,
   * afin que le poi-service n'ait pas besoin d'accéder à la base redactor_guide.
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/generate',
    async (request, reply) => {
      const { guideId } = request.params;
      const guide = await db.collection(COLLECTIONS.guides).findOne(
        { _id: new ObjectId(guideId) },
        { projection: { wp_site_id: 1, destination: 1, destinations: 1, selected_categories: 1 } }
      );
      if (!guide) return reply.status(404).send({ error: 'Guide non trouvé' });

      const bodyOverride = {
        wp_site_id: guide.wp_site_id,
        destination: guide.destination ?? guide.destinations?.[0] ?? '',
        selected_categories: guide.selected_categories ?? [],
      };
      return proxyToPoiService(request, reply, `/guides/${guideId}/pois/generate`, undefined, bodyOverride);
    }
  );

  /**
   * GET /guides/:guideId/pois/latest-job
   * Proxy → poi-service
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/latest-job',
    (request, reply) => proxyToPoiService(request, reply, `/guides/${(request.params as any).guideId}/pois/latest-job`, 'GET')
  );

  /**
   * GET /guides/:guideId/pois/job-status/:jobId
   * Proxy → poi-service
   */
  fastify.get<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/job-status/:jobId',
    (request, reply) => proxyToPoiService(request, reply, `/guides/${(request.params as any).guideId}/pois/job-status/${(request.params as any).jobId}`, 'GET')
  );

  /**
   * POST /guides/:guideId/pois/jobs/:jobId/deduplicate
   * Proxy → poi-service
   */
  fastify.post<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/jobs/:jobId/deduplicate',
    (request, reply) => proxyToPoiService(request, reply, `/guides/${(request.params as any).guideId}/pois/jobs/${(request.params as any).jobId}/deduplicate`)
  );

  /**
   * GET /guides/:guideId/pois/reuse-candidates
   * Liste les guides ayant le même site source et une sélection POI exploitable.
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/reuse-candidates',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        if (!ObjectId.isValid(guideId)) return reply.code(400).send({ error: 'guideId invalide' });

        const targetGuide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        if (!targetGuide) return reply.code(404).send({ error: 'Guide cible non trouvé' });

        const targetSiteUrl = normalizeGuideSiteUrl(targetGuide);
        if (!targetSiteUrl) return reply.send({ candidates: [], siteUrl: null });

        const guides = await db.collection(COLLECTIONS.guides)
          .find(
            { _id: { $ne: new ObjectId(guideId) } },
            { projection: { name: 1, slug: 1, year: 1, version: 1, wpConfig: 1, destination_rl_id: 1, updatedAt: 1 } }
          )
          .toArray();

        const sameSiteGuides = guides.filter((guide) => normalizeGuideSiteUrl(guide) === targetSiteUrl);
        if (sameSiteGuides.length === 0) return reply.send({ candidates: [], siteUrl: targetSiteUrl });

        const sourceGuideIds = sameSiteGuides.map((guide) => guide._id.toString());
        const [selections, assignments] = await Promise.all([
          db.collection(COLLECTIONS.pois_selection).find({ guide_id: { $in: sourceGuideIds } }).toArray(),
          db.collection(COLLECTIONS.cluster_assignments).find({ guide_id: { $in: sourceGuideIds } }).toArray(),
        ]);

        const selectionsByGuide = new Map(selections.map((selection: any) => [selection.guide_id, selection]));
        const assignmentsByGuide = new Map(assignments.map((assignment: any) => [assignment.guide_id, assignment]));

        const candidates = sameSiteGuides
          .map((guide: any) => {
            const id = guide._id.toString();
            const selection = selectionsByGuide.get(id);
            const assignment = assignmentsByGuide.get(id);
            const matchingReusable = canReuseClusterMatching(targetGuide, guide);

            return {
              guideId: id,
              name: guide.name,
              slug: guide.slug,
              year: guide.year,
              version: guide.version,
              poiCount: selection?.pois?.length || 0,
              hasMatching: Boolean(assignment),
              canCopyMatching: Boolean(matchingReusable && assignment),
              updatedAt: selection?.updated_at || guide.updatedAt || null,
            };
          })
          .filter((candidate) => candidate.poiCount > 0)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

        return reply.send({ candidates, siteUrl: targetSiteUrl });
      } catch (error: any) {
        console.error('❌ [POIs Reuse Candidates] Erreur:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/reuse-from
   * Copie la sélection POI depuis un guide du même site source.
   */
  fastify.post<{ Params: { guideId: string }; Body: { sourceGuideId: string; includeMatching?: boolean } }>(
    '/guides/:guideId/pois/reuse-from',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        if (!ObjectId.isValid(guideId)) return reply.code(400).send({ error: 'guideId invalide' });

        const { sourceGuideId, includeMatching } = ReusePoisSchema.parse(request.body);
        if (!ObjectId.isValid(sourceGuideId)) return reply.code(400).send({ error: 'sourceGuideId invalide' });
        if (sourceGuideId === guideId) return reply.code(400).send({ error: 'Le guide source doit être différent du guide cible' });

        const [targetGuide, sourceGuide] = await Promise.all([
          db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) }),
          db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(sourceGuideId) }),
        ]);

        if (!targetGuide) return reply.code(404).send({ error: 'Guide cible non trouvé' });
        if (!sourceGuide) return reply.code(404).send({ error: 'Guide source non trouvé' });

        const targetSiteUrl = normalizeGuideSiteUrl(targetGuide);
        const sourceSiteUrl = normalizeGuideSiteUrl(sourceGuide);
        if (!targetSiteUrl || !sourceSiteUrl || targetSiteUrl !== sourceSiteUrl) {
          return reply.code(400).send({
            error: 'Site source différent',
            message: 'La réutilisation des POI est autorisée uniquement entre guides ayant le même site source.',
          });
        }

        const sourceSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: sourceGuideId });
        const sourcePois = sourceSelection?.pois || [];
        if (sourcePois.length === 0) {
          return reply.code(404).send({ error: 'Aucune sélection POI trouvée sur le guide source' });
        }

        const now = new Date();
        let matchingCopied = false;
        let matchingSkippedReason: string | undefined;
        let sourceAssignment: any | null = null;

        if (includeMatching) {
          const matchingReusable = canReuseClusterMatching(targetGuide, sourceGuide);

          if (!matchingReusable) {
            matchingSkippedReason = 'destination_rl_id différent ou manquant';
          } else {
            sourceAssignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: sourceGuideId });
            if (!sourceAssignment) {
              matchingSkippedReason = 'aucun matching trouvé sur le guide source';
            } else {
              const { _id, ...assignmentCopy } = sourceAssignment;
              await db.collection(COLLECTIONS.cluster_assignments).updateOne(
                { guide_id: guideId },
                {
                  $set: {
                    ...assignmentCopy,
                    guide_id: guideId,
                    copied_from_guide_id: sourceGuideId,
                    copied_from_guide_name: sourceGuide.name,
                    updated_at: now,
                  },
                  $setOnInsert: { created_at: now },
                },
                { upsert: true }
              );
              matchingCopied = true;
            }
          }
        }

        const copiedPois = copyClusterAssignmentsToPois(sourcePois, sourceAssignment);
        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              pois: copiedPois,
              copied_from_guide_id: sourceGuideId,
              copied_from_guide_name: sourceGuide.name,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          { upsert: true }
        );

        console.log(`♻️ [POIs Reuse] ${copiedPois.length} POI(s) copiés de ${sourceGuideId} vers ${guideId}`);
        return reply.send({
          success: true,
          count: copiedPois.length,
          matchingCopied,
          matchingSkippedReason,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Données invalides', details: error.errors });
        }
        console.error('❌ [POIs Reuse] Erreur:', error);
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

        const job = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({ _id: new ObjectId(jobId) });
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
        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          {
            $set: { guide_id: guideId, pois, updated_at: now },
            $setOnInsert: { created_at: now },
          },
          { upsert: true }
        );

        await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
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
   * PATCH /guides/:guideId/pois/jobs/reset-dedup
   * Annule le dédoublonnage du job le plus récent et le repasse en extraction_complete,
   * sans toucher aux POIs extraits (preview_pois / preview_batches).
   */
  fastify.patch<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/jobs/reset-dedup',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const result = await db.collection(COLLECTIONS.pois_generation_jobs).findOneAndUpdate(
          {
            guide_id: guideId,
            status: { $in: ['deduplicating', 'dedup_complete', 'extraction_complete'] },
          },
          {
            $set: { status: 'extraction_complete', updated_at: new Date() },
            $unset: { deduplicated_pois: '', dedup_count: '', dedup_algo_removed: '', dedup_llm_removed: '', error_dedup: '' },
          },
          { sort: { created_at: -1 }, returnDocument: 'after' }
        );

        if (!result) {
          return reply.code(404).send({ error: 'Aucun job éligible trouvé' });
        }

        console.log(`🔄 [POIs] Dédoublonnage annulé pour job ${result._id} (guide ${guideId}) → extraction_complete`);
        return reply.send({ success: true, jobId: result._id.toString(), raw_count: (result.preview_pois || []).length });
      } catch (error: any) {
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
        const cancelResult = await db.collection(COLLECTIONS.pois_generation_jobs).updateMany(
          { guide_id: guideId, status: { $in: ['pending', 'processing', 'deduplicating'] } },
          { $set: { status: 'cancelled', updated_at: new Date() } }
        );

        // Supprimer les jobs terminés ou échoués (historique)
        const deleteResult = await db.collection(COLLECTIONS.pois_generation_jobs).deleteMany(
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
        const selection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        
        if (!selection) {
          return reply.send({ pois: [] });
        }

        // Dédupliquer par poi_id côté lecture : en cas de doublon, garder le nom le plus long
        const rawPois: any[] = selection.pois || [];
        const seen = new Map<string, any>();
        for (const poi of rawPois) {
          if (!seen.has(poi.poi_id) || poi.nom.length > seen.get(poi.poi_id).nom.length) {
            seen.set(poi.poi_id, poi);
          }
        }
        const pois = Array.from(seen.values());
        if (pois.length < rawPois.length) {
          console.warn(`⚠️ [POIs] ${rawPois.length - pois.length} doublon(s) poi_id détecté(s) et filtrés pour guide ${guideId}`);
        }

        return reply.send({
          pois,
          count: pois.length,
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

        const newPOI: Record<string, any> = {
          poi_id,
          nom: data.nom,
          source: 'manual' as const,
        };

        if (data.url_source) {
          newPOI.url_source = data.url_source;
        }

        // Ajouter à la collection
        const now = new Date();
        await db.collection(COLLECTIONS.pois_selection).updateOne(
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
        const result = await db.collection(COLLECTIONS.pois_selection).updateOne(
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
        const result = await db.collection(COLLECTIONS.pois_selection).updateOne(
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
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
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
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        
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
        await db.collection(COLLECTIONS.pois_selection).updateOne(
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

  /**
   * PATCH /guides/:guideId/pois/:poiId
   * Modifier les champs éditables d'un POI (nom, type, coordinates, article_source)
   */
  fastify.patch<{
    Params: { guideId: string; poiId: string };
    Body: {
      nom?: string;
      type?: string;
      coordinates?: { lat: number; lon: number } | null;
      article_source?: string;
      url_source?: string;
    };
  }>(
    '/guides/:guideId/pois/:poiId',
    async (request, reply) => {
      const { guideId, poiId } = request.params;
      const { nom, type, coordinates, article_source, url_source } = request.body;

      try {
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (!poisSelection) return reply.code(404).send({ error: 'Sélection introuvable' });

        const poiIndex = poisSelection.pois.findIndex((p: any) => p.poi_id === poiId);
        if (poiIndex === -1) return reply.code(404).send({ error: 'POI introuvable' });

        const patch: Record<string, any> = { updated_at: new Date() };
        if (nom !== undefined) patch.nom = nom.trim();
        if (type !== undefined) patch.type = type;
        if (coordinates !== undefined) patch.coordinates = coordinates;
        if (article_source !== undefined) patch.article_source = article_source;
        if (url_source !== undefined) patch.url_source = url_source;

        poisSelection.pois[poiIndex] = { ...poisSelection.pois[poiIndex], ...patch };

        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          { $set: { pois: poisSelection.pois, updated_at: new Date() } }
        );

        console.log(`✏️ [POI] Mise à jour ${poiId}: ${JSON.stringify(patch)}`);
        return reply.send({ success: true, poi: poisSelection.pois[poiIndex] });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * PATCH /guides/:guideId/pois/:poiId/validate
   * Valide manuellement l'affectation d'un POI à son cluster (score → 100 %, validated → true)
   */
  fastify.patch<{ Params: { guideId: string; poiId: string } }>(
    '/guides/:guideId/pois/:poiId/validate',
    async (request, reply) => {
      const { guideId, poiId } = request.params;

      try {
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (!poisSelection) return reply.code(404).send({ error: 'Sélection introuvable' });

        const poiIndex = poisSelection.pois.findIndex((p: any) => p.poi_id === poiId);
        if (poiIndex === -1) return reply.code(404).send({ error: 'POI introuvable' });

        poisSelection.pois[poiIndex] = {
          ...poisSelection.pois[poiIndex],
          validated: true,
          confidence: 'high',
          score: 1.0,
          matched_automatically: false,
          updated_at: new Date(),
        };

        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          { $set: { pois: poisSelection.pois, updated_at: new Date() } }
        );

        return reply.send({ success: true, poi: poisSelection.pois[poiIndex] });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
