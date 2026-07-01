import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

interface ClusterPoi {
  id: string;
  name: string;
}

interface Cluster {
  id: string;
  name: string;
  pois: ClusterPoi[];
}

/**
 * Routes d'ingestion WordPress.
 *
 * Proxy vers le microservice d'ingestion (déployé hors de ce dépôt).
 * Si INGESTION_SERVICE_URL n'est pas configuré, répond 503.
 */
export async function ingestRoutes(fastify: FastifyInstance) {
  const serviceUrl = env.INGESTION_SERVICE_URL;
  const apiKey = env.INGESTION_SERVICE_API_KEY;

  async function proxyRequest(request: any, reply: any, targetPath: string, method?: string) {
    if (!serviceUrl) {
      return reply.status(503).send({
        error: 'Ingestion service non disponible',
        message: 'INGESTION_SERVICE_URL doit être configuré.',
      });
    }

    const targetUrl = `${serviceUrl.replace(/\/$/, '')}/api/v1${targetPath}`;
    const reqMethod = method || request.method;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['X-Api-Key'] = apiKey;

      // Timeout long pour les routes d'ingestion synchrone (jusqu'à 15 min pour 200+ articles)
      const isLongRunning = targetPath.startsWith('/ingest') && !targetPath.includes('/status');
      const fetchOptions: RequestInit = {
        method: reqMethod,
        headers,
        signal: isLongRunning ? AbortSignal.timeout(15 * 60 * 1000) : AbortSignal.timeout(30_000),
      };
      if (reqMethod !== 'GET' && reqMethod !== 'HEAD' && request.body) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(request.body);
      }

      // Transmettre les cookies pour les routes de matching (JWT Region Lovers)
      const cookieHeader = request.headers?.cookie;
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      const authHeader = request.headers?.authorization;
      if (authHeader) headers['Authorization'] = authHeader;

      const res = await fetch(targetUrl, fetchOptions);
      const data = await res.json().catch(() => ({ error: 'Réponse non-JSON du microservice' }));
      return reply.status(res.status).send(data);
    } catch (error: any) {
      fastify.log.error({ error: error.message, targetUrl }, 'Proxy microservice ingestion error');
      return reply.status(502).send({ error: 'Erreur de communication avec le service d\'ingestion', details: error.message });
    }
  }

  fastify.post('/ingest', (req, reply) => proxyRequest(req, reply, '/ingest'));
  fastify.post('/ingest/enqueue', (req, reply) => proxyRequest(req, reply, '/ingest/enqueue'));
  fastify.get('/ingest/status/:jobId', (req, reply) => proxyRequest(req, reply, `/ingest/status/${(req.params as any).jobId}`, 'GET'));
  fastify.post('/ingest/sync-translations', (req, reply) => proxyRequest(req, reply, '/ingest/sync-translations'));
  fastify.post('/ingest/single-url', (req, reply) => proxyRequest(req, reply, '/ingest/single-url'));
  fastify.post('/ingest/run', (req, reply) => proxyRequest(req, reply, '/ingest/run'));
  fastify.post('/ingest/dedup', (req, reply) => proxyRequest(req, reply, '/ingest/dedup'));
  fastify.get('/ingest/progress', (req, reply) => proxyRequest(req, reply, '/ingest/progress', 'GET'));
  fastify.get('/ingest/articles-raw-sync/status', (req, reply) =>
    proxyRequest(req, reply, '/ingest/articles-raw-sync/status', 'GET')
  );
  fastify.get('/ingest/articles-raw-sync/runs', (req, reply) =>
    proxyRequest(req, reply, '/ingest/articles-raw-sync/runs', 'GET')
  );
  fastify.post('/ingest/articles-raw-sync/trigger', (req, reply) =>
    proxyRequest(req, reply, '/ingest/articles-raw-sync/trigger')
  );

  // Routes de gestion des connexions WordPress (credentials)
  fastify.get('/wp-sites', (req, reply) => proxyRequest(req, reply, '/user/sites', 'GET'));
  fastify.post('/wp-sites/:siteId/connect', (req, reply) =>
    proxyRequest(req, reply, `/user/sites/${(req.params as any).siteId}/connect`)
  );
  fastify.post('/wp-sites/:siteId/test', (req, reply) =>
    proxyRequest(req, reply, `/user/sites/${(req.params as any).siteId}/test`)
  );
  fastify.get('/wp-sites/:siteId/posts', (req, reply) =>
    proxyRequest(req, reply, `/user/sites/${(req.params as any).siteId}/posts`, 'GET')
  );

  // Régions Region Lovers — vue globale (sites + régions assignées)
  fastify.get('/regions/overview', (req, reply) =>
    proxyRequest(req, reply, '/regions/overview', 'GET')
  );

  // Clusters d'une région Region Lovers (pour le sélecteur de périmètre)
  fastify.get('/regions/:regionId/clusters', async (request, reply) => {
    const { regionId } = request.params as { regionId: string };
    const userToken =
      (request.cookies as any)?.accessToken ||
      request.headers.authorization?.replace('Bearer ', '');

    if (!userToken) {
      return reply.status(401).send({ error: 'Token JWT manquant. Veuillez vous reconnecter.' });
    }

    const rlApiUrl = env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';

    try {
      const res = await fetch(`${rlApiUrl}/place-instance-drafts/region/${regionId}`, {
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        return reply.status(res.status).send({ error: `Erreur API Region Lovers: ${res.status}` });
      }

      const data: any = await res.json();

      // Normaliser la structure (tableau direct ou { clusters: [...] })
      let rawClusters: any[] = [];
      if (Array.isArray(data)) {
        rawClusters = data;
      } else if (Array.isArray(data?.clusters)) {
        rawClusters = data.clusters;
      } else if (Array.isArray(data?.data)) {
        rawClusters = data.data;
      }

      const clusters: Cluster[] = rawClusters.map((c: any) => ({
        id: c.id ?? c._id,
        name: c.name ?? c.nom ?? '',
        pois: (c.drafts ?? c.pois ?? []).map((d: any) => ({
          id: d._id ?? d.id,
          name:
            d.place_name ??
            d.blocks?.find((b: any) => b.block_id === 'general_info')
              ?.sections?.find((s: any) => s.section_id === 'general_info_general')
              ?.fields?.find((f: any) => f.field_id === 'name')?.value ??
            '',
        })),
      }));

      return reply.send({ clusters });
    } catch (error: any) {
      fastify.log.error({ error: error.message, regionId }, 'Erreur fetch clusters RL');
      return reply.status(502).send({ error: 'Erreur de communication avec Region Lovers', details: error.message });
    }
  });
}
