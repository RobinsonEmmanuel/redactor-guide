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

      // ─── Helper : extraction H2/H3 (utilisé pour les articles multi-POI) ──────

      function extractHeadings(markdown: string): string[] {
        return markdown
          .split('\n')
          .filter(line => /^#{2,3}\s/.test(line))
          .map(line => line.replace(/^#{2,3}\s+/, '').trim())
          .filter(h => h.length > 2);
      }

      // ─── 4. Classification IA des articles ──────────────────────────────────
      // Payload ultra-léger : on envoie uniquement les titres

      console.log(`🤖 Classification IA de ${(articles as any[]).length} articles...`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { progress: `Classification IA de ${(articles as any[]).length} articles...`, updated_at: new Date() } }
      );

      const articleTitlesList = (articles as any[])
        .map((a: any, i: number) => `${i}. ${a.title}`)
        .join('\n');

      const classificationSystemPrompt = `Tu es un expert en contenu touristique. Classifie chaque article dans l'une de ces 3 catégories :

- "mono" : l'article est entièrement consacré à UN SEUL lieu touristique précis et localisable (une plage spécifique, un site naturel, un monument, un village, une piscine naturelle, un mirador, un belvédère, etc.). Le nom du lieu principal est dans le titre.
- "multi" : l'article présente ou liste PLUSIEURS lieux touristiques distincts (guides "que faire à X", tops N lieux, itinéraires, listes de plages/jardins/villages, "pourquoi visiter", etc.)
- "exclude" : l'article ne génère pas de POI pertinent pour un guide touristique. Exemples : hôtels/hébergements/apparthotels, transport/location de voiture/comment se déplacer, météo/saisons/quand partir/combien de jours, guides pratiques généraux, comparaisons de destinations.

Pour les articles "mono", indique également le poi_name : le nom propre du lieu, sans les suffixes descriptifs comme "conseils + photos", "avis + photos", etc.

Retourne STRICTEMENT un objet JSON valide, sans texte additionnel :
{ "classifications": [{ "index": 0, "type": "mono|multi|exclude", "poi_name": "string ou null", "reason": "explication courte" }] }`;

      let aiClassifications: Array<{ index: number; type: 'mono' | 'multi' | 'exclude'; poi_name: string | null; reason: string }> = [];

      try {
        const classifResult = await openaiService.generateJSON(
          `${classificationSystemPrompt}\n\nArticles à classifier :\n${articleTitlesList}`,
          8000
        );
        aiClassifications = (classifResult as any).classifications || [];
        console.log(`✅ Classification IA : ${aiClassifications.length} articles classifiés`);
      } catch (err: any) {
        console.error(`❌ Erreur classification IA : ${err.message} — fallback classification "multi" pour tous`);
        aiClassifications = (articles as any[]).map((_: any, i: number) => ({
          index: i, type: 'multi' as const, poi_name: null, reason: 'fallback (erreur IA)',
        }));
      }

      const monoArticles: any[] = [];
      const multiArticles: any[] = [];
      const excludedArticles: any[] = [];
      const classificationLog: any[] = [];

      for (let i = 0; i < (articles as any[]).length; i++) {
        const article = (articles as any[])[i];
        const classif = aiClassifications.find(c => c.index === i) || { type: 'multi', poi_name: null, reason: 'non classifié' };
        const headings = classif.type === 'multi' ? extractHeadings(article.markdown || '') : [];

        classificationLog.push({
          title: article.title,
          url: article.url || article.slug,
          type: classif.type,
          reason: classif.reason,
          poiName: classif.poi_name || undefined,
          headingCount: headings.length || undefined,
        });

        if (classif.type === 'mono') {
          monoArticles.push({ ...article, _poi_name: classif.poi_name || article.title, _classification: classif });
        } else if (classif.type === 'multi') {
          multiArticles.push({ ...article, _headings: headings, _classification: classif });
        } else {
          excludedArticles.push({ ...article, _classification: classif });
        }
      }

      console.log(`📊 Classification: ${monoArticles.length} mono-POI, ${multiArticles.length} multi-POI, ${excludedArticles.length} exclus`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            classification_log: classificationLog,
            mono_count: monoArticles.length,
            multi_count: multiArticles.length,
            excluded_count: excludedArticles.length,
            updated_at: new Date(),
          },
        }
      );

      const allRawPois: any[] = [];
      const previewBatches: any[] = [];

      // ─── 5a. Articles mono-POI : extraction directe, sans IA ────────────────

      for (const article of monoArticles) {
        const poiName = article._poi_name || article.title;
        allRawPois.push({
          poi_id: poiName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
          nom: poiName,
          type: 'site_naturel',
          article_source: article.title,
          url_source: article.url || article.slug,
          mentions: 'principale',
          raison_selection: `Article dédié : "${article.title}"`,
          autres_articles_mentions: [],
          _extraction_mode: 'mono',
        });
      }

      console.log(`✅ Mono-POI: ${monoArticles.length} POIs extraits directement`);

      // Sauvegarde intermédiaire des mono-POIs
      if (monoArticles.length > 0) {
        previewBatches.push({
          batch_num: 0,
          total_batches: 0,
          label: `${monoArticles.length} articles mono-POI (extraction directe)`,
          articles: monoArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug })),
          pois: allRawPois.filter(p => p._extraction_mode === 'mono'),
          is_mono_batch: true,
        });
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { preview_pois: [...allRawPois], preview_batches: [...previewBatches], updated_at: new Date() } }
        );
      }

      // ─── 5b. Articles multi-POI : extraction par batch via IA ───────────────

      const BATCH_SIZE = 5;
      const total = multiArticles.length;
      const totalBatches = Math.ceil(total / BATCH_SIZE);

      console.log(`📊 Multi-POI: ${total} articles → ${totalBatches} batches de ${BATCH_SIZE}`);

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchNum = batchIdx + 1;

        // Vérifier à chaque batch si le job a été annulé
        const currentJob = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
        if (!currentJob || currentJob.status === 'cancelled') {
          console.log(`🛑 [WORKER] Job ${jobId} annulé — arrêt à batch ${batchNum}/${totalBatches}`);
          return reply.send({ success: false, reason: 'cancelled' });
        }

        const batchArticles = multiArticles.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE) as any[];
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

        // Construire le contenu : index + H2/H3 de chaque article (pas le contenu complet)
        const articlesIndex = validArticles
          .map((a: any, idx: number) => `${idx + 1}. "${a.title}" — ${a.url || a.slug}`)
          .join('\n');

        const batchContent = validArticles
          .map((a: any, idx: number) => {
            const headings = extractHeadings(a.markdown || '');
            const headingsBlock = headings.length > 0
              ? `H2/H3 détectés :\n${headings.map(h => `  - ${h}`).join('\n')}`
              : '(aucun titre H2/H3 détecté)';
            return `### Article ${idx + 1} : ${a.title}\nURL : ${a.url || a.slug}\n${headingsBlock}`;
          })
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
          ARTICLE_TITRE: `Lot de ${validArticles.length} articles multi-POI (batch ${batchNum}/${totalBatches})`,
          ARTICLE_URL: '',
          ARTICLE_CONTENU: `Articles analysés :\n${articlesIndex}\n\n---\n\n${batchContent}`,
          ARTICLE_H2_H3: validArticles
            .map((a: any) => {
              const h = extractHeadings(a.markdown || '');
              return `"${a.title}":\n${h.map(x => `  - ${x}`).join('\n') || '  (aucun)'}`;
            })
            .join('\n\n'),
          LISTE_ARTICLES_POI: validArticles.map((a: any) => `- ${a.title} (${a.url || a.slug})`).join('\n'),
        });

        const MAX_RETRIES = 3;
        let batchSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 1) {
              const delay = attempt * 5000; // 5s, 10s entre les retries
              console.log(`  ⏳ Batch ${batchNum} — retry ${attempt}/${MAX_RETRIES} dans ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }

            // max_tokens élevé : un batch dense (ex: Teide) peut produire 30+ POIs × ~200 chars
            const result = await openaiService.generateJSON(extractionPrompt, 24000);

            if (result.pois && Array.isArray(result.pois)) {
              const enriched = result.pois.map((poi: any) => {
                // Corriger article_source si l'IA a renvoyé le titre du batch ou une valeur invalide
                const isBatchTitle = !poi.article_source ||
                  poi.article_source.startsWith('Batch ') ||
                  poi.article_source.startsWith('Lot de ');

                if (isBatchTitle || !poi.url_source) {
                  const matchByUrl = poi.url_source && articleByUrl[poi.url_source];
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
              const enrichedWithMode = enriched.map((p: any) => ({ ...p, _extraction_mode: 'multi' }));
              allRawPois.push(...enrichedWithMode);
              console.log(`  ✅ Batch ${batchNum}${attempt > 1 ? ` (après ${attempt} tentatives)` : ''}: ${enrichedWithMode.length} POIs (total: ${allRawPois.length})`);

              // Sauvegarde intermédiaire avec métadonnées du batch pour la modale
              previewBatches.push({
                batch_num: batchNum,
                total_batches: totalBatches,
                label: `Batch ${batchNum}/${totalBatches} — multi-POI`,
                articles: validArticles.map((a: any) => ({
                  title: a.title,
                  url: a.url || a.slug,
                  headings: extractHeadings(a.markdown || ''),
                })),
                pois: enrichedWithMode,
              });

              await db.collection('pois_generation_jobs').updateOne(
                { _id: new ObjectId(jobId) },
                { $set: { preview_pois: allRawPois, preview_batches: previewBatches, updated_at: new Date() } }
              );

              batchSuccess = true;
              break;
            }
          } catch (batchError: any) {
            console.error(`  ❌ Batch ${batchNum} — tentative ${attempt}/${MAX_RETRIES}: ${batchError.message}`);
            if (attempt === MAX_RETRIES) {
              console.error(`  ⛔ Batch ${batchNum} abandonné après ${MAX_RETRIES} tentatives`);
            }
          }
        }

        if (!batchSuccess) {
          console.warn(`  ⚠️ Batch ${batchNum} ignoré (${MAX_RETRIES} échecs consécutifs)`);
        }
      }

      if (allRawPois.length === 0) {
        throw new Error('Aucun POI extrait depuis les articles');
      }

      console.log(`📊 ${allRawPois.length} POIs bruts extraits — en attente du dédoublonnage manuel`);

      // 5. Marquer l'extraction comme terminée (sans déduplication ni sauvegarde dans pois_selection)
      // Le dédoublonnage et la confirmation sont déclenchés manuellement depuis l'interface
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'extraction_complete',
            raw_count: allRawPois.length,
            preview_pois: allRawPois,
            progress: null,
            updated_at: new Date(),
          },
        }
      );

      console.log(`✅ [WORKER] Extraction terminée: ${allRawPois.length} POIs bruts pour guide ${guideId} — en attente du dédoublonnage manuel`);

      return reply.send({
        success: true,
        raw_count: allRawPois.length,
        articles_processed: total,
        status: 'extraction_complete',
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
