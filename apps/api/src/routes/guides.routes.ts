import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { GuideTranslationService } from '../services/guide-translation.service.js';

// Langues cibles supportées pour la traduction IA.
// 'fr' est volontairement absent : c'est la langue source, non une cible.
const VALID_TRANSLATION_LANGS = ['en', 'de', 'it', 'es', 'pt-pt', 'nl', 'da', 'sv'] as const;

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
   * Retourne les articles WordPress liés au guide.
   *
   * Query params:
   *   - q      : filtre texte sur le titre (optionnel) — utilisé par PageModal
   *   - slug   : lookup exact par slug (optionnel)
   *   - page   : numéro de page pour la pagination (défaut: 1)
   *   - limit  : taille de page (défaut: 50, max: 200)
   *   - lang   : langue pour l'URL (défaut: langue du guide)
   *
   * Comportement selon les paramètres :
   *   - slug présent   → lookup exact, pas de pagination
   *   - q présent      → recherche titre sur tous les articles de la destination, pas de pagination
   *   - aucun          → tous les articles de la destination, avec pagination
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { q?: string; slug?: string; page?: string; limit?: string; lang?: string };
  }>('/guides/:id/articles', async (request, reply) => {
    const db = request.server.container.db;
    const { id } = request.params;
    const { q, slug: slugParam, page: pageStr, limit: limitStr, lang } = request.query;

    // Pagination
    const page  = Math.max(1, parseInt(pageStr  ?? '1',  10) || 1);
    const limit = Math.min(Math.max(1, parseInt(limitStr ?? '50', 10) || 50), 200);
    const skip  = (page - 1) * limit;

    if (!ObjectId.isValid(id)) {
      return reply.status(400).send({ error: 'ID invalide' });
    }

    try {
      // 1. Récupérer guide (langue + destination)
      const guide = await db.collection('guides').findOne(
        { _id: new ObjectId(id) },
        { projection: { language: 1, destination: 1, destinations: 1 } }
      );
      const targetLang  = lang || guide?.language || 'fr';
      const destination: string = guide?.destination ?? guide?.destinations?.[0] ?? '';

      // 2. Construire le filtre MongoDB
      const filter: Record<string, unknown> = {};

      if (slugParam) {
        // Lookup exact par slug (drag-and-drop POI)
        filter.slug = slugParam;
      } else if (q) {
        // Recherche texte sur les articles de la destination
        const regex = new RegExp(q, 'i');
        filter.$or = [{ title: regex }, { slug: regex }];
        if (destination) filter.categories = { $regex: destination, $options: 'i' };
      } else {
        // Vue liste : tous les articles de la destination, avec pagination
        if (destination) {
          filter.categories = { $regex: destination, $options: 'i' };
        }
      }

      const projection = { slug: 1, title: 1, urls_by_lang: 1, categories: 1, tags: 1, updated_at: 1 };

      if (slugParam || q) {
        // Pas de pagination pour les lookups et recherches
        const rawArticles = await db
          .collection('articles_raw')
          .find(filter, { projection })
          .limit(200)
          .toArray();

        const articles = rawArticles.map(a => normalizeArticle(a, targetLang));
        return reply.send({ articles, total: articles.length, lang: targetLang });
      }

      // 3. Vue paginée
      const [total, rawArticles] = await Promise.all([
        db.collection('articles_raw').countDocuments(filter),
        db.collection('articles_raw')
          .find(filter, { projection })
          .sort({ title: 1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
      ]);

      const totalPages = Math.ceil(total / limit);
      const articles   = rawArticles.map(a => normalizeArticle(a, targetLang));

      return reply.send({
        articles,
        total,
        pagination: { page, limit, total, totalPages },
        lang: targetLang,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors du chargement des articles' });
    }
  });

  /**
   * POST /guides/:guideId/translate?lang=en
   * Lance la traduction du guide dans la langue cible (job asynchrone).
   * Crée/met à jour un enregistrement dans guide_translation_jobs.
   * Répond immédiatement — le frontend poll /translation-status pour suivre.
   */
  fastify.post('/guides/:guideId/translate', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId } = request.params as { guideId: string };
    const { lang } = request.query as { lang?: string };

    if (!lang || !(VALID_TRANSLATION_LANGS as readonly string[]).includes(lang)) {
      return reply.status(400).send({ error: `Langue invalide. Valeurs acceptées : ${VALID_TRANSLATION_LANGS.join(', ')}` });
    }
    if (!ObjectId.isValid(guideId)) {
      return reply.status(400).send({ error: 'guideId invalide' });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return reply.status(500).send({ error: 'OPENAI_API_KEY non configurée' });
    }

    // Vérifier qu'un job n'est pas déjà en cours
    const existingJob = await db.collection('guide_translation_jobs').findOne(
      { guide_id: guideId, lang },
      { sort: { created_at: -1 } }
    );
    if (existingJob?.status === 'processing') {
      return reply.send({ status: 'processing', jobId: existingJob._id.toString() });
    }

    // Créer le job
    const jobDoc = {
      guide_id: guideId,
      lang,
      status: 'processing',
      progress: { done: 0, total: 0 },
      error: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const insertResult = await db.collection('guide_translation_jobs').insertOne(jobDoc);
    const jobId = insertResult.insertedId.toString();

    // Lancer la traduction en arrière-plan (pas de await)
    const service = new GuideTranslationService(openaiApiKey);
    service.translateGuide(
      guideId,
      lang,
      db,
      async (progress) => {
        await db.collection('guide_translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { progress, updated_at: new Date() } }
        ).catch(() => {});
      }
    ).then(async (stats) => {
      await db.collection('guide_translation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'completed',
            stats,
            progress: { done: stats.translated + stats.skipped + stats.errors, total: stats.translated + stats.skipped + stats.errors },
            translated_at: new Date(),
            updated_at: new Date(),
          },
        }
      ).catch(() => {});
      console.log(`✅ [TRANSLATE] Guide ${guideId} → ${lang} terminé:`, stats);
    }).catch(async (err: any) => {
      await db.collection('guide_translation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'failed', error: err.message, updated_at: new Date() } }
      ).catch(() => {});
      console.error(`❌ [TRANSLATE] Guide ${guideId} → ${lang} échoué:`, err.message);
    });

    return reply.send({ status: 'processing', jobId });
  });

  /**
   * GET /guides/:guideId/translation-status?lang=en
   * Retourne le statut de traduction pour la langue donnée.
   */
  fastify.get('/guides/:guideId/translation-status', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId } = request.params as { guideId: string };
    const { lang } = request.query as { lang?: string };

    if (!lang) return reply.status(400).send({ error: 'lang requis' });

    const job = await db.collection('guide_translation_jobs').findOne(
      { guide_id: guideId, lang },
      { sort: { created_at: -1 } }
    );

    if (!job) {
      return reply.send({ status: 'idle', progress: null, translated_at: null });
    }

    return reply.send({
      status: job.status,
      progress: job.progress || null,
      translated_at: job.translated_at || null,
      stats: job.stats || null,
      error: job.error || null,
    });
  });
}

function normalizeArticle(a: any, targetLang: string) {
  return {
    _id:          a._id.toString(),
    titre:        a.title ?? a.slug,
    title:        a.title ?? a.slug,
    slug:         a.slug,
    url_francais: a.urls_by_lang?.[targetLang] ?? a.urls_by_lang?.['fr'] ?? '',
    urls_by_lang: a.urls_by_lang ?? {},
    urls:         a.urls_by_lang ?? {},
    categories:   a.categories ?? [],
    tags:         a.tags ?? [],
    updated_at:   a.updated_at ?? '',
  };
}

