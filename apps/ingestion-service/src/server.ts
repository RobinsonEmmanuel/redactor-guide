import Fastify from 'fastify';
import { Db } from 'mongodb';
import { env } from './config/env.js';

/**
 * Crée et configure le serveur Fastify pour le microservice d'ingestion.
 *
 * Authentification : header X-Api-Key requis sur toutes les routes sauf /health
 * et les routes worker appelées par QStash (/ingest/run, /workers/*).
 */
export async function createServer(db: Db, _port: number) {
  const fastify = Fastify({ logger: true });

  // Décorateur mongo (pattern identique à apps/api)
  fastify.decorate('mongo', { db });

  // ── Routes de base ────────────────────────────────────────────────────────

  fastify.get('/', async () => ({
    name: 'Redactor Guide — Ingestion Service',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/health', async () => {
    try {
      await db.admin().ping();
      return { status: 'healthy', database: 'connected', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', database: 'disconnected', error: error instanceof Error ? error.message : 'Unknown', timestamp: new Date().toISOString() };
    }
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await fastify.register(import('@fastify/cors'), {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // ── Cookie (pour la transmission du JWT Region Lovers via matching routes) ─
  await fastify.register(import('@fastify/cookie'));

  // ── Routes API avec auth X-Api-Key ────────────────────────────────────────
  await fastify.register(
    async (api) => {
      // Middleware d'authentification par clé API
      // Les routes QStash (/ingest/run, /workers/*) sont exemptées car QStash
      // ne peut pas envoyer de header arbitraire facilement.
      if (env.API_KEY_SECRET) {
        api.addHook('onRequest', async (request, reply) => {
          const path = request.url;
          const isWorkerRoute =
            path.includes('/ingest/run') ||
            path.includes('/workers/');

          if (isWorkerRoute) return; // pas d'auth pour les callbacks QStash

          const apiKey = request.headers['x-api-key'];
          if (!apiKey || apiKey !== env.API_KEY_SECRET) {
            return reply.code(401).send({ error: 'Non autorisé', message: 'Header X-Api-Key manquant ou invalide' });
          }
        });
      }

      // ── Ingest routes ──────────────────────────────────────────────────────
      const { ingestRoutes } = await import('./routes/ingest.routes.js');
      await api.register(ingestRoutes);

    },
    { prefix: '/api/v1' }
  );

  return fastify;
}

// Déclaration TypeScript pour les décorateurs
declare module 'fastify' {
  interface FastifyInstance {
    mongo: { db: Db };
  }
}
