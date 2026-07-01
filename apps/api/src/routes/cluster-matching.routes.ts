import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { COLLECTIONS } from '../config/collections.js';

/**
 * Routes de matching clusters.
 *
 * Proxy léger vers apps/poi-service.
 * Si POI_SERVICE_URL n'est pas configuré, répond 503.
 */
export default async function clusterMatchingRoutes(fastify: FastifyInstance) {
  const serviceUrl = env.POI_SERVICE_URL;
  const apiKey = env.POI_SERVICE_API_KEY;

  async function sendLocalMatchingIfAvailable(request: any, reply: any): Promise<boolean> {
    const guideId = request.params?.guideId;
    if (!guideId) return false;

    const db = request.server.container.db;
    const localMatching = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
    if (!localMatching) return false;

    const hasAssignment = Boolean(localMatching.assignment || localMatching.clusters || localMatching.unassigned);
    const hasClusters = Array.isArray(localMatching.clusters_metadata) && localMatching.clusters_metadata.length > 0;
    if (!hasAssignment && !hasClusters) return false;

    const assignment = localMatching.assignment || {
      clusters: localMatching.clusters || {},
      unassigned: localMatching.unassigned || [],
    };
    const clustersMetadata = [...(localMatching.clusters_metadata || [])];
    const knownClusterIds = new Set(clustersMetadata.map((cluster: any) => cluster.cluster_id));
    for (const [clusterId, items] of Object.entries(assignment.clusters || {})) {
      if (knownClusterIds.has(clusterId)) continue;
      const clusterPois = Array.isArray(items) ? items : [];
      const firstPoi = clusterPois[0]?.poi || clusterPois[0] || {};
      clustersMetadata.push({
        cluster_id: clusterId,
        cluster_name: firstPoi.cluster_name || clusterId,
        place_count: clusterPois.length,
      });
    }

    return reply.send({
      assignment,
      stats: localMatching.stats || null,
      clusters_metadata: clustersMetadata,
      created_at: localMatching.created_at || null,
      updated_at: localMatching.updated_at || null,
    }), true;
  }

  const guideParam = '/guides/:guideId';

  /**
   * POST /guides/:guideId/matching
   * guides/pois_selection vivent dans notre base, pas dans celle du poi-service : on les lit ici
   * et on les envoie dans le body au poi-service (qui fait le calcul + l'appel Region Lovers),
   * puis on persiste le résultat localement — le poi-service ne touche pas notre base.
   */
  fastify.post(`${guideParam}/matching`, async (request: any, reply: any) => {
    const guideId = request.params.guideId;
    if (!serviceUrl) {
      return reply.status(503).send({ error: 'POI service non disponible', message: 'POI_SERVICE_URL doit être configuré.' });
    }
    try {
      const db = request.server.container.db;
      if (!ObjectId.isValid(guideId)) return reply.code(400).send({ error: 'Guide ID invalide' });

      const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });
      if (!guide.destination_rl_id) return reply.code(400).send({ error: 'destination_rl_id manquant' });

      const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
      if (!poisSelection?.pois?.length) return reply.code(400).send({ error: 'Aucun POI sélectionné' });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-Api-Key'] = apiKey;
      if (request.headers?.cookie) headers['Cookie'] = request.headers.cookie;
      if (request.headers?.authorization) headers['Authorization'] = request.headers.authorization;

      const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/v1/guides/${guideId}/matching`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ guide_destination_rl_id: guide.destination_rl_id, pois: poisSelection.pois }),
      });
      const data: any = await res.json().catch(() => ({ error: 'Réponse non-JSON du microservice' }));
      if (!res.ok) return reply.status(res.status).send(data);

      const now = new Date();
      await db.collection(COLLECTIONS.cluster_assignments).updateOne(
        { guide_id: guideId },
        { $set: { guide_id: guideId, assignment: data.assignment, stats: data.stats, clusters_metadata: data.clusters_metadata, matched_at: now, updated_at: now } },
        { upsert: true }
      );
      if (Array.isArray(data.updated_pois)) {
        await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: data.updated_pois, updated_at: now } });
      }

      return reply.send({ assignment: data.assignment, stats: data.stats, clusters_metadata: data.clusters_metadata });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Erreur matching');
      return reply.status(502).send({ error: 'Erreur de communication avec le POI service', details: error.message });
    }
  });

  /**
   * GET /guides/:guideId/matching
   * cluster_assignments vit dans notre base — pas de repli vers le poi-service (sa copie locale
   * est structurellement vide/obsolète). Absence de matching = état initial, pas une erreur.
   */
  fastify.get(`${guideParam}/matching`, async (req, reply) => {
    if (await sendLocalMatchingIfAvailable(req, reply)) return;
    return reply.send({
      assignment: { clusters: {}, unassigned: [] },
      stats: null,
      clusters_metadata: [],
      created_at: null,
      updated_at: null,
    });
  });

  /**
   * POST /guides/:guideId/clusters
   * Crée un cluster manuel. cluster_assignments vit dans notre base — géré ici en local,
   * pas de proxy vers le poi-service (qui n'a pas accès à cette donnée).
   */
  fastify.post(`${guideParam}/clusters`, async (request: any, reply: any) => {
    const guideId = request.params.guideId;
    const { cluster_name } = (request.body || {}) as { cluster_name?: string };
    if (!cluster_name?.trim()) return reply.code(400).send({ error: 'Le nom du cluster est requis' });

    try {
      const db = request.server.container.db;
      const clusterId = `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const newCluster = { cluster_id: clusterId, cluster_name: cluster_name.trim(), place_count: 0, is_manual: true, created_at: new Date() };

      const existingAssignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
      if (existingAssignment) {
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $push: { clusters_metadata: newCluster } as any, $set: { updated_at: new Date() } }
        );
      } else {
        await db.collection(COLLECTIONS.cluster_assignments).insertOne({
          guide_id: guideId,
          clusters_metadata: [newCluster],
          assignment: { clusters: {}, unassigned: [] },
          stats: { total_pois: 0, assigned: 0, unassigned: 0, auto_matched: 0, manual_matched: 0, by_cluster: {} },
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      return reply.send({ success: true, cluster: newCluster });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Erreur création cluster manuel');
      return reply.code(500).send({ error: error.message });
    }
  });
}
