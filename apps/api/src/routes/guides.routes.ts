import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';

const CreateGuideSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
  version: z.string(),
  language: z.enum(['fr', 'en', 'de', 'it', 'es', 'pt-pt', 'nl', 'da', 'sv']),
  availableLanguages: z.array(z.string()).default(['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl']),
  status: z.enum(['draft', 'in_progress', 'review', 'ready', 'published', 'archived']),
  destinations: z.array(z.string()).default([]),
  wpConfig: z.object({
    siteUrl: z.string().url(),
    jwtToken: z.string(),
  }).optional(),
});

export async function guidesRoutes(fastify: FastifyInstance) {
  // Liste des guides
  fastify.get('/guides', async (request) => {
    const db = request.server.container.db;
    const guides = await db.collection('guides').find().sort({ year: -1 }).toArray();
    return { guides };
  });

  // Détail d'un guide
  fastify.get('/guides/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.server.container.db;
    
    try {
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(id) });
      
      if (!guide) {
        return reply.status(404).send({ error: 'Guide non trouvé' });
      }
      
      return guide;
    } catch (error) {
      return reply.status(400).send({ error: 'ID invalide' });
    }
  });

  // Articles récupérés pour un guide
  fastify.get('/guides/:id/articles', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.server.container.db;
    
    try {
      // Récupérer le guide pour obtenir le slug (siteId)
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(id) });
      
      if (!guide) {
        return reply.status(404).send({ error: 'Guide non trouvé' });
      }

      // Récupérer les articles avec ce siteId
      const articles = await db
        .collection('articles_raw')
        .find({ site_id: guide.slug })
        .project({
          _id: 1,
          title: 1,
          slug: 1,
          urls_by_lang: 1,
          images: 1,
          categories: 1,
          tags: 1,
          updated_at: 1,
        })
        .sort({ updated_at: -1 })
        .toArray();
      
      return { articles };
    } catch (error) {
      return reply.status(400).send({ error: 'ID invalide' });
    }
  });

  // Créer un guide
  fastify.post('/guides', async (request, reply) => {
    const db = request.server.container.db;
    
    try {
      const data = CreateGuideSchema.parse(request.body);
      
      const result = await db.collection('guides').insertOne({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      return reply.status(201).send({
        success: true,
        id: result.insertedId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // Mettre à jour un guide
  fastify.put('/guides/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.server.container.db;
    
    try {
      const data = CreateGuideSchema.partial().parse(request.body);
      
      const result = await db.collection('guides').updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            ...data,
            updatedAt: new Date(),
          },
        }
      );
      
      if (result.matchedCount === 0) {
        return reply.status(404).send({ error: 'Guide non trouvé' });
      }
      
      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // Supprimer un guide
  fastify.delete('/guides/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.server.container.db;
    
    try {
      const result = await db.collection('guides').deleteOne({
        _id: new ObjectId(id),
      });
      
      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Guide non trouvé' });
      }
      
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: 'ID invalide' });
    }
  });
}
