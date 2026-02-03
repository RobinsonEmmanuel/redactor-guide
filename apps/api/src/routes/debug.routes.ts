import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';

/**
 * Routes de diagnostic pour débugger la génération de sommaire
 */
export async function debugRoutes(fastify: FastifyInstance) {
  /**
   * GET /debug/guide/:guideId/sommaire-check
   * Vérifier toutes les conditions pour la génération de sommaire
   */
  fastify.get('/debug/guide/:guideId/sommaire-check', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const db = request.server.container.db;

    const result: any = {
      guideId,
      checks: {},
      errors: [],
      warnings: [],
    };

    try {
      // 1. Vérifier le guide
      result.checks.guide = { status: 'checking' };
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      
      if (!guide) {
        result.checks.guide = { status: 'error', message: 'Guide non trouvé' };
        result.errors.push('Guide non trouvé');
        return reply.send(result);
      }

      result.checks.guide = {
        status: 'ok',
        data: {
          name: guide.name,
          destination: guide.destination,
          wpConfig: guide.wpConfig ? {
            siteUrl: guide.wpConfig.siteUrl,
            hasToken: !!guide.wpConfig.jwtToken,
          } : null,
        },
      };

      // 2. Vérifier la destination
      result.checks.destination = { status: 'checking' };
      if (!guide.destination) {
        result.checks.destination = { status: 'error', message: 'Aucune destination définie' };
        result.errors.push('Aucune destination définie pour ce guide');
      } else {
        result.checks.destination = { status: 'ok', value: guide.destination };
      }

      // 3. Vérifier wpConfig
      result.checks.wpConfig = { status: 'checking' };
      if (!guide.wpConfig?.siteUrl) {
        result.checks.wpConfig = { status: 'error', message: 'Aucun site WordPress configuré' };
        result.errors.push('Aucun site WordPress configuré pour ce guide');
        return reply.send(result);
      }

      result.checks.wpConfig = { status: 'ok', siteUrl: guide.wpConfig.siteUrl };

      // 4. Vérifier le site
      result.checks.site = { status: 'checking' };
      const site = await db.collection('sites').findOne({ url: guide.wpConfig.siteUrl });
      
      if (!site) {
        result.checks.site = { 
          status: 'error', 
          message: `Site non trouvé dans la collection sites pour l'URL: ${guide.wpConfig.siteUrl}`,
          suggestion: 'Créer un document dans la collection "sites" avec { url: "' + guide.wpConfig.siteUrl + '" }',
        };
        result.errors.push('Site WordPress non trouvé dans la base');
        return reply.send(result);
      }

      result.checks.site = {
        status: 'ok',
        data: {
          _id: site._id.toString(),
          url: site.url,
          name: site.name,
        },
      };

      // 5. Vérifier les articles
      result.checks.articles = { status: 'checking' };
      const articlesTotal = await db.collection('articles_raw').countDocuments({
        site_id: site._id.toString(),
      });

      const articlesWithDestination = await db.collection('articles_raw').countDocuments({
        site_id: site._id.toString(),
        categories: { $in: [guide.destination] },
      });

      if (articlesTotal === 0) {
        result.checks.articles = {
          status: 'error',
          message: `Aucun article trouvé pour le site_id: ${site._id.toString()}`,
          suggestion: 'Récupérer les articles WordPress depuis l\'onglet "Articles"',
        };
        result.errors.push('Aucun article WordPress ingéré');
        return reply.send(result);
      }

      if (articlesWithDestination === 0) {
        result.checks.articles = {
          status: 'error',
          message: `${articlesTotal} articles trouvés, mais AUCUN avec la catégorie "${guide.destination}"`,
          suggestion: `Vérifier que les articles WordPress ont la catégorie "${guide.destination}" (sensible à la casse)`,
        };
        result.errors.push(`Aucun article avec la destination "${guide.destination}"`);
        
        // Lister les catégories disponibles
        const allArticles = await db.collection('articles_raw')
          .find({ site_id: site._id.toString() })
          .limit(10)
          .toArray();
        
        const allCategories = new Set<string>();
        allArticles.forEach((article: any) => {
          article.categories?.forEach((cat: string) => allCategories.add(cat));
        });

        result.checks.articles.availableCategories = Array.from(allCategories);
        return reply.send(result);
      }

      result.checks.articles = {
        status: 'ok',
        total: articlesTotal,
        withDestination: articlesWithDestination,
        message: `${articlesWithDestination} articles trouvés avec la destination "${guide.destination}"`,
      };

      // 6. Vérifier les prompts
      result.checks.prompts = { status: 'checking' };
      const promptSections = await db.collection('prompts').findOne({ intent: 'structure_sections', actif: true });
      const promptPOIs = await db.collection('prompts').findOne({ intent: 'selection_pois', actif: true });
      const promptInspirations = await db.collection('prompts').findOne({ intent: 'pages_inspiration', actif: true });

      const missingPrompts = [];
      if (!promptSections) missingPrompts.push('structure_sections');
      if (!promptPOIs) missingPrompts.push('selection_pois');
      if (!promptInspirations) missingPrompts.push('pages_inspiration');

      if (missingPrompts.length > 0) {
        result.checks.prompts = {
          status: 'error',
          message: `Prompts manquants: ${missingPrompts.join(', ')}`,
          suggestion: 'Appeler POST /api/v1/prompts/seed-sommaire pour créer les prompts',
        };
        result.errors.push('Prompts de sommaire non créés');
      } else {
        result.checks.prompts = {
          status: 'ok',
          message: 'Les 3 prompts sont configurés',
        };
      }

      // 7. Vérifier OpenAI API Key
      result.checks.openai = { status: 'checking' };
      if (!process.env.OPENAI_API_KEY) {
        result.checks.openai = {
          status: 'error',
          message: 'OPENAI_API_KEY non configurée',
          suggestion: 'Ajouter OPENAI_API_KEY dans les variables d\'environnement Railway',
        };
        result.errors.push('OPENAI_API_KEY manquante');
      } else {
        result.checks.openai = {
          status: 'ok',
          message: 'OPENAI_API_KEY configurée',
          keyPrefix: process.env.OPENAI_API_KEY.substring(0, 10) + '...',
        };
      }

      // Résumé
      result.summary = {
        ready: result.errors.length === 0,
        errors: result.errors.length,
        warnings: result.warnings.length,
      };

      if (result.summary.ready) {
        result.message = '✅ Toutes les conditions sont remplies. La génération du sommaire devrait fonctionner.';
      } else {
        result.message = `❌ ${result.errors.length} erreur(s) empêchent la génération du sommaire.`;
      }

      return reply.send(result);

    } catch (error: any) {
      result.error = error.message;
      return reply.status(500).send(result);
    }
  });
}
