import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

/**
 * Routes de matching clusters.
 *
 * Proxy léger vers apps/poi-service.
 * Si POI_SERVICE_URL n'est pas configuré, répond 503.
 */
export default async function clusterMatchingRoutes(fastify: FastifyInstance) {
  const serviceUrl = env.POI_SERVICE_URL;
  const apiKey = env.POI_SERVICE_API_KEY;

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
  fastify.get(`${guideParam}/matching`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching`, 'GET'));
  fastify.post(`${guideParam}/matching/save`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/matching/save`));
  fastify.post(`${guideParam}/clusters`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters`));
  fastify.delete(`${guideParam}/clusters/:clusterId`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters/${(req.params as any).clusterId}`, 'DELETE'));
  fastify.patch(`${guideParam}/clusters/:clusterId`, (req, reply) => proxyRequest(req, reply, `/guides/${(req.params as any).guideId}/clusters/${(req.params as any).clusterId}`, 'PATCH'));
}
