import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

/**
 * Routes d'ingestion WordPress.
 *
 * Proxy léger vers apps/ingestion-service.
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['X-Api-Key'] = apiKey;

      // Timeout long pour les routes d'ingestion synchrone (jusqu'à 15 min pour 200+ articles)
      const isLongRunning = targetPath.startsWith('/ingest') && !targetPath.includes('/status');
      const fetchOptions: RequestInit = {
        method: reqMethod,
        headers,
        signal: isLongRunning ? AbortSignal.timeout(15 * 60 * 1000) : AbortSignal.timeout(30_000),
      };
      if (reqMethod !== 'GET' && reqMethod !== 'HEAD' && request.body) {
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
      fastify.log.error({ error: error.message, targetUrl }, 'Proxy ingestion-service error');
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
}
