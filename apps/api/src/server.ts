import Fastify from 'fastify';
import { Db } from 'mongodb';
import { DIContainer } from './di/container';

/**
 * Créer et configurer le serveur Fastify
 */
export async function createServer(db: Db, _port: number) {
  const fastify = Fastify({
    logger: true,
  });

  // Initialiser le conteneur DI
  const container = new DIContainer(db);

  // Décorateur pour accéder au conteneur DI depuis les routes
  fastify.decorate('container', container);

  // Routes de base
  fastify.get('/', async () => {
    return {
      name: 'Redactor Guide API',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
    };
  });

  // Health check
  fastify.get('/health', async () => {
    try {
      // Vérifier la connexion MongoDB
      await db.admin().ping();
      return {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Activer CORS pour le frontend
  await fastify.register(import('@fastify/cors'), {
    origin: [
      'http://localhost:3001', // Dev local
      'https://*.vercel.app', // Vercel previews
      /^https:\/\/.*\.vercel\.app$/, // Vercel regex pattern
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // Routes API
  await fastify.register(
    async (fastify) => {
      await fastify.register(
        (await import('./routes/guides.routes')).guidesRoutes
      );
      await fastify.register(
        (await import('./routes/ingest.routes')).ingestRoutes
      );
      await fastify.register(
        (await import('./routes/templates.routes')).templatesRoutes
      );
      await fastify.register(
        (await import('./routes/chemin-de-fer.routes')).cheminDeFerRoutes
      );
      await fastify.register(
        (await import('./routes/prompts.routes')).promptsRoutes
      );
      await fastify.register(
        (await import('./routes/debug.routes')).debugRoutes
      );
      await fastify.register(
        (await import('./routes/workers.routes')).workersRoutes
      );

      fastify.get('/destinations', async () => {
        const destinations = await db.collection('destinations').find().toArray();
        return { destinations };
      });

      // Détail d'un article
      fastify.get<{ Params: { id: string } }>('/articles/:id', async (request, reply) => {
        const { id } = request.params;
        try {
          const article = await db.collection('articles_raw').findOne({ _id: new (await import('mongodb')).ObjectId(id) });
          if (!article) {
            return reply.status(404).send({ error: 'Article non trouvé' });
          }
          return article;
        } catch (error) {
          return reply.status(400).send({ error: 'ID invalide' });
        }
      });
    },
    { prefix: '/api/v1' }
  );

  return fastify;
}

// Déclaration TypeScript pour le décorateur
declare module 'fastify' {
  interface FastifyInstance {
    container: DIContainer;
  }
}
