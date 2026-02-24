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
   * Traitement par batch pour un recensement exhaustif, suivi d'un appel de déduplication.
   * Appelé par QStash de manière asynchrone
   */
  fastify.post('/workers/generate-pois', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    try {
      console.log(`🚀 [WORKER] Génération POIs par batch pour guide ${guideId}`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'processing', updated_at: new Date() } }
      );

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      const { OpenAIService } = await import('../services/openai.service');

      const openaiService = new OpenAIService({
        apiKey: openaiApiKey,
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
      });

      // 1. Charger le guide
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      if (!guide) throw new Error('Guide non trouvé');

      const destination: string = guide.destination;
      if (!destination) throw new Error('Aucune destination définie pour ce guide');

      // 2. Récupérer les articles WordPress filtrés par destination
      const destinationFilter = { categories: { $regex: destination, $options: 'i' } };

      const articles = await db
        .collection('articles_raw')
        .find(destinationFilter)
        .project({ title: 1, slug: 1, markdown: 1, url: 1 })
        .toArray();

      if (articles.length === 0) {
        throw new Error(`Aucun article WordPress trouvé pour la destination "${destination}"`);
      }

      console.log(`📚 ${articles.length} articles chargés pour "${destination}"`);

      // 3. Traitement article par article — 1 appel OpenAI par article
      const allRawPois: any[] = [];
      const total = articles.length;

      for (let i = 0; i < total; i++) {
        const article = articles[i] as any;
        const articleNum = i + 1;

        console.log(`🔄 Article ${articleNum}/${total}: "${article.title}"`);

        // Mise à jour du statut toutes les 5 articles pour ne pas surcharger la DB
        if (articleNum === 1 || articleNum % 5 === 0 || articleNum === total) {
          await db.collection('pois_generation_jobs').updateOne(
            { _id: new ObjectId(jobId) },
            {
              $set: {
                status: 'processing',
                progress: `Article ${articleNum}/${total}`,
                updated_at: new Date(),
              },
            }
          );
        }

        const content = article.markdown || '';
        if (!content.trim()) {
          console.log(`  ⚠️ Article ${articleNum}: contenu vide, ignoré`);
          continue;
        }

        const extractionPrompt = `Tu es un expert en extraction de Points d'Intérêt (POI) depuis des articles de voyage.

DESTINATION : ${destination}
ARTICLE : ${article.title}
URL : ${article.url || article.slug}

Analyse l'article ci-dessous et extrais TOUS les POIs mentionnés :
lieux touristiques, plages, parcs, musées, restaurants, hôtels, bars, activités, randonnées, marchés, miradors, quartiers, villages, etc.
Sois exhaustif — cet article peut citer des dizaines de POIs.

---
${content}
---

Pour chaque POI retourne :
- poi_id : identifiant unique en snake_case (ex: "playa_las_teresitas")
- nom : nom officiel du lieu
- type : "attraction" | "plage" | "parc" | "musee" | "restaurant" | "hotel" | "bar" | "activite" | "randonnee" | "marche" | "mirador" | "quartier" | "village" | "autre"
- article_source : "${article.title}"
- url_source : "${article.url || article.slug}"
- raison_selection : pourquoi ce POI mérite d'être recensé (1 phrase courte)

Retourne UNIQUEMENT un JSON valide : { "pois": [ ... ] }
Si aucun POI identifiable, retourne : { "pois": [] }`;

        try {
          const result = await openaiService.generateJSON(extractionPrompt, 4000);

          if (result.pois && Array.isArray(result.pois)) {
            allRawPois.push(...result.pois);
            console.log(`  ✅ ${result.pois.length} POIs (total: ${allRawPois.length})`);
          }
        } catch (articleError: any) {
          console.error(`  ❌ Article ${articleNum} échoué: ${articleError.message} — on continue`);
        }
      }

      if (allRawPois.length === 0) {
        throw new Error('Aucun POI extrait depuis les articles');
      }

      console.log(`📊 Total POIs bruts extraits (avant déduplication): ${allRawPois.length}`);

      // 5. Appel de déduplication (exact + approchant)
      console.log(`🔄 Déduplication de ${allRawPois.length} POIs...`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'processing', progress: 'Déduplication', updated_at: new Date() } }
      );

      const poisJson = JSON.stringify(allRawPois, null, 0);

      const dedupPrompt = `Tu es un expert en consolidation de bases de données géographiques.

Voici ${allRawPois.length} POIs extraits par batches depuis des articles sur ${destination}.
Certains POIs apparaissent en double ou en triple (même lieu cité dans plusieurs articles avec des noms légèrement différents, variantes orthographiques, noms en différentes langues, etc.).

LISTE DES POIS BRUTS :
${poisJson}

Tâche :
1. Identifie les doublons EXACTS (même poi_id ou même nom)
2. Identifie les doublons APPROCHANTS (même lieu sous des appellations différentes, ex: "Teide" / "Pico del Teide" / "Mont Teide" / "Parc national du Teide")
3. Pour chaque groupe de doublons, conserve le POI le plus complet et fusionne :
   - "autres_articles_mentions" : réunion de toutes les sources
   - "article_source" / "url_source" : garde le plus représentatif
4. Conserve TOUS les POIs uniques, ne supprime rien d'autre que les doublons

Retourne UNIQUEMENT un JSON valide : { "pois": [ ... ] }
(même structure que l'entrée, après fusion)`;

      let finalPois: any[] = allRawPois;

      try {
        const dedupResult = await openaiService.generateJSON(dedupPrompt, 16000);
        if (dedupResult.pois && Array.isArray(dedupResult.pois)) {
          finalPois = dedupResult.pois;
          const removed = allRawPois.length - finalPois.length;
          console.log(`✅ Déduplication: ${finalPois.length} POIs uniques (${removed} doublons supprimés)`);
        } else {
          console.warn('⚠️ Déduplication: réponse inattendue, on garde les POIs bruts');
        }
      } catch (dedupError: any) {
        console.error(`❌ Déduplication échouée: ${dedupError.message} — on conserve les POIs bruts`);
      }

      // 6. Normaliser les POIs
      const pois: any[] = finalPois.map((poi: any) => ({
        poi_id: poi.poi_id,
        nom: poi.nom,
        type: poi.type,
        source: 'article',
        article_source: poi.article_source,
        url_source: poi.url_source || '',
        raison_selection: poi.raison_selection,
        autres_articles_mentions: poi.autres_articles_mentions || [],
      }));

      // 7. Sauvegarder la sélection
      const now = new Date();
      await db.collection('pois_selection').updateOne(
        { guide_id: guideId },
        {
          $set: { guide_id: guideId, pois, updated_at: now },
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );

      // 8. Marquer le job comme "completed"
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'completed',
            count: pois.length,
            raw_count: allRawPois.length,
            progress: null,
            updated_at: new Date(),
          },
        }
      );

      console.log(`✅ [WORKER] ${pois.length} POIs sauvegardés pour guide ${guideId} (${allRawPois.length} extraits, ${allRawPois.length - pois.length} doublons supprimés)`);

      return reply.send({
        success: true,
        count: pois.length,
        raw_count: allRawPois.length,
        articles_processed: total,
      });

    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur génération POIs:`, error);

      try {
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'failed', error: error.message, progress: null, updated_at: new Date() } }
        );
      } catch (dbError) {
        console.error('Erreur mise à jour statut job:', dbError);
      }

      return reply.status(500).send({
        error: 'Erreur lors de la génération des POIs',
        details: error.message,
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
