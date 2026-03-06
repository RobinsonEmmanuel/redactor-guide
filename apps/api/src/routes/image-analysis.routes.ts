import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { ImageAnalysisService } from '../services/image-analysis.service';
import { COLLECTIONS } from '../config/collections.js';

const AnalyzeArticleImagesSchema = z.object({
  articleId: z.string().optional(),
  articleUrl: z.string().url().optional(),
}).refine(data => data.articleId || data.articleUrl, {
  message: 'articleId ou articleUrl requis'
});

export async function imageAnalysisRoutes(fastify: FastifyInstance) {
  const db = fastify.container.db;

  /**
   * POST /images/analyze-article
   * Analyse les images d'un article spécifique
   * Utilisé quand on associe un article à une page
   */
  fastify.post('/images/analyze-article', async (request, reply) => {
    try {
      const body = AnalyzeArticleImagesSchema.parse(request.body);

      // Vérifier que OpenAI API Key est configurée
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return reply.status(503).send({
          error: 'Service non disponible',
          message: 'OPENAI_API_KEY non configurée'
        });
      }

      // Charger le prompt d'analyse
      const promptDoc = await db.collection(COLLECTIONS.prompts).findOne({
        intent: 'analyse_image',
        actif: true,
      });
      if (!promptDoc) {
        return reply.status(400).send({
          error: 'Prompt analyse_image introuvable',
          message: 'Veuillez créer un prompt avec intent "analyse_image" et actif=true'
        });
      }

      // Charger l'article
      let article;
      if (body.articleId) {
        article = await db.collection(COLLECTIONS.articles_raw).findOne({
          _id: new ObjectId(body.articleId)
        });
      } else if (body.articleUrl) {
        article = await db.collection(COLLECTIONS.articles_raw).findOne({
          'urls_by_lang.fr': body.articleUrl
        });
      }

      if (!article) {
        return reply.status(404).send({
          error: 'Article non trouvé'
        });
      }

      // Vérifier si déjà analysé
      if (article.images_analysis && article.images_analysis.length > 0) {
        console.log(`✅ Article "${article.title}" déjà analysé (${article.images_analysis.length} images)`);
        return reply.send({
          success: true,
          alreadyAnalyzed: true,
          articleId: article._id.toString(),
          imagesCount: article.images_analysis.length,
          analyses: article.images_analysis
        });
      }

      // Vérifier qu'il y a des images
      if (!article.images || article.images.length === 0) {
        return reply.send({
          success: true,
          imagesCount: 0,
          message: 'Aucune image à analyser'
        });
      }

      console.log(`📸 Analyse de ${article.images.length} images pour "${article.title}"`);

      // Analyser les images avec cache MongoDB
      const imageAnalysisService = new ImageAnalysisService(openaiApiKey, db);
      const analyses = await imageAnalysisService.analyzeImages(
        article.images,
        promptDoc.texte_prompt as string
      );

      // Mettre à jour l'article avec les analyses
      await db.collection(COLLECTIONS.articles_raw).updateOne(
        { _id: article._id },
        {
          $set: {
            images_analysis: analyses,
            images_analyzed_at: new Date().toISOString()
          }
        }
      );

      console.log(`✅ ${analyses.length} images analysées et sauvegardées`);

      return reply.send({
        success: true,
        articleId: article._id.toString(),
        imagesCount: analyses.length,
        analyses
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erreur analyse images'
      });
    }
  });

  /**
   * POST /images/reanalyze-article
   * Force la ré-analyse des images d'un article (même si déjà analysé)
   */
  fastify.post('/images/reanalyze-article', async (request, reply) => {
    try {
      const body = AnalyzeArticleImagesSchema.parse(request.body);

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return reply.status(503).send({
          error: 'Service non disponible',
          message: 'OPENAI_API_KEY non configurée'
        });
      }

      const promptDoc = await db.collection(COLLECTIONS.prompts).findOne({
        intent: 'analyse_image',
        actif: true,
      });
      if (!promptDoc) {
        return reply.status(400).send({
          error: 'Prompt analyse_image introuvable'
        });
      }

      // Charger l'article
      let article;
      if (body.articleId) {
        article = await db.collection(COLLECTIONS.articles_raw).findOne({
          _id: new ObjectId(body.articleId)
        });
      } else if (body.articleUrl) {
        article = await db.collection(COLLECTIONS.articles_raw).findOne({
          'urls_by_lang.fr': body.articleUrl
        });
      }

      if (!article) {
        return reply.status(404).send({
          error: 'Article non trouvé'
        });
      }

      if (!article.images || article.images.length === 0) {
        return reply.send({
          success: true,
          imagesCount: 0,
          message: 'Aucune image à analyser'
        });
      }

      console.log(`🔄 Ré-analyse de ${article.images.length} images pour "${article.title}"`);

      // Analyser les images avec cache MongoDB
      const imageAnalysisService = new ImageAnalysisService(openaiApiKey, db);
      const analyses = await imageAnalysisService.analyzeImages(
        article.images,
        promptDoc.texte_prompt as string
      );

      // Mettre à jour l'article avec les nouvelles analyses
      await db.collection(COLLECTIONS.articles_raw).updateOne(
        { _id: article._id },
        {
          $set: {
            images_analysis: analyses,
            images_analyzed_at: new Date().toISOString()
          }
        }
      );

      console.log(`✅ ${analyses.length} images ré-analysées et sauvegardées`);

      return reply.send({
        success: true,
        reanalyzed: true,
        articleId: article._id.toString(),
        imagesCount: analyses.length,
        analyses
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erreur ré-analyse images'
      });
    }
  });

  /**
   * POST /images/tag-poi
   * Associe une ou plusieurs images à un POI (et optionnellement d'autres POIs).
   * Utilise $addToSet pour éviter les doublons dans poi_names.
   * Body: { url: string; poi_names: string[] }
   */
  fastify.post<{ Body: { url: string; poi_names: string[] } }>(
    '/images/tag-poi',
    async (request, reply) => {
      const { url, poi_names } = request.body ?? {};

      if (!url || !poi_names?.length) {
        return reply.status(400).send({ error: 'url et poi_names requis' });
      }

      try {
        // upsert: true — crée le document si l'image n'est pas encore dans image_analyses
        // (cas : analyse IA désactivée ou échouée lors de l'upload)
        await db.collection(COLLECTIONS.image_analyses).updateOne(
          { url },
          {
            $addToSet: { poi_names: { $each: poi_names } },
            $setOnInsert: {
              url,
              analyzed_at: new Date().toISOString(),
              reuse_count: 0,
            },
          },
          { upsert: true }
        );
        return reply.send({ ok: true, url, poi_names });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /images/by-poi
   * Retourne les images de la collection image_analyses dont poi_names contient le POI demandé.
   * Query params:
   *   - poi_name : nom du POI (obligatoire)
   *   - sort     : 'relevance' (défaut) | 'clarity' | 'composition'
   */
  fastify.get<{ Querystring: { poi_name?: string; sort?: string } }>(
    '/images/by-poi',
    async (request, reply) => {
      const { poi_name, sort = 'relevance' } = request.query;

      if (!poi_name?.trim()) {
        return reply.status(400).send({ error: 'Paramètre poi_name requis' });
      }

      try {
        const images = await db
          .collection(COLLECTIONS.image_analyses)
          .find(
            { poi_names: poi_name.trim() },
            {
              projection: {
                url: 1,
                analysis: 1,
                analyzed_at: 1,
                poi_names: 1,
              },
            }
          )
          .toArray();

        const mapped = images.map((doc: any) => ({
          image_id:                   doc._id.toString(),
          url:                        doc.url,
          poi_names:                  doc.poi_names ?? [],
          shows_entire_site:          doc.analysis?.shows_entire_site ?? false,
          shows_detail:               doc.analysis?.shows_detail ?? false,
          detail_type:                doc.analysis?.detail_type ?? '',
          is_iconic_view:             doc.analysis?.is_iconic_view ?? false,
          is_contextual:              doc.analysis?.is_contextual ?? false,
          is_composite:               doc.analysis?.is_composite ?? false,
          has_text_overlay:           doc.analysis?.has_text_overlay ?? false,
          has_graphic_effects:        doc.analysis?.has_graphic_effects ?? false,
          visual_clarity_score:       doc.analysis?.visual_clarity_score ?? 0,
          composition_quality_score:  doc.analysis?.composition_quality_score ?? 0,
          lighting_quality_score:     doc.analysis?.lighting_quality_score ?? 0,
          readability_small_screen_score: doc.analysis?.readability_small_screen_score ?? 0,
          editorial_relevance:        doc.analysis?.editorial_relevance ?? 'faible',
          analysis_summary:           doc.analysis?.analysis_summary ?? '',
          analyzed_at:                doc.analyzed_at,
        }));

        const sortFn: Record<string, (a: any, b: any) => number> = {
          relevance:   (a, b) => {
            const rank = { forte: 2, moyenne: 1, faible: 0 };
            return (rank[b.editorial_relevance as keyof typeof rank] ?? 0)
                 - (rank[a.editorial_relevance as keyof typeof rank] ?? 0);
          },
          clarity:     (a, b) => b.visual_clarity_score - a.visual_clarity_score,
          composition: (a, b) => b.composition_quality_score - a.composition_quality_score,
        };
        mapped.sort(sortFn[sort] ?? sortFn.relevance);

        return reply.send({ images: mapped, total: mapped.length });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /images/article-analysis/:articleId
   * Récupère les analyses d'images d'un article
   */
  fastify.get<{ Params: { articleId: string } }>(
    '/images/article-analysis/:articleId',
    async (request, reply) => {
      try {
        const { articleId } = request.params;

        const article = await db.collection(COLLECTIONS.articles_raw).findOne(
          { _id: new ObjectId(articleId) },
          { projection: { images_analysis: 1, images: 1, title: 1, images_analyzed_at: 1 } }
        );

        if (!article) {
          return reply.status(404).send({
            error: 'Article non trouvé'
          });
        }

        return reply.send({
          articleId: article._id.toString(),
          title: article.title,
          imagesCount: article.images?.length || 0,
          hasAnalysis: !!(article.images_analysis && article.images_analysis.length > 0),
          analyzedAt: article.images_analyzed_at,
          analyses: article.images_analysis || []
        });

      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Erreur récupération analyses'
        });
      }
    }
  );
}
