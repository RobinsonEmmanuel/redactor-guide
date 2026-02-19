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
  destination: z.string().min(1),
  destination_rl_id: z.string().optional(),
  guide_template_id: z.string().optional(),
  image_principale: z.string().optional(),
  wpConfig: z.object({
    siteUrl: z.string().url().or(z.literal('')),
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

  /**
   * GET /guides/:id/articles
   * Retourne les articles WordPress liés aux POIs du guide.
   * Utilisé par PageModal pour la recherche et l'autocomplétion.
   *
   * Query params:
   *   - q      : filtre texte sur le titre (optionnel)
   *   - limit  : nombre max de résultats (défaut: 500)
   *   - lang   : langue pour l'URL (défaut: langue du guide)
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { q?: string; limit?: string; lang?: string };
  }>('/guides/:id/articles', async (request, reply) => {
    const db = request.server.container.db;
    const { id } = request.params;
    const { q, limit: limitStr, lang } = request.query;
    const limit = Math.min(parseInt(limitStr ?? '500', 10) || 500, 1000);

    if (!ObjectId.isValid(id)) {
      return reply.status(400).send({ error: 'ID invalide' });
    }

    try {
      // 1. Récupérer la langue du guide pour les URLs
      const guide = await db.collection('guides').findOne(
        { _id: new ObjectId(id) },
        { projection: { language: 1 } }
      );
      const targetLang = lang || guide?.language || 'fr';

      // 2. Récupérer les slugs d'articles associés aux POIs du guide
      const poisDoc = await db.collection('pois_selection').findOne({ guide_id: id });
      const pois: any[] = poisDoc?.pois ?? [];

      // Collecter tous les slugs uniques (article principal + mentions secondaires)
      const slugSet = new Set<string>();
      for (const poi of pois) {
        if (poi.article_source) slugSet.add(poi.article_source);
        for (const s of poi.autres_articles_mentions ?? []) slugSet.add(s);
      }

      // 3. Construire le filtre MongoDB
      const filter: Record<string, unknown> = {};

      if (slugSet.size > 0) {
        // Articles liés aux POIs du guide
        filter.slug = { $in: [...slugSet] };
      }
      // Filtre texte optionnel
      if (q) {
        const regex = new RegExp(q, 'i');
        filter.$or = [{ title: regex }, { slug: regex }];
        // Si filtre texte, chercher sur toute la collection (pas seulement POIs liés)
        delete filter.slug;
      }

      // 4. Récupérer les articles
      const rawArticles = await db
        .collection('articles_raw')
        .find(filter, { projection: { slug: 1, title: 1, urls_by_lang: 1 } })
        .limit(limit)
        .toArray();

      // 5. Normaliser vers le format attendu par PageModal
      const articles = rawArticles.map(a => ({
        _id:          a._id.toString(),
        titre:        a.title ?? a.slug,
        slug:         a.slug,
        url_francais: a.urls_by_lang?.[targetLang] ?? a.urls_by_lang?.['fr'] ?? '',
        urls:         a.urls_by_lang ?? {},
      }));

      return reply.send({
        articles,
        total: articles.length,
        lang:  targetLang,
        guide_pois_slugs: [...slugSet].length,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors du chargement des articles' });
    }
  });
}
