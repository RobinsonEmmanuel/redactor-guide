import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { ImageAnalysisService } from '../services/image-analysis.service';

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
      const promptDoc = await db.collection('prompts').findOne({
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
        article = await db.collection('articles_raw').findOne({
          _id: new ObjectId(body.articleId)
        });
      } else if (body.articleUrl) {
        article = await db.collection('articles_raw').findOne({
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

      // Analyser les images
      const imageAnalysisService = new ImageAnalysisService(openaiApiKey);
      const analyses = await imageAnalysisService.analyzeImages(
        article.images,
        promptDoc.texte_prompt as string
      );

      // Mettre à jour l'article avec les analyses
      await db.collection('articles_raw').updateOne(
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

      const promptDoc = await db.collection('prompts').findOne({
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
        article = await db.collection('articles_raw').findOne({
          _id: new ObjectId(body.articleId)
        });
      } else if (body.articleUrl) {
        article = await db.collection('articles_raw').findOne({
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

      // Analyser les images
      const imageAnalysisService = new ImageAnalysisService(openaiApiKey);
      const analyses = await imageAnalysisService.analyzeImages(
        article.images,
        promptDoc.texte_prompt as string
      );

      // Mettre à jour l'article avec les nouvelles analyses
      await db.collection('articles_raw').updateOne(
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
   * GET /images/article-analysis/:articleId
   * Récupère les analyses d'images d'un article
   */
  fastify.get<{ Params: { articleId: string } }>(
    '/images/article-analysis/:articleId',
    async (request, reply) => {
      try {
        const { articleId } = request.params;

        const article = await db.collection('articles_raw').findOne(
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
