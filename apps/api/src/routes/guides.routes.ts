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
  destination: z.string().min(1), // 1 guide = 1 destination
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
      
      // Récupérer le chemin de fer associé
      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: id });
      
      return { ...guide, chemin_de_fer: cheminDeFer };
    } catch (error) {
      return reply.status(400).send({ error: 'ID invalide' });
    }
  });

  // Articles récupérés pour un guide (avec pagination)
  fastify.get('/guides/:id/articles', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = '1', limit = '20' } = request.query as { page?: string; limit?: string };
    const db = request.server.container.db;
    
    try {
      // Récupérer le guide pour obtenir le slug (siteId)
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(id) });
      
      if (!guide) {
        return reply.status(404).send({ error: 'Guide non trouvé' });
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10))); // Max 100 par page
      const skip = (pageNum - 1) * limitNum;

      const query = { site_id: guide.slug };

      // Compter le total (avec cache si possible)
      const total = await db.collection('articles_raw').countDocuments(query);

      // Récupérer les articles paginés
      const articles = await db
        .collection('articles_raw')
        .find(query)
        .project({
          _id: 1,
          title: 1,
          slug: 1,
          urls_by_lang: 1,
          images: 1,
          categories: 1,
          tags: 1,
          markdown: 1,
          updated_at: 1,
        })
        .sort({ updated_at: -1 })
        .skip(skip)
        .limit(limitNum)
        .toArray();
      
      return { 
        articles,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      };
    } catch (error) {
      return reply.status(400).send({ error: 'ID invalide' });
    }
  });

  // Créer un guide
  fastify.post('/guides', async (request, reply) => {
    const db = request.server.container.db;
    
    try {
      const data = CreateGuideSchema.parse(request.body);
      
      const now = new Date().toISOString();
      const result = await db.collection('guides').insertOne({
        ...data,
        createdAt: now,
        updatedAt: now,
      });
      
      // Créer automatiquement le chemin de fer associé
      await db.collection('chemins_de_fer').insertOne({
        guide_id: result.insertedId.toString(),
        nom: data.name,
        version: data.version,
        nombre_pages: 0,
        created_at: now,
        updated_at: now,
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
