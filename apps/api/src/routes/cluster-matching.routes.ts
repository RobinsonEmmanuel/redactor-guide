import { FastifyInstance } from 'fastify';
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

  async function proxyRequest(request: any, reply: any, targetPath: string, method?: string) {
    if (!serviceUrl) {
      return reply.status(503).send({
        error: 'POI service non disponible',
        message: 'POI_SERVICE_URL doit être configuré.',
      });
    }

    const targetUrl = `${serviceUrl.replace(/\/$/, '')}/api/v1${targetPath}`;
    const reqMethod = method || request.method;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['X-Api-Key'] = apiKey;

      // Transmettre les cookies/auth pour la validation JWT Region Lovers
      const cookieHeader = request.headers?.cookie;
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      const authHeader = request.headers?.authorization;
      if (authHeader) headers['Authorization'] = authHeader;

      const fetchOptions: RequestInit = { method: reqMethod, headers };
      if (reqMethod !== 'GET' && reqMethod !== 'HEAD' && request.body) {
        fetchOptions.body = JSON.stringify(request.body);
      }

      const res = await fetch(targetUrl, fetchOptions);
      const data = await res.json().catch(() => ({ error: 'Réponse non-JSON du microservice' }));
      return reply.status(res.status).send(data);
    } catch (error: any) {
      fastify.log.error({ error: error.message, targetUrl }, 'Proxy poi-service error');
      return reply.status(502).send({ error: 'Erreur de communication avec le POI service', details: error.message });
    }
  }

  const guideParam = '/guides/:guideId';

  fastify.post(`${guideParam}/matching/generate`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching/generate`));
  fastify.post(`${guideParam}/matching`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching`));
  fastify.get(`${guideParam}/matching`, async (req, reply) => {
    if (await sendLocalMatchingIfAvailable(req, reply)) return;
    return proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching`, 'GET');
  });
  fastify.post(`${guideParam}/matching/save`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching/save`));
  fastify.post(`${guideParam}/clusters`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters`));
  fastify.delete(`${guideParam}/clusters/:clusterId`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters/${(req.params as any).clusterId}`, 'DELETE'));
  fastify.patch(`${guideParam}/clusters/:clusterId`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters/${(req.params as any).clusterId}`, 'PATCH'));
}
