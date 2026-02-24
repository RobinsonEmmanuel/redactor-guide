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

      // Garde anti-doublon : refuser si un autre job est déjà en cours pour ce guide
      const existingProcessing = await db.collection('pois_generation_jobs').findOne({
        guide_id: guideId,
        status: 'processing',
        _id: { $ne: new ObjectId(jobId) },
        // Ignorer les jobs bloqués depuis plus de 30 minutes
        updated_at: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      });
      if (existingProcessing) {
        console.warn(`⚠️ [WORKER] Job ${existingProcessing._id} déjà en cours pour guide ${guideId} — abandon du doublon ${jobId}`);
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'failed', error: 'Doublon : un job est déjà en cours', updated_at: new Date() } }
        );
        return reply.send({ success: false, reason: 'duplicate' });
      }

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

      // 3. Charger les prompts depuis la DB par leur ID unique
      const PROMPT_ID_EXTRACTION = process.env.PROMPT_ID_POI_EXTRACTION ?? 'prompt_1770544848350_9j5m305ukj';
      const PROMPT_ID_DEDUP      = process.env.PROMPT_ID_POI_DEDUP      ?? 'deduplication_POI_24022026';

      const promptExtractionDoc = await db.collection('prompts').findOne({ prompt_id: PROMPT_ID_EXTRACTION });
      if (!promptExtractionDoc) {
        throw new Error(`Prompt d'extraction POI non trouvé (id: ${PROMPT_ID_EXTRACTION})`);
      }
      console.log(`📋 Prompt extraction: ${promptExtractionDoc.prompt_nom || promptExtractionDoc.prompt_id}`);

      // Prompt de déduplication (optionnel — fallback intégré si absent)
      const promptDedupDoc = await db.collection('prompts').findOne({ prompt_id: PROMPT_ID_DEDUP });
      if (promptDedupDoc) {
        console.log(`📋 Prompt dédup: ${promptDedupDoc.prompt_nom || promptDedupDoc.prompt_id}`);
      } else {
        console.log(`📋 Prompt dédup: id "${PROMPT_ID_DEDUP}" non trouvé, utilisation du prompt par défaut`);
      }

      // 4. Traitement par batch de 5 articles — 1 appel OpenAI par batch
      const BATCH_SIZE = 5;
      const allRawPois: any[] = [];
      const total = articles.length;
      const totalBatches = Math.ceil(total / BATCH_SIZE);

      console.log(`📊 ${total} articles → ${totalBatches} batches de ${BATCH_SIZE}`);

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchNum = batchIdx + 1;

        // Vérifier à chaque batch si le job a été annulé
        const currentJob = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
        if (!currentJob || currentJob.status === 'cancelled') {
          console.log(`🛑 [WORKER] Job ${jobId} annulé — arrêt à batch ${batchNum}/${totalBatches}`);
          return reply.send({ success: false, reason: 'cancelled' });
        }

        const batchArticles = articles.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE) as any[];
        const firstArticleNum = batchIdx * BATCH_SIZE + 1;

        console.log(`🔄 Batch ${batchNum}/${totalBatches} — articles ${firstArticleNum}-${firstArticleNum + batchArticles.length - 1}`);

        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'processing', progress: `Batch ${batchNum}/${totalBatches}`, updated_at: new Date() } }
        );

        // Filtrer les articles vides
        const validArticles = batchArticles.filter((a: any) => (a.markdown || '').trim());
        if (validArticles.length === 0) {
          console.log(`  ⚠️ Batch ${batchNum}: tous les articles sont vides, ignoré`);
          continue;
        }

        // Construire le contenu groupé avec liste des titres + URLs en en-tête
        // pour que le modèle utilise les bons article_source dans sa réponse
        const articlesIndex = validArticles
          .map((a: any, idx: number) => `${idx + 1}. "${a.title}" — ${a.url || a.slug}`)
          .join('\n');

        const batchContent = validArticles
          .map((a: any, idx: number) =>
            `### Article ${idx + 1} : ${a.title}\nURL : ${a.url || a.slug}\n\n${a.markdown}`
          )
          .join('\n\n---\n\n');

        // Construire un article_source lookup pour la correction post-réponse
        const articleByTitle: Record<string, any> = {};
        const articleByUrl: Record<string, any> = {};
        for (const a of validArticles) {
          articleByTitle[a.title.toLowerCase()] = a;
          if (a.url) articleByUrl[a.url] = a;
          if (a.slug) articleByUrl[a.slug] = a;
        }

        const extractionPrompt = openaiService.replaceVariables(promptExtractionDoc.texte_prompt, {
          SITE: guide.wpConfig?.siteUrl || '',
          DESTINATION: destination,
          ARTICLE_TITRE: `Lot de ${validArticles.length} articles (batch ${batchNum}/${totalBatches})`,
          ARTICLE_URL: '',
          ARTICLE_CONTENU: `Articles analysés :\n${articlesIndex}\n\n---\n\n${batchContent}`,
          LISTE_ARTICLES_POI: validArticles.map((a: any) => `- ${a.title} (${a.url || a.slug})`).join('\n'),
        });

        try {
          // max_tokens élevé : un batch dense (ex: Teide) peut produire 30+ POIs × ~200 chars
          const result = await openaiService.generateJSON(extractionPrompt, 24000);

          if (result.pois && Array.isArray(result.pois)) {
            const enriched = result.pois.map((poi: any) => {
              // Corriger article_source si l'IA a renvoyé le titre du batch ou une valeur invalide
              const isBatchTitle = !poi.article_source ||
                poi.article_source.startsWith('Batch ') ||
                poi.article_source.startsWith('Lot de ');

              if (isBatchTitle || !poi.url_source) {
                // Chercher l'article réel par correspondance de titre ou URL
                const matchByUrl = poi.url_source && (articleByUrl[poi.url_source]);
                const matchByTitle = poi.article_source &&
                  validArticles.find((a: any) =>
                    a.title.toLowerCase().includes(poi.article_source.toLowerCase().substring(0, 20))
                  );
                const fallback = matchByUrl || matchByTitle || validArticles[0];
                return {
                  ...poi,
                  article_source: isBatchTitle ? fallback.title : poi.article_source,
                  url_source: poi.url_source && !isBatchTitle ? poi.url_source : (fallback.url || fallback.slug),
                };
              }
              return poi;
            });
            allRawPois.push(...enriched);
            console.log(`  ✅ Batch ${batchNum}: ${enriched.length} POIs (total: ${allRawPois.length})`);
          }
        } catch (batchError: any) {
          console.error(`  ❌ Batch ${batchNum} échoué: ${batchError.message} — on continue`);
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

      const dedupPrompt = promptDedupDoc
        ? openaiService.replaceVariables(promptDedupDoc.texte_prompt, {
            DESTINATION: destination,
            NB_POIS: String(allRawPois.length),
            POIS_BRUTS_JSON: poisJson,
          })
        : `Tu es un expert en consolidation de bases de données géographiques.

Voici ${allRawPois.length} POIs extraits article par article depuis des articles sur ${destination}.
Certains POIs apparaissent en double ou en triple (même lieu dans plusieurs articles, variantes orthographiques, noms en différentes langues, etc.).

LISTE DES POIS BRUTS :
${poisJson}

Tâche :
1. Identifie les doublons EXACTS (même poi_id ou même nom)
2. Identifie les doublons APPROCHANTS (même lieu sous des appellations différentes, ex: "Teide" / "Pico del Teide" / "Mont Teide" / "Parc national du Teide")
3. Pour chaque groupe de doublons, conserve le POI le plus complet et fusionne :
   - "autres_articles_mentions" : réunion de toutes les url_source / article_source
   - "article_source" / "url_source" : garde le plus représentatif (article dédié > article liste)
4. Conserve TOUS les POIs uniques sans en supprimer

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
