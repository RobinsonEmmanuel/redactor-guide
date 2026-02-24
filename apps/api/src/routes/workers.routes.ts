import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { PageRedactionService } from '../services/page-redaction.service';
import { JsonTranslatorService } from '../services/json-translator.service';

export async function workersRoutes(fastify: FastifyInstance) {
  /**
   * POST /workers/generate-page-content
   * Worker pour générer le contenu d'une page via IA
   * Appelé par QStash de manière asynchrone
   */
  fastify.post('/workers/generate-page-content', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, pageId } = request.body as { guideId: string; pageId: string };

    try {
      console.log(`🚀 [WORKER] Génération contenu page ${pageId}`);

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      // Générer le contenu via IA (avec retry automatique intégré)
      const redactionService = new PageRedactionService(db, openaiApiKey);
      const result = await redactionService.generatePageContent(guideId, pageId);

      // Déterminer le statut éditorial selon le résultat
      let statutEditorial = 'draft';
      let commentaire: string | undefined;

      if (result.status === 'success') {
        statutEditorial = 'generee_ia';
        commentaire = result.retryCount && result.retryCount > 0
          ? `Généré avec succès après ${result.retryCount} tentative(s)`
          : undefined;
        console.log(`✅ [WORKER] Génération réussie après ${result.retryCount || 0} retry(s)`);
      } else if (result.validationErrors && result.validationErrors.length > 0) {
        // Validation échouée après retries
        statutEditorial = 'non_conforme';
        const failedFieldsSummary = result.validationErrors
          .map((e) => `${e.field} (${e.errors.length} erreur(s))`)
          .join(', ');
        commentaire = `Validation échouée après ${result.retryCount || 0} tentative(s): ${failedFieldsSummary}`;
        console.error(`❌ [WORKER] Validation non conforme:`, commentaire);
      } else {
        // Autre erreur
        statutEditorial = 'non_conforme';
        commentaire = `Erreur IA: ${result.error || 'Erreur inconnue'}`;
        console.error(`❌ [WORKER] Erreur génération:`, commentaire);
      }

      // Sauvegarder le contenu généré (même si validation échoue, pour permettre édition manuelle)
      await db.collection('pages').updateOne(
        { _id: new ObjectId(pageId) },
        { 
          $set: { 
            content: result.content,
            statut_editorial: statutEditorial,
            ...(commentaire && { commentaire_interne: commentaire }),
            updated_at: new Date().toISOString() 
          } 
        }
      );

      console.log(`✅ [WORKER] Contenu sauvegardé pour page ${pageId} (statut: ${statutEditorial})`);

      return reply.send({ 
        success: result.status === 'success', 
        pageId,
        fieldsGenerated: Object.keys(result.content).length,
        statutEditorial,
        retryCount: result.retryCount || 0,
        validationErrors: result.validationErrors
      });
    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur fatale:`, error);
      
      // Marquer la page en erreur
      try {
        await db.collection('pages').updateOne(
          { _id: new ObjectId(pageId) },
          { 
            $set: { 
              statut_editorial: 'non_conforme',
              commentaire_interne: `Erreur worker: ${error.message}`,
              updated_at: new Date().toISOString() 
            } 
          }
        );
      } catch (dbError) {
        console.error('Erreur mise à jour statut:', dbError);
      }

      return reply.status(500).send({ 
        error: 'Erreur lors de la génération',
        details: error.message 
      });
    }
  });

  /**
   * POST /workers/generate-pois
   * Worker pour générer les POIs depuis les articles WordPress via IA
   * Appelé par QStash de manière asynchrone
   */
  fastify.post('/workers/generate-pois', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    try {
      console.log(`🚀 [WORKER] Génération POIs pour guide ${guideId}`);

      // Marquer le job comme "processing"
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'processing', updated_at: new Date() } }
      );

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      // Importer les services nécessaires
      const { OpenAIService } = await import('../services/openai.service');
      const { GeocodingService } = await import('../services/geocoding.service');
      
      const openaiService = new OpenAIService({
        apiKey: openaiApiKey,
        model: 'gpt-5-mini',
        reasoningEffort: 'low', // low suffit pour l'extraction structurée de POIs
      });
      const geocodingService = new GeocodingService();

      // 1. Charger le guide
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      if (!guide) {
        throw new Error('Guide non trouvé');
      }

      const destination = guide.destination;
      if (!destination) {
        throw new Error('Aucune destination définie pour ce guide');
      }

      // 2. Récupérer les articles WordPress filtrés par destination (regex insensible à la casse)
      const destinationFilter = destination
        ? { categories: { $regex: destination, $options: 'i' } }
        : {};

      const articles = await db
        .collection('articles_raw')
        .find(destinationFilter)
        .project({ title: 1, slug: 1, markdown: 1, url: 1, urls_by_lang: 1 })
        .toArray();

      if (articles.length === 0) {
        throw new Error(`Aucun article WordPress trouvé pour la destination "${destination}"`);
      }

      console.log(`📚 ${articles.length} articles chargés pour "${destination}"`);

      // 3. Formater les articles pour l'IA
      const articlesFormatted = articles.map((a: any) => ({
        title: a.title,
        slug: a.slug,
        content: a.markdown?.substring(0, 5000) || '', // Limiter à 5000 caractères par article
      }));

      const listeArticles = articlesFormatted
        .map((a: any) => `- ${a.title} (${a.slug})`)
        .join('\n');

      // 4. Charger le prompt système pour l'identification des lieux (Étape 3)
      const promptPOI = await db.collection('prompts').findOne({ 
        categories: { $all: ['lieux', 'poi', 'sommaire'] },
        actif: true 
      });

      if (!promptPOI) {
        throw new Error('Prompt de sélection des lieux non trouvé');
      }

      console.log(`📋 Utilisation du prompt: ${promptPOI.prompt_nom || promptPOI.prompt_id}`);

      const prompt = openaiService.replaceVariables(promptPOI.texte_prompt, {
        SITE: guide.wpConfig?.siteUrl || '',
        DESTINATION: destination,
        LISTE_ARTICLES_POI: listeArticles,
      });

      // 5. Générer les POIs via OpenAI
      console.log('🤖 Appel OpenAI pour génération POIs...');
      const result = await openaiService.generateJSON(prompt, 12000);

      if (!result.pois || !Array.isArray(result.pois)) {
        throw new Error('Format de réponse invalide');
      }

      console.log(`✅ ${result.pois.length} POI(s) généré(s)`);

      // 6. Enrichir avec géolocalisation
      const pays = geocodingService.getCountryFromDestination(destination);
      const poisWithCoords: any[] = [];

      for (const poi of result.pois) {
        const coordsResult = await geocodingService.geocodePlace(poi.nom, pays);
        
        poisWithCoords.push({
          poi_id: poi.poi_id,
          nom: poi.nom,
          type: poi.type,
          source: 'article',
          article_source: poi.article_source,
          raison_selection: poi.raison_selection,
          autres_articles_mentions: poi.autres_articles_mentions || [],
          coordinates: coordsResult || undefined,
        });

        // Rate limiting Nominatim (1 req/sec)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`📍 ${poisWithCoords.filter(p => p.coordinates).length}/${poisWithCoords.length} POI(s) géolocalisé(s)`);

      // 7. Sauvegarder la sélection
      const now = new Date();
      await db.collection('pois_selection').updateOne(
        { guide_id: guideId },
        {
          $set: {
            guide_id: guideId,
            pois: poisWithCoords,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
        },
        { upsert: true }
      );

      // 8. Marquer le job comme "completed"
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { 
          $set: { 
            status: 'completed', 
            count: poisWithCoords.length,
            updated_at: new Date() 
          } 
        }
      );

      console.log(`✅ [WORKER] POIs sauvegardés pour guide ${guideId}`);

      return reply.send({ 
        success: true, 
        count: poisWithCoords.length 
      });

    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur génération POIs:`, error);
      
      // Marquer le job comme "failed"
      try {
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { 
            $set: { 
              status: 'failed',
              error: error.message,
              updated_at: new Date() 
            } 
          }
        );
      } catch (dbError) {
        console.error('Erreur mise à jour statut job:', dbError);
      }

      return reply.status(500).send({ 
        error: 'Erreur lors de la génération des POIs',
        details: error.message 
      });
    }
  });

  /**
   * POST /workers/translate-json
   * Worker pour traduire un JSON (appelé par QStash)
   */
  fastify.post('/workers/translate-json', async (request, reply) => {
    const db = request.server.container.db;
    const { jobId } = request.body as { jobId: string };

    try {
      console.log(`🚀 [WORKER] Traduction JSON job ${jobId}`);

      if (!ObjectId.isValid(jobId)) {
        throw new Error('Job ID invalide');
      }

      // Charger le job
      const job = await db.collection('translation_jobs').findOne({
        _id: new ObjectId(jobId),
      });

      if (!job) {
        throw new Error('Job non trouvé');
      }

      // Marquer comme "en cours"
      await db.collection('translation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { 
          $set: { 
            status: 'processing', 
            updated_at: new Date().toISOString() 
          } 
        }
      );

      // Traduire via ChatGPT
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      const translator = new JsonTranslatorService(openaiApiKey);
      const result = await translator.translateJson(job.input_json);

      if (result.success) {
        // Succès
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'completed',
              output_json: result.translatedJson,
              stats: result.stats,
              updated_at: new Date().toISOString(),
            },
          }
        );

        console.log(`✅ [WORKER] Traduction terminée pour job ${jobId}`);
        return reply.send({ success: true, stats: result.stats });
      } else {
        // Erreur
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'failed',
              error: result.error,
              stats: result.stats,
              updated_at: new Date().toISOString(),
            },
          }
        );

        console.error(`❌ [WORKER] Traduction échouée pour job ${jobId}:`, result.error);
        return reply.status(500).send({
          error: 'Traduction échouée',
          details: result.error,
        });
      }
    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur traduction job ${jobId}:`, error);

      // Marquer comme "failed"
      if (ObjectId.isValid(jobId)) {
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'failed',
              error: error.message,
              updated_at: new Date().toISOString(),
            },
          }
        );
      }

      return reply.status(500).send({
        error: 'Erreur lors de la traduction',
        details: error.message,
      });
    }
  });
}
