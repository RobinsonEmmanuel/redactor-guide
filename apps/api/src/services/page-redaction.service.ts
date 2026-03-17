import { Db, ObjectId } from 'mongodb';
import { SAISON_MOIS } from '@redactor-guide/core-model';
import { OpenAIService } from './openai.service';
import { FieldValidatorService, ValidationError } from './field-validator.service';
import { ImageAnalysisService, SelectionCriteria } from './image-analysis.service';
import { COLLECTIONS } from '../config/collections.js';

export interface RedactionRequest {
  guideId: string;
  pageId: string;
}

export interface RedactionResult {
  content: Record<string, any>;
  status: 'success' | 'error';
  error?: string;
  validationErrors?: ValidationError[];
  retryCount?: number;
}

export class PageRedactionService {
  private openaiService: OpenAIService;
  private validatorService: FieldValidatorService;
  private imageAnalysisService: ImageAnalysisService;
  private readonly MAX_RETRIES = 3;

  constructor(private readonly db: Db, openaiApiKey: string) {
    this.openaiService = new OpenAIService({
      apiKey: openaiApiKey,
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
    });
    this.validatorService = new FieldValidatorService();
    this.imageAnalysisService = new ImageAnalysisService(openaiApiKey, db);
  }

  /**
   * Générer le contenu d'une page via IA avec retry sur échec de validation
   */
  async generatePageContent(_guideId: string, pageId: string, options?: { useLlmKnowledge?: boolean; linkDefaultUrl?: string; onlyFields?: string[] }): Promise<RedactionResult> {
    try {
      console.log(`🚀 Démarrage rédaction IA pour page ${pageId}`);

      // 0. Charger les paramètres globaux (ratio budget génération)
      const settingsDoc = await this.db.collection(COLLECTIONS.settings).findOne({ _id: 'global' } as any);
      const _budgetRatio: number = (settingsDoc as any)?.generation_budget_ratio ?? 0.75;

      // 1. Charger la page
      const page = await this.db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });
      if (!page) {
        throw new Error('Page non trouvée');
      }

      // 2. Charger le template
      // Fallback : si template_id est null mais template_name est défini, chercher par nom.
      // Cas typique : pages créées par drag-and-drop ou rebuild dont l'ID n'a pas été résolu.
      let template: any = null;
      if (page.template_id) {
        try {
          template = await this.db.collection(COLLECTIONS.templates).findOne({ _id: new ObjectId(page.template_id) });
        } catch {
          console.warn(`⚠️ template_id invalide (${page.template_id}) — fallback par template_name`);
        }
      }
      if (!template && page.template_name) {
        template = await this.db.collection(COLLECTIONS.templates).findOne({ template_name: page.template_name });
        if (template) {
          console.log(`📋 Template résolu par nom : "${page.template_name}" → ${template._id}`);
          // Persister l'ID résolu pour éviter de répéter le fallback
          await this.db.collection(COLLECTIONS.pages).updateOne(
            { _id: page._id },
            { $set: { template_id: template._id } }
          );
        }
      }
      if (!template) {
        throw new Error(`Template non trouvé (id=${page.template_id ?? 'null'}, name=${page.template_name ?? 'null'})`);
      }

      // 3. Charger le contenu source selon la stratégie info_source du template
      let article: any;
      let articleContext: string;
      let extraVars: Record<string, string> = {};

      const infoSource: string = template.info_source ?? 'article_source';

      // Une URL racine (ex: https://monsite.fr/) n'est pas un article valide
      const hasValidArticleUrl = (() => {
        if (!page.url_source) return false;
        try { return new URL(page.url_source).pathname.replace(/\//g, '').length > 0; }
        catch { return false; }
      })();

      if (infoSource === 'article_source') {
        // Mode article spécifique : utilise l'article WordPress lié à la page
        if (!hasValidArticleUrl) {
          if (options?.useLlmKnowledge) {
            // Pas de source WordPress : génération depuis la base de connaissance du LLM
            articleContext = `[MODE BASE DE CONNAISSANCE]\nAucun article WordPress source n'est associé à cette page.\nGénère le contenu en te basant uniquement sur tes connaissances générales du lieu "${page.titre ?? 'inconnu'}".\nSois factuel, précis et adopte le ton éditorial habituel de Region Lovers.`;
            console.log(`🧠 Mode base de connaissance (sans article source) pour "${page.titre}"`);
          } else {
            throw new Error("Ce template utilise 'article_source' mais aucune url_source n'est définie sur la page");
          }
        } else {
          article = await this.loadArticleSource(page.url_source);
          if (!article) {
            throw new Error('Article WordPress source non trouvé');
          }
          await this.ensureImagesAnalyzed(article);
          articleContext = this.formatArticle(article, page.titre);
          if (page.titre && article.images?.length) {
            void this.tagImagesWithPOI(this.filterImagesForPOI(article.images, page.titre), page.titre);
          }
          console.log(`📄 Mode article_source : ${article.title}`);
        }

      } else if (infoSource === 'cluster_auto_match') {
        // Mode cluster : recherche automatique de l'article "Que faire à <nom du cluster>"
        const clusterName = page.metadata?.cluster_name || page.titre || '';
        article = await this.findBestClusterArticle(clusterName);

        if (article) {
          await this.ensureImagesAnalyzed(article);
          articleContext = this.formatArticle(article, page.titre);
          if (page.titre && article.images?.length) {
            void this.tagImagesWithPOI(this.filterImagesForPOI(article.images, page.titre), page.titre);
          }
          console.log(`🔍 Mode cluster_auto_match : article trouvé → "${article.title}"`);
        } else {
          console.warn(`⚠️ Mode cluster_auto_match : aucun article trouvé pour "${clusterName}" — fallback contexte général`);
          article = null;
          articleContext = await this.buildGeneralContext(_guideId, page);
        }

      } else if (infoSource === 'saison_auto_match') {
        // Mode saison : recherche automatique de l'article "Partir à [destination] en [mois]"
        // La saison est définie sur la page (field "saison") : printemps, ete, automne, hiver
        // Fallback : on essaie de la déduire depuis le titre de la page
        let saison: string = page.saison || page.metadata?.saison || '';

        if (!saison && page.titre) {
          const t = page.titre.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // supprime les accents
          if (t.includes('printemps'))                        saison = 'printemps';
          else if (t.includes('ete') || t.includes('ete'))   saison = 'ete';
          else if (t.includes('automne'))                    saison = 'automne';
          else if (t.includes('hiver'))                      saison = 'hiver';
          // Matching par mois de référence (ex: titre "Mai - Météo")
          else if (t.includes('mai') || t.includes('mars') || t.includes('avril'))       saison = 'printemps';
          else if (t.includes('juin') || t.includes('juillet') || t.includes('aout'))   saison = 'ete';
          else if (t.includes('septembre') || t.includes('octobre') || t.includes('novembre')) saison = 'automne';
          else if (t.includes('decembre') || t.includes('janvier') || t.includes('fevrier'))  saison = 'hiver';

          if (saison) {
            console.log(`🔍 Saison non définie → détectée depuis le titre "${page.titre}" : "${saison}"`);
          }
        }

        const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(_guideId) });
        const destination = guide?.destination ?? guide?.destinations?.[0] ?? '';

        const moisRef = saison ? (SAISON_MOIS[saison as keyof typeof SAISON_MOIS]?.[0] ?? '') : '';

        if (!saison) {
          console.warn(`⚠️ Mode saison_auto_match : aucune saison définie sur la page "${page.titre}" — fallback contexte général`);
          article = null;
          articleContext = await this.buildGeneralContext(_guideId, page);
        } else {
          article = await this.findSeasonArticle(saison, destination);

          if (article) {
            await this.ensureImagesAnalyzed(article);
            articleContext = this.formatArticle(article);
            console.log(`🌸 Mode saison_auto_match [${saison}/${moisRef}] : article trouvé → "${article.title}"`);
          } else {
            console.warn(`⚠️ Mode saison_auto_match : aucun article pour saison="${saison}" destination="${destination}" — fallback contexte général`);
            article = null;
            articleContext = await this.buildGeneralContext(_guideId, page);
          }
        }

        // Variables supplémentaires pour la substitution dans ai_instructions
        extraVars = {
          SAISON: saison,
          SAISON_LABEL: { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' }[saison] ?? saison,
          MOIS_REFERENCE: moisRef,
          DESTINATION: destination,
        };

      } else if (infoSource === 'inspiration_auto_match') {
        // Mode inspiration : charge l'article source de chaque POI associé à la page
        // Les POIs sont stockés dans page.metadata.inspiration_pois = [{nom, url_source}]
        const inspirationPois: Array<{ nom: string; url_source: string | null }> =
          page.metadata?.inspiration_pois ?? [];

        const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(_guideId) });

        if (inspirationPois.length === 0) {
          console.warn(`⚠️ Mode inspiration_auto_match : aucun POI résolu sur la page "${page.titre}" — fallback contexte général`);
          article = null;
          articleContext = await this.buildGeneralContext(_guideId, page);
        } else {
          const parts: string[] = [];
          const theme = page.metadata?.inspiration_title || page.titre || '';
          parts.push(`=== THÈME INSPIRATION: ${theme} ===`);
          parts.push(`Destination : ${guide?.destination ?? guide?.destinations?.[0] ?? 'N/A'}`);
          parts.push(`Cette page présente ${inspirationPois.length} lieu(x) sur ce thème.`);
          parts.push('');

          let firstArticle: any = null;
          let resolvedCount = 0;

          for (const poi of inspirationPois) {
            parts.push(`${'─'.repeat(50)}`);
            parts.push(`📍 LIEU : ${poi.nom}`);

            if (poi.url_source) {
              const poiArticle = await this.loadArticleSource(poi.url_source);
              if (poiArticle) {
                if (!firstArticle) firstArticle = poiArticle;
                await this.ensureImagesAnalyzed(poiArticle);
                parts.push(this.formatArticle(poiArticle));
                resolvedCount++;
              } else {
                parts.push(`(article non trouvé pour l'URL : ${poi.url_source})`);
              }
            } else {
              parts.push(`(aucune URL source définie pour ce lieu)`);
            }
            parts.push('');
          }

          console.log(`💡 Mode inspiration_auto_match : ${resolvedCount}/${inspirationPois.length} article(s) chargé(s) pour "${theme}"`);

          article = firstArticle;
          articleContext = parts.join('\n');

          // Variables disponibles dans ai_instructions
          extraVars = {
            INSPIRATION_TITRE:   theme,
            INSPIRATION_LIEUX:   inspirationPois.map((p) => p.nom).join(', '),
            INSPIRATION_NB_LIEUX: String(inspirationPois.length),
          };
        }

      } else if (infoSource === 'tous_articles_index') {
        // Mode index léger : seulement les titres + URLs de tous les articles.
        // Adapté aux pages de ressources/liens (ex: ALLER_PLUS_LOIN) qui n'ont pas
        // besoin du contenu complet — évite de dépasser la fenêtre de contexte du LLM.
        article = null;
        articleContext = await this.buildArticlesIndex(_guideId, page);
        console.log(`📑 Mode tous_articles_index (titres + URLs uniquement)`);

      } else if (infoSource === 'tous_articles_site') {
        article = null;
        articleContext = await this.buildGeneralContext(_guideId, page);
        // Basculement automatique si le contexte dépasse ~25k tokens (100k chars)
        if (articleContext.length > 100_000) {
          console.warn(`⚠️ tous_articles_site trop volumineux (${Math.round(articleContext.length / 4)} tok estimés) — basculement automatique vers tous_articles_index`);
          articleContext = await this.buildArticlesIndex(_guideId, page);
          console.log(`📑 Basculé vers tous_articles_index (${Math.round(articleContext.length / 4)} tok)`);
        } else {
          console.log(`📚 Mode tous_articles_site (~${Math.round(articleContext.length / 4)} tok)`);
        }

      } else if (infoSource === 'tous_articles_et_llm') {
        article = null;
        const siteContext = await this.buildGeneralContext(_guideId, page);
        // Même basculement si trop volumineux
        if (siteContext.length > 100_000) {
          console.warn(`⚠️ tous_articles_et_llm trop volumineux — basculement vers tous_articles_index`);
          articleContext = await this.buildArticlesIndex(_guideId, page);
        } else {
          articleContext = `${siteContext}

=== INSTRUCTIONS COMPLÉMENTAIRES ===
Tu peux également t'appuyer sur tes propres connaissances sur cette destination pour enrichir et compléter le contenu généré, dans la mesure où les informations du site ne suffisent pas. Veille toutefois à rester cohérent avec le ton éditorial et les informations présentes dans les articles du site.`;
        }
        console.log(`🧠 Mode tous_articles_et_llm (~${Math.round(articleContext.length / 4)} tok)`);

      } else {
        // Mode non_applicable : pas de contexte éditorial (ex: sommaire, page de garde)
        article = null;
        const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(_guideId) });
        articleContext = [
          `=== GUIDE ===`,
          `Destination : ${guide?.destination ?? guide?.destinations?.[0] ?? 'N/A'}`,
          `Année : ${guide?.year ?? 'N/A'}`,
          `Langue cible : ${guide?.language ?? 'fr'}`,
          page.titre ? `Page à rédiger : ${page.titre}` : '',
          page.template_name ? `Template : ${page.template_name}` : '',
        ].filter(Boolean).join('\n');
        console.log(`⛔ Mode non_applicable — pas de contexte éditorial`);
      }

      // Injecter une instruction de focus si l'article peut être multi-lieux
      // (ex: "Que faire à Santa Cruz" couvre 10 POIs — on guide l'IA sur le POI exact de cette page)
      const focusName = page.titre?.trim();
      const isArticleBasedMode = infoSource === 'article_source' || infoSource === 'cluster_auto_match';
      if (focusName && isArticleBasedMode) {
        articleContext += `\n\n⚠️ FOCUS OBLIGATOIRE : Cette page de guide concerne UNIQUEMENT "${focusName}". Si l'article source traite de plusieurs lieux, ne retiens QUE les informations relatives à "${focusName}". Toutes les informations portant sur d'autres lieux doivent être ignorées.`;
        console.log(`🎯 Focus POI injecté dans le contexte : "${focusName}"`);
      }

      // Injecter le commentaire interne de l'éditeur s'il est renseigné
      // (valable pour tous les modes — donne des directives éditoriales page par page)
      if (page.commentaire_interne?.trim()) {
        articleContext += `\n\n=== NOTES DE L'ÉDITEUR ===\n${page.commentaire_interne.trim()}\nCes notes doivent orienter et affiner la rédaction de cette page spécifiquement.`;
        console.log(`📝 Commentaire interne injecté dans le contexte`);
      }

      // 5. Extraire les champs avec valeur par défaut (pas d'appel IA pour ceux-ci)
      // Mapping de variables pour résoudre les placeholders {{...}} dans les valeurs par défaut
      // En mode LLM sans article source, utiliser linkDefaultUrl (racine du site) comme fallback
      // pour {{URL_ARTICLE_SOURCE}} dans les champs lien (HORAIRES, PRIX, PHOTOS, etc.)
      const resolvedArticleUrl =
        article?.urls_by_lang?.fr || article?.url || article?.urls_by_lang?.en ||
        (options?.useLlmKnowledge && options?.linkDefaultUrl ? options.linkDefaultUrl : '') ||
        '';

      const earlyFieldVars: Record<string, string> = {
        URL_ARTICLE_SOURCE: resolvedArticleUrl,
        TITRE_ARTICLE_SOURCE: article?.title || '',
        ...extraVars,
      };

      const defaultContent: Record<string, string> = {};
      const fieldsForAI = template.fields.filter((f: any) => {
        // ── Lien avec sous-configurations label/url ──────────────────────────
        if (f.type === 'lien' && (f.link_label || f.link_url)) {
          const ll = f.link_label ?? {};
          const lu = f.link_url  ?? {};
          const labelDefault = ll.default_value;
          const urlDefault   = lu.default_value;
          const allDefault   = labelDefault !== undefined && urlDefault !== undefined;
          const allManual    = !!ll.skip_ai && !!lu.skip_ai;

          if (allDefault) {
            const resolvedLabel = this.openaiService.replaceVariables(String(labelDefault), earlyFieldVars);
            const resolvedUrl   = this.openaiService.replaceVariables(String(urlDefault),   earlyFieldVars);
            defaultContent[f.name] = JSON.stringify({ label: resolvedLabel, url: resolvedUrl });
            console.log(`📌 Lien valeur par défaut complète appliquée pour ${f.name}`);
            return false;
          }
          if (allManual) {
            console.log(`✏️  Lien saisie manuelle — champ ignoré par l'IA : ${f.name}`);
            return false;
          }
          // Au moins une partie est générée par l'IA → envoyer au prompt
          return true;
        }

        // ── Comportement standard ────────────────────────────────────────────
        if (f.default_value !== undefined && f.default_value !== null) {
          defaultContent[f.name] = this.openaiService.replaceVariables(String(f.default_value), earlyFieldVars);
          console.log(`📌 Valeur par défaut appliquée pour ${f.name}`);
          return false;
        }
        if (f.skip_ai) {
          console.log(`✏️  Saisie manuelle — champ ignoré par l'IA : ${f.name}`);
          return false;
        }
        return true;
      });

      // 5b. Si des champs image utilisent le pool destination, construire un pool
      //     par champ (filtré par search_keywords si défini, sinon pool général).
      //     Chaque champ reçoit sa propre variable IMAGES_<FIELDNAME> dans extraVars.
      const poolFields = fieldsForAI.filter((f: any) => f.source === 'destination_pool');
      let poolImageUrls: string[] = [];
      if (poolFields.length > 0) {
        // Construire la liste des URLs de la destination une seule fois (réutilisée par champ)
        const destImageUrls = await this._buildDestImageUrls(_guideId);

        for (const f of poolFields) {
          const keywords: string[] = [
            ...(f.search_keywords ?? []),
            ...(f.pool_tags ?? []),
          ].map((k: string) => k.toLowerCase().trim()).filter(Boolean);

          const fieldAnalyses = await this._queryPoolByKeywords(destImageUrls, keywords, 10);

          // Accumuler les URLs pour la déduplication post-génération
          for (const a of fieldAnalyses) {
            if (!poolImageUrls.includes(a.url)) poolImageUrls.push(a.url);
          }

          const lines = fieldAnalyses.map((img: any, i: number) => {
            const a = img.analysis ?? {};
            return `${i + 1}. ${img.url}\n   Type: ${a.detail_type ?? 'N/A'} | Score: ${img.score?.toFixed(2) ?? '0'} | ${a.analysis_summary ?? ''}`;
          });

          // Variable accessible dans buildTemplateInstructions par le nom du champ
          extraVars[`IMAGES_${f.name}`] = lines.join('\n') || '(aucune image disponible)';

          const kwLabel = keywords.length > 0 ? ` [mots-clés: ${keywords.join(', ')}]` : ' [pool général]';
          console.log(`🖼️ Pool "${f.name}"${kwLabel} — ${fieldAnalyses.length} image(s)`);
        }

        // Compatibilité : IMAGES_DESTINATION = union de tous les pools (déduplication)
        extraVars.IMAGES_DESTINATION = Object.keys(extraVars)
          .filter(k => k.startsWith('IMAGES_') && k !== 'IMAGES_DESTINATION')
          .map(k => extraVars[k])
          .join('\n---\n') || '(aucune image disponible)';
      }

      // Si onlyFields est défini, restreindre la génération aux seuls champs ciblés.
      // Utilisé pour les régénérations partielles (ex: ajout d'un nouveau champ picto).
      const finalFieldsForAI = options?.onlyFields?.length
        ? fieldsForAI.filter((f: any) => options.onlyFields!.includes(f.name))
        : fieldsForAI;

      const templateForAI = { ...template, fields: finalFieldsForAI };

      // Si tous les champs ont une valeur par défaut, pas besoin d'appeler l'IA
      if (finalFieldsForAI.length === 0) {
        console.log('✅ Tous les champs ont une valeur par défaut — pas d\'appel IA nécessaire');
        return { content: defaultContent, status: 'success', retryCount: 0 };
      }

      // 6. Charger les prompts
      const promptRedaction = await this.loadPrompt('redaction_page');
      const promptRegles = await this.loadPrompt('regles_ecriture');

      // 7. Générer avec retry automatique (uniquement les champs sans default_value)
      // Pour gpt-5-mini : context total 400k, max_output 128k.
      // max_output_tokens couvre la réponse visible ; le reasoning interne s'y ajoute.
      // → on alloue au minimum 16k pour laisser de la marge au raisonnement interne,
      //   et on monte selon le nombre de champs (textes longs = plus d'output nécessaire).
      const estimatedOutputTokens = Math.min(32000, Math.max(16000, finalFieldsForAI.length * 500 + 2000));
      console.log(`🎯 Output tokens alloués : ${estimatedOutputTokens} (${finalFieldsForAI.length} champ(s) à générer)`);

      const result = await this.generateWithRetry(
        templateForAI,
        articleContext,
        promptRedaction,
        promptRegles,
        article,    // passé pour la substitution de variables dans les ai_instructions
        extraVars,  // variables supplémentaires selon le mode (ex: SAISON, MOIS_REFERENCE)
        estimatedOutputTokens,
        _budgetRatio
      );

      // 7b. Dédoublonner les champs image : si l'IA a sélectionné la même URL pour
      //     plusieurs champs, remplacer les doublons par la prochaine image disponible
      //     dans le pool (article + destination), triée par qualité.
      const imageReplacementPool = [
        ...(article?.images ?? []),   // images de l'article courant en priorité
        ...poolImageUrls,             // puis pool destination
      ];
      const dedupedContent = this.deduplicateImageFields(
        result.content,
        template.fields,
        imageReplacementPool
      );

      // 8. Fusionner valeurs par défaut + contenu généré (dédoublonné)
      return {
        ...result,
        content: { ...defaultContent, ...dedupedContent },
      };
    } catch (error: any) {
      console.error('❌ Erreur génération contenu:', error);
      return {
        content: {},
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * S'assure que les images d'un article sont analysées
   * Si pas d'analyse, lance l'analyse automatiquement
   */
  private async ensureImagesAnalyzed(article: any): Promise<void> {
    // Vérifier si déjà analysé
    if (article.images_analysis && article.images_analysis.length > 0) {
      console.log(`✅ Images déjà analysées (${article.images_analysis.length} images)`);
      return;
    }

    // Pas d'images à analyser
    if (!article.images || article.images.length === 0) {
      console.log('ℹ️ Aucune image à analyser');
      return;
    }

    console.log(`📸 Lancement analyse de ${article.images.length} images...`);

    try {
      // Charger le prompt d'analyse
      // Chercher par prompt_id OU par intent pour plus de flexibilité
      console.log('🔍 Recherche du prompt analyse_image...');
      const promptDoc = await this.db.collection(COLLECTIONS.prompts).findOne({
        $or: [
          { prompt_id: 'analyse_image', actif: true },
          { intent: 'analyse_image', actif: true },
        ],
      });

      if (!promptDoc) {
        console.warn('⚠️ Prompt analyse_image introuvable (cherché par prompt_id ou intent)');
        // Compter combien de prompts existent en base pour debug
        const totalPrompts = await this.db.collection(COLLECTIONS.prompts).countDocuments();
        const activePrompts = await this.db.collection(COLLECTIONS.prompts).countDocuments({ actif: true });
        console.warn(`   Base contient ${totalPrompts} prompt(s) total, ${activePrompts} actif(s)`);
        console.warn('   → Skip analyse images');
        return;
      }

      console.log(`✅ Prompt analyse_image trouvé (${promptDoc.prompt_nom || 'sans nom'})`);
      console.log(`   Version: ${promptDoc.version || 'N/A'}, Intent: ${promptDoc.intent || 'N/A'}`);

      // Analyser les images
      const analyses = await this.imageAnalysisService.analyzeImages(
        article.images,
        promptDoc.texte_prompt as string
      );

      // Sauvegarder les analyses
      await this.db.collection(COLLECTIONS.articles_raw).updateOne(
        { _id: article._id },
        {
          $set: {
            images_analysis: analyses,
            images_analyzed_at: new Date().toISOString(),
          },
        }
      );

      // Mettre à jour l'article en mémoire
      article.images_analysis = analyses;

      console.log(`✅ ${analyses.length} images analysées et sauvegardées`);
    } catch (error: any) {
      console.error('❌ Erreur analyse images:', error.message);
      // Ne pas bloquer la génération si l'analyse échoue
    }
  }

  /**
   * Génère le contenu avec retry automatique si validation échoue
   * @param articleContext - Contenu formaté (article spécifique ou contexte général)
   */
  private async generateWithRetry(
    template: any,
    articleContext: string,
    promptRedaction: string,
    promptRegles: string,
    articleSource?: any,                   // article résolu (pour substitution {{URL_ARTICLE_SOURCE}}, etc.)
    extraVars: Record<string, string> = {}, // variables supplémentaires (SAISON, MOIS_REFERENCE, etc.)
    maxOutputTokens: number = 12000,
    budgetRatio: number = 0.75
  ): Promise<RedactionResult> {
    let generatedContent: Record<string, any> = {};
    let retryCount = 0;
    let previousErrors: ValidationError[] = [];

    while (retryCount < this.MAX_RETRIES) {
      console.log(`🔄 Tentative ${retryCount + 1}/${this.MAX_RETRIES}`);

      // Construire les instructions du template (avec règles de validation)
      const templateInstructions = this.buildTemplateInstructions(
        template,
        previousErrors,
        articleSource,
        extraVars,
        budgetRatio
      );

      // Troncature de sécurité : promptRegles ne devrait pas dépasser ~60k chars (~15k tokens)
      const MAX_REGLES_CHARS = 60_000;
      const reglesUsed = promptRegles.length > MAX_REGLES_CHARS
        ? promptRegles.slice(0, MAX_REGLES_CHARS) + '\n[... tronqué pour respecter la fenêtre de contexte]'
        : promptRegles;
      if (promptRegles.length > MAX_REGLES_CHARS) {
        console.warn(`⚠️ promptRegles tronqué : ${promptRegles.length} → ${MAX_REGLES_CHARS} chars`);
      }

      // Construire le prompt (avec erreurs de la tentative précédente si retry)
      let prompt = this.openaiService.replaceVariables(promptRedaction, {
        REGLES_REGION_LOVERS: reglesUsed,
        ARTICLE_WORDPRESS: articleContext,
        TEMPLATE_INSTRUCTIONS: templateInstructions,
      });

      // Ajouter contexte de retry si ce n'est pas la première tentative
      if (retryCount > 0 && previousErrors.length > 0) {
        const errorContext = this.buildRetryContext(previousErrors, generatedContent);
        prompt += `\n\n⚠️ ATTENTION - TENTATIVE ${retryCount + 1}/${this.MAX_RETRIES}\n\n${errorContext}`;
      }

      // Log des tailles de chaque composant (diagnostic fenêtre de contexte)
      const tokEst = (s: string) => Math.round(s.length / 4);
      console.log(`📝 Prompt prêt — ~${tokEst(prompt)}k tokens input | ${maxOutputTokens} output`);
      if (retryCount === 0) {
        console.log(`   promptRedaction: ~${tokEst(promptRedaction)} tok | promptRegles: ~${tokEst(reglesUsed)} tok | articleContext: ~${tokEst(articleContext)} tok | templateInstructions: ~${tokEst(templateInstructions)} tok`);
      }
      if (tokEst(prompt) > 200_000) {
        console.warn(`⚠️ Prompt très large — risque de dépassement fenêtre`);
      }

      // Appeler OpenAI
      const newContent = await this.openaiService.generateJSON(prompt, maxOutputTokens);

      // Fusionner avec le contenu précédent (pour garder les champs déjà valides)
      generatedContent = { ...generatedContent, ...newContent };

      console.log('✅ Contenu généré, validation...');

      // Valider le contenu
      const validation = this.validatorService.validateContent(
        generatedContent,
        template.fields
      );

      if (validation.isValid) {
        console.log(`✅ Validation réussie après ${retryCount + 1} tentative(s)`);
        return {
          content: generatedContent,
          status: 'success',
          retryCount,
        };
      }

      // Validation échouée
      console.warn(
        `⚠️ Validation échouée (tentative ${retryCount + 1}):`,
        validation.errors
      );

      previousErrors = validation.errors;
      retryCount++;

      // Si on a atteint le max de retries
      if (retryCount >= this.MAX_RETRIES) {
        console.error(
          `❌ Échec après ${this.MAX_RETRIES} tentatives, validation non conforme`
        );
        return {
          content: generatedContent,
          status: 'error',
          error: `Validation échouée après ${this.MAX_RETRIES} tentatives`,
          validationErrors: validation.errors,
          retryCount,
        };
      }

      // Attendre un peu avant le retry (backoff progressif)
      await this.sleep(1000 * retryCount);
    }

    // Ne devrait jamais arriver ici, mais par sécurité
    return {
      content: generatedContent,
      status: 'error',
      error: 'Erreur inattendue dans la boucle de retry',
      validationErrors: previousErrors,
      retryCount,
    };
  }

  /**
   * Construit le contexte de retry avec les erreurs précédentes
   */
  private buildRetryContext(
    errors: ValidationError[],
    previousContent: Record<string, any>
  ): string {
    const failedFields = this.validatorService.getFailedFields(errors);
    const errorDetails = this.validatorService.formatErrorsForRetry(errors);

    return `Les champs suivants ont échoué la validation et DOIVENT être corrigés :

${errorDetails}

CHAMPS À REGÉNÉRER UNIQUEMENT : ${failedFields.join(', ')}

Contenu précédent de ces champs (INCORRECT) :
${failedFields
  .map((field) => `${field}: "${previousContent[field] || 'vide'}"`)
  .join('\n')}

INSTRUCTIONS STRICTES :
1. NE régénère QUE les champs en erreur ci-dessus
2. Respecte IMPÉRATIVEMENT les règles de validation (longueur MIN et MAX, mots interdits, etc.)
3. Pour les champs texte: viser 95% du calibre MAX pour être sûr de ne PAS dépasser
4. Compte précisément les caractères, espaces compris, pour chaque champ
5. Les autres champs sont déjà corrects, ne les modifie PAS`;
  }

  /**
   * Sleep helper pour backoff progressif
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Recherche automatique de l'article le plus pertinent pour une page Cluster.
   *
   * Stratégie de matching (ordre de priorité) :
   *  1. Titre contient "que faire" ET le nom du cluster         → score maximal
   *  2. Titre contient le nom du cluster uniquement             → score moyen
   *  3. Titre contient des mots-clés significatifs du cluster   → score minimal (fallback)
   *
   * Exemples :
   *  "Puerto de la Cruz" → "Que faire à Puerto de la Cruz (Tenerife): 15 incontournables"
   *  "La Laguna"         → "Que faire à La Laguna, Tenerife"
   */
  private async findBestClusterArticle(clusterName: string): Promise<any | null> {
    if (!clusterName.trim()) return null;

    const name = clusterName.trim();

    // Escape des caractères spéciaux pour la regex MongoDB
    const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const namePattern = escapeRegex(name);

    // 1. Priorité absolue : titre contient le nom du cluster ET "que faire"
    const bestMatch = await this.db.collection(COLLECTIONS.articles_raw).findOne({
      $and: [
        { title: { $regex: namePattern, $options: 'i' } },
        { title: { $regex: 'que faire', $options: 'i' } },
      ],
    });
    if (bestMatch) return bestMatch;

    // 2. Titre contient le nom du cluster (sans contrainte sur "que faire")
    const nameMatch = await this.db.collection(COLLECTIONS.articles_raw).findOne({
      title: { $regex: namePattern, $options: 'i' },
    });
    if (nameMatch) return nameMatch;

    // 3. Fallback : chercher sur les mots significatifs (> 3 lettres) du nom
    // Ex: "Puerto de la Cruz" → mots significatifs : ["Puerto", "Cruz"]
    const significantWords = name.split(/\s+/).filter((w) => w.length > 3);
    if (significantWords.length > 0) {
      const wordPatterns = significantWords.map((w) => ({
        title: { $regex: escapeRegex(w), $options: 'i' },
      }));
      const partialMatch = await this.db.collection(COLLECTIONS.articles_raw).findOne({
        $and: [
          { title: { $regex: 'que faire', $options: 'i' } },
          { $and: wordPatterns },
        ],
      });
      if (partialMatch) return partialMatch;
    }

    return null;
  }

  /**
   * Recherche automatique de l'article saisonnier le plus pertinent.
   *
   * Stratégie (ordre de priorité) :
   *  1. Titre contient la destination + "partir" + mois principal  (ex: "Partir à Tenerife en mai")
   *  2. Titre contient la destination + mois principal             (ex: "Tenerife en mai")
   *  3. Titre contient la destination + mois alternatif (itère sur tous les mois de la saison)
   *
   * @param saison       - 'printemps' | 'ete' | 'automne' | 'hiver'
   * @param destination  - Nom de la destination (ex: "Tenerife", "Gran Canaria")
   */
  private async findSeasonArticle(saison: string, destination: string): Promise<any | null> {
    if (!saison || !destination) return null;

    const months: string[] = SAISON_MOIS[saison as keyof typeof SAISON_MOIS] ?? [];
    if (months.length === 0) return null;

    const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Mots significatifs de la destination (> 2 lettres) pour le matching partiel
    const destWords = destination
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map(escapeRegex);

    if (destWords.length === 0) return null;

    for (const month of months) {
      const monthPattern = escapeRegex(month);

      // Construire la condition de destination (au moins un mot significatif)
      const destCondition = destWords.length === 1
        ? { title: { $regex: destWords[0], $options: 'i' } }
        : { $or: destWords.map((w) => ({ title: { $regex: w, $options: 'i' } })) };

      // 1. "Partir à [destination] en [mois]"
      const exactMatch = await this.db.collection(COLLECTIONS.articles_raw).findOne({
        $and: [
          destCondition,
          { title: { $regex: monthPattern, $options: 'i' } },
          { title: { $regex: 'partir', $options: 'i' } },
        ],
      });
      if (exactMatch) {
        console.log(`   ✅ Match "partir+destination+mois" : "${exactMatch.title}"`);
        return exactMatch;
      }

      // 2. [destination] + [mois] (sans "partir")
      const looseMatch = await this.db.collection(COLLECTIONS.articles_raw).findOne({
        $and: [
          destCondition,
          { title: { $regex: monthPattern, $options: 'i' } },
        ],
      });
      if (looseMatch) {
        console.log(`   ✅ Match "destination+mois" : "${looseMatch.title}"`);
        return looseMatch;
      }
    }

    console.warn(`   ❌ Aucun article saisonnier pour saison="${saison}", destination="${destination}"`);
    return null;
  }

  /**
   * Charger un article WordPress depuis la base
   */
  private async loadArticleSource(urlSource?: string): Promise<any> {
    if (!urlSource) {
      throw new Error('URL source manquante');
    }

    // Chercher l'article par son URL (toutes langues)
    const article = await this.db.collection(COLLECTIONS.articles_raw).findOne({
      $or: [
        { 'urls_by_lang.fr': urlSource },
        { 'urls_by_lang.en': urlSource },
        { 'urls_by_lang.de': urlSource },
        { 'urls_by_lang.es': urlSource },
        { 'urls_by_lang.it': urlSource },
      ],
    });

    return article;
  }

  /**
   * Construit un contexte général depuis le site WordPress pour les pages
   * qui n'ont pas d'article source spécifique (COUVERTURE, PRESENTATION_*, SAISON, etc.)
   *
   * Fournit à l'IA :
   *  - Les métadonnées du guide (destination, année, langue)
   *  - La liste des clusters et POIs du guide
   *  - Un échantillon d'articles du site pour la couleur éditoriale
   */
  /**
   * Construit un contexte léger : index titre + URL de chaque article de la destination.
   * Utilisé pour les pages de ressources/liens (info_source = 'tous_articles_index') qui
   * n'ont besoin que de savoir QUELS articles existent, sans leur contenu complet.
   * Poids typique : ~50 tokens/article → 200 articles = ~10 000 tokens.
   */
  private async buildArticlesIndex(guideId: string, page: any): Promise<string> {
    const MAX_ARTICLES = 200;

    const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
    const destination: string = guide?.destination ?? guide?.destinations?.[0] ?? '';

    const parts: string[] = [];
    parts.push(`=== GUIDE ===`);
    parts.push(`Destination : ${destination || 'N/A'}`);
    parts.push(`Année : ${guide?.year ?? 'N/A'}`);
    if (page.titre) parts.push(`Page à rédiger : ${page.titre}`);

    // Projeter uniquement title + urls_by_lang (pas categories, qui peut être très volumineux)
    const articles = await this.db
      .collection(COLLECTIONS.articles_raw)
      .find(
        destination ? { categories: { $regex: destination, $options: 'i' } } : {},
        { projection: { title: 1, url: 1, 'urls_by_lang.fr': 1 } }
      )
      .limit(MAX_ARTICLES)
      .toArray();

    parts.push(`\n=== ARTICLES DU SITE (${articles.length} articles — titres et URLs) ===`);
    for (const art of articles) {
      const url = art.urls_by_lang?.fr ?? art.url ?? '';
      parts.push(`- ${art.title ?? '(sans titre)'}${url ? `  →  ${url}` : ''}`);
    }

    console.log(`📑 Index articles : ${articles.length} article(s) (max ${MAX_ARTICLES}) pour "${destination || 'toutes destinations'}"`);
    return parts.join('\n');
  }

  private async buildGeneralContext(guideId: string, page: any): Promise<string> {
    const parts: string[] = [];

    // 1. Métadonnées du guide
    const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
    if (guide) {
      parts.push(`=== GUIDE ===`);
      parts.push(`Destination : ${guide.destination ?? guide.destinations?.[0] ?? 'N/A'}`);
      parts.push(`Année : ${guide.year ?? 'N/A'}`);
      parts.push(`Langue cible : ${guide.language ?? 'fr'}`);
      if (page.titre) parts.push(`Page à rédiger : ${page.titre}`);
      if (page.template_name) parts.push(`Template : ${page.template_name}`);
    }

    // 2. Structure du guide (clusters + POIs)
    const poisDoc = await this.db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
    if (poisDoc != null && poisDoc.pois?.length > 0) {
      parts.push(`\n=== STRUCTURE DU GUIDE (clusters et lieux) ===`);
      const byCluster: Record<string, string[]> = {};
      for (const poi of poisDoc.pois) {
        const cluster = poi.cluster_name || 'Sans cluster';
        if (!byCluster[cluster]) byCluster[cluster] = [];
        byCluster[cluster].push(poi.nom);
      }
      for (const [cluster, pois] of Object.entries(byCluster)) {
        parts.push(`${cluster} : ${pois.join(', ')}`);
      }
    }

    // 3. Articles du site WordPress — approche hybride à budget de tokens
    //
    // GPT-5 mini : 400 000 tokens de contexte.
    // On réserve ~120 000 tokens pour le prompt système + les instructions + l'output.
    // Budget articles : 280 000 tokens.
    //
    // Filtrage : on ne charge que les articles dont la catégorie correspond
    // à la destination du guide (ex: "Tenerife"). Les articles d'autres destinations
    // (ex: "Gran Canaria") sont ignorés — inutiles pour la rédaction.
    //
    // Stratégie :
    //   - Couche 1 : articles complets (markdown), triés du plus court au plus long
    //     → on en inclut autant que le budget le permet (~30 articles selon leur taille)
    //   - Couche 2 : index "titre | URL" pour les articles exclus (~30 tokens/article)
    //     → l'IA sait qu'ils existent même sans en connaître le contenu
    //
    // Estimation tokens : 1 token ≈ 4 caractères (français/anglais mélangé)
    const TOKEN_BUDGET_ARTICLES = 280_000;
    const CHARS_PER_TOKEN = 4;

    // Construire le filtre par destination (correspondance insensible à la casse)
    const destination: string = guide?.destination ?? guide?.destinations?.[0] ?? '';
    const destinationFilter = destination
      ? { categories: { $regex: destination, $options: 'i' } }
      : {};

    const allArticles = await this.db
      .collection(COLLECTIONS.articles_raw)
      .find(destinationFilter, { projection: { title: 1, url: 1, categories: 1, tags: 1, markdown: 1, html_brut: 1 } })
      .toArray();

    console.log(`🗂️ Articles filtrés pour "${destination || 'toutes destinations'}": ${allArticles.length} articles`);

    // Trier du plus court au plus long pour maximiser le nombre d'articles complets inclus
    allArticles.sort((a, b) => {
      const lenA = (a.markdown || a.html_brut || '').length;
      const lenB = (b.markdown || b.html_brut || '').length;
      return lenA - lenB;
    });

    const fullArticles: typeof allArticles = [];
    const indexOnlyArticles: typeof allArticles = [];
    let tokensBudgetUsed = 0;

    for (const art of allArticles) {
      const content = art.markdown || art.html_brut || '';
      const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
      if (tokensBudgetUsed + estimatedTokens <= TOKEN_BUDGET_ARTICLES) {
        fullArticles.push(art);
        tokensBudgetUsed += estimatedTokens;
      } else {
        indexOnlyArticles.push(art);
      }
    }

    console.log(`📚 Contexte articles : ${fullArticles.length} complets (≈${tokensBudgetUsed.toLocaleString()} tokens), ${indexOnlyArticles.length} en index seulement`);

    if (fullArticles.length > 0) {
      parts.push(`\n=== CONTENUS WORDPRESS DU SITE — ARTICLES COMPLETS (${fullArticles.length} / ${allArticles.length}) ===`);
      parts.push(`Ces articles constituent la base éditoriale et informative principale de la destination.`);
      for (const art of fullArticles) {
        parts.push(`\n--- ${art.title ?? 'Article'}${art.url ? ` | ${art.url}` : ''} ---`);
        if (art.categories?.length) parts.push(`Catégories : ${art.categories.join(', ')}`);
        parts.push(art.markdown || art.html_brut || '');
      }
    }

    if (indexOnlyArticles.length > 0) {
      parts.push(`\n=== INDEX DES AUTRES ARTICLES DISPONIBLES (${indexOnlyArticles.length} articles — contenu non chargé) ===`);
      parts.push(`Ces articles existent sur le site mais n'ont pas pu être inclus en intégralité. Tu peux t'y référer par leur titre.`);
      for (const art of indexOnlyArticles) {
        const line = art.url
          ? `- ${art.title ?? 'Sans titre'} → ${art.url}`
          : `- ${art.title ?? 'Sans titre'}`;
        parts.push(line);
      }
    }

    return parts.join('\n');
  }

  /**
   * Charger un prompt depuis la base
   */
  private async loadPrompt(intent: string): Promise<string> {
    const prompt = await this.db.collection(COLLECTIONS.prompts).findOne({
      intent,
      actif: true,
    });

    if (!prompt) {
      throw new Error(`Prompt non trouvé : ${intent}`);
    }

    return prompt.texte_prompt;
  }

  /**
   * Construire les instructions pour chaque champ du template.
   *
   * Les ai_instructions de chaque champ peuvent contenir des variables substituées
   * automatiquement depuis l'article source résolu :
   *
   *   {{URL_ARTICLE_SOURCE}}   → URL française de l'article (urls_by_lang.fr)
   *   {{TITRE_ARTICLE_SOURCE}} → Titre de l'article
   *
   * Exemple d'usage dans ai_instructions d'un champ lien :
   *   "Utiliser exactement cette URL : {{URL_ARTICLE_SOURCE}}"
   */
  private buildTemplateInstructions(
    template: any,
    failedFields?: ValidationError[],
    articleSource?: any,
    extraVars: Record<string, string> = {},
    budgetRatio: number = 0.75
  ): string {
    const failedFieldNames = failedFields
      ? this.validatorService.getFailedFields(failedFields)
      : [];

    // Variables disponibles pour la substitution dans les ai_instructions
    // IMAGES_DESTINATION est injecte dans extraVars quand des champs source='destination_pool' existent
    const fieldVars: Record<string, string> = {
      URL_ARTICLE_SOURCE:   articleSource?.urls_by_lang?.fr
                            || articleSource?.url
                            || articleSource?.urls_by_lang?.en
                            || '',
      TITRE_ARTICLE_SOURCE: articleSource?.title || '',
      // Variables supplémentaires injectées selon le mode (saison, pool destination, etc.)
      ...extraVars,
    };

    const instructions = template.fields.map((field: any) => {
      const isFailed = failedFieldNames.includes(field.name);
      const parts = [
        `Champ: ${field.name}${isFailed ? ' ⚠️ EN ERREUR - À CORRIGER' : ''}`,
        `Type: ${field.type}`,
      ];

      if (field.label) {
        parts.push(`Label: ${field.label}`);
      }

      // ── Champ répétitif ──────────────────────────────────────────────────────
      if (field.type === 'repetitif') {
        const maxRep = field.max_repetitions ?? 'N';
        parts.push(`⚠️ FORMAT OBLIGATOIRE: JSON array — tableau d'objets répétés`);
        parts.push(`Nombre d'entrées: entre 1 et ${maxRep} (selon les contenus disponibles)`);

        if (field.ai_instructions) {
          parts.push(`Instructions générales: ${this.openaiService.replaceVariables(field.ai_instructions, fieldVars)}`);
        }

        if (field.sub_fields && field.sub_fields.length > 0) {
          parts.push(`Sous-champs de chaque objet du tableau:`);
          for (const sf of field.sub_fields) {
            const sfInstr = sf.ai_instructions
              ? ` — ${this.openaiService.replaceVariables(sf.ai_instructions, fieldVars)}`
              : '';
            let sfCalibrage = '';
            if (sf.max_chars) {
              const ratio  = field.generation_budget ?? budgetRatio;
              const budget = Math.floor(sf.max_chars * ratio);
              sfCalibrage = ` [MAX ${budget} car. (calibre ${sf.max_chars} × ${ratio})]`;
            }
            parts.push(`  • "${sf.name}" (${sf.type}${sf.label ? ` — ${sf.label}` : ''})${sfInstr}${sfCalibrage}`);
          }

          // Exemple de format attendu
          const exampleObj = field.sub_fields.reduce((acc: Record<string, string>, sf: any) => {
            acc[sf.name] = sf.type === 'image' ? 'https://...' : sf.type === 'lien' ? 'https://...' : '...';
            return acc;
          }, {});
          parts.push(`Format JSON attendu:`);
          parts.push(`[\n  ${JSON.stringify(exampleObj)},\n  … (max ${maxRep} entrées)\n]`);
          parts.push(`⚠️ Répondre UNIQUEMENT avec le tableau JSON pour ce champ, sans texte autour.`);
        }

        return parts.join('\n');
      }

      // ── Champ image — sélection depuis le pool destination ──────────────────
      if (field.source === 'destination_pool') {
        // Priorité : pool filtré par mots-clés du champ, sinon pool général
        const imagesBlock = fieldVars[`IMAGES_${field.name}`]
          || fieldVars['IMAGES_DESTINATION']
          || '(aucune image disponible)';
        parts.push(`⚠️ SÉLECTION DEPUIS LE POOL DE PHOTOS DE LA DESTINATION`);
        if (field.search_keywords?.length) {
          parts.push(`Photos pré-filtrées par mots-clés : ${(field.search_keywords as string[]).join(', ')}`);
        }
        parts.push(`Voici les photos analysées disponibles :\n${imagesBlock}`);
        // ai_instructions en priorité (champ unifié), pool_instructions pour rétrocompatibilité
        const selectionPrompt = field.ai_instructions
          ? this.openaiService.replaceVariables(field.ai_instructions, fieldVars)
          : field.pool_instructions;
        if (selectionPrompt) {
          parts.push(`Critères de sélection :\n${selectionPrompt}`);
        }
        parts.push(`⚠️ Répondre UNIQUEMENT avec l'URL complète de l'image choisie (https://...), sans aucun texte autour.`);
        return parts.join('\n');
      }

      // ── Lien avec sous-configurations label / url ────────────────────────────
      if (field.type === 'lien' && (field.link_label || field.link_url)) {
        const ll = field.link_label ?? {};
        const lu = field.link_url   ?? {};

        parts.push(`⚠️ FORMAT OBLIGATOIRE: objet JSON { "label": "...", "url": "..." }`);

        // --- Intitulé ---
        if (ll.default_value !== undefined) {
          parts.push(`Intitulé (fixe, ne pas modifier): "${ll.default_value}"`);
          if (ll.max_chars) {
            const ratio  = field.generation_budget ?? budgetRatio;
            const budget = Math.floor(ll.max_chars * ratio);
            parts.push(`⚠️ CALIBRAGE INTITULÉ: ${budget} caractères MAXIMUM (calibre InDesign: ${ll.max_chars} car. × ratio ${ratio})`);
          }
        } else if (ll.skip_ai) {
          parts.push(`Intitulé: VIDE — sera saisi manuellement (mettre null ou chaîne vide)`);
        } else {
          const instr = ll.ai_instructions
            ? this.openaiService.replaceVariables(ll.ai_instructions, fieldVars)
            : `Rédiger un intitulé court et incitatif pour ce lien`;
          parts.push(`Instructions intitulé: ${instr}`);
          if (ll.max_chars) {
            const ratio  = field.generation_budget ?? budgetRatio;
            const budget = Math.floor(ll.max_chars * ratio);
            parts.push(`⚠️ CALIBRAGE INTITULÉ: ${budget} caractères MAXIMUM (calibre InDesign: ${ll.max_chars} car. × ratio ${ratio})`);
          }
        }

        // --- URL ---
        if (lu.default_value !== undefined) {
          const resolvedUrl = this.openaiService.replaceVariables(lu.default_value, fieldVars);
          parts.push(`URL (fixe, ne pas modifier): "${resolvedUrl}"`);
        } else if (lu.skip_ai) {
          parts.push(`URL: VIDE — sera saisie manuellement (mettre null ou chaîne vide)`);
        } else {
          const instr = lu.ai_instructions
            ? this.openaiService.replaceVariables(lu.ai_instructions, fieldVars)
            : `Indiquer l'URL pertinente`;
          parts.push(`Instructions URL: ${instr}`);
        }

        parts.push(`⚠️ Répondre UNIQUEMENT avec l'objet JSON { "label": "...", "url": "..." }, sans texte autour.`);
        return parts.join('\n');
      }

      // ── Champs classiques ────────────────────────────────────────────────────
      if (field.max_chars) {
        // Appliquer le ratio de budget (field override > ratio global)
        const ratio  = field.generation_budget ?? budgetRatio;
        const budget = Math.floor(field.max_chars * ratio);
        parts.push(`⚠️ CALIBRAGE OBLIGATOIRE: ${budget} caractères MAXIMUM (calibre InDesign: ${field.max_chars} car. × ratio ${ratio} — ne JAMAIS dépasser, viser 95% du budget)`);
      }

      if (field.type === 'liste') {
        if (field.max_items) {
          parts.push(`⚠️ LISTE: maximum ${field.max_items} puces (générer entre 1 et ${field.max_items} items selon le contenu disponible)`);
        }
        if (field.max_chars_per_item) {
          const ratio  = field.generation_budget ?? budgetRatio;
          const budgetPerItem = Math.floor(field.max_chars_per_item * ratio);
          parts.push(`⚠️ LONGUEUR PAR PUCE: maximum ${budgetPerItem} caractères par puce (label gras inclus — calibre InDesign: ${field.max_chars_per_item} car.)`);
        }
      }
      
      if (field.min_chars) {
        parts.push(`⚠️ LONGUEUR MINIMUM: ${field.min_chars} caractères MINIMUM (OBLIGATOIRE)`);
      }

      if (field.ai_instructions) {
        const resolvedInstructions = this.openaiService.replaceVariables(
          field.ai_instructions,
          fieldVars
        );
        parts.push(`Instructions: ${resolvedInstructions}`);
      }

      if (field.type === 'picto' && field.options && field.options.length > 0) {
        parts.push(`⚠️ VALEUR OBLIGATOIRE: Choisir EXACTEMENT UNE valeur parmi cette liste (rien d'autre) : ${field.options.map((o: string) => `"${o}"`).join(', ')}`);
        parts.push(`✅ Répondre avec la valeur EXACTE (sans guillemets, sans espaces supplémentaires)`);
      }

      if (field.validation) {
        const validationRules = this.formatValidationRules(field.validation);
        if (validationRules) {
          parts.push(`\n🛡️ RÈGLES DE VALIDATION (IMPÉRATIVES):\n${validationRules}`);
        }
      }

      return parts.join('\n');
    });

    return instructions.join('\n\n---\n\n');
  }

  /**
   * Formate les règles de validation pour le prompt
   */
  private formatValidationRules(validation: any): string {
    const rules: string[] = [];

    if (validation.required) {
      rules.push('- ⚠️ Champ OBLIGATOIRE');
    }
    if (validation.max_length) {
      rules.push(`- ⚠️ LONGUEUR MAX: ${validation.max_length} caractères (NE JAMAIS DÉPASSER - viser 95% max)`);
    }
    if (validation.min_length) {
      rules.push(`- ⚠️ LONGUEUR MIN: ${validation.min_length} caractères (OBLIGATOIRE)`);
    }
    if (validation.sentence_count) {
      rules.push(`- Nombre de phrases: ${validation.sentence_count} exactement`);
    }
    if (validation.forbidden_words && validation.forbidden_words.length > 0) {
      rules.push(
        `- MOTS INTERDITS: ${validation.forbidden_words.join(', ')}`
      );
    }
    if (validation.forbidden_patterns && validation.forbidden_patterns.length > 0) {
      rules.push(
        `- PATTERNS INTERDITS: ${validation.forbidden_patterns.join(', ')}`
      );
    }
    if (
      validation.forbidden_temporal_terms &&
      validation.forbidden_temporal_terms.length > 0
    ) {
      rules.push(
        `- TERMES TEMPORELS INTERDITS: ${validation.forbidden_temporal_terms.join(', ')}`
      );
    }

    return rules.join('\n');
  }

  /**
   * Formater l'article WordPress pour le prompt
   */
  private formatArticle(article: any, poiFocusFilter?: string): string {
    const parts = [
      `Titre: ${article.title || 'N/A'}`,
      `URL: ${article.urls_by_lang?.fr || 'N/A'}`,
      '',
      `Contenu HTML:`,
      article.html_brut || '',
    ];

    if (article.categories && article.categories.length > 0) {
      parts.unshift(`Catégories: ${article.categories.join(', ')}`);
    }

    if (article.tags && article.tags.length > 0) {
      parts.unshift(`Tags: ${article.tags.join(', ')}`);
    }

    // Ajouter les images disponibles, filtrées par POI si applicable
    if (article.images && article.images.length > 0) {
      const images = poiFocusFilter
        ? this.filterImagesForPOI(article.images, poiFocusFilter)
        : (article.images as string[]);

      parts.push('');
      parts.push(`Images disponibles (${images.length}):`);
      images.forEach((img: string, idx: number) => {
        parts.push(`  ${idx + 1}. ${img}`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Filtre une liste d'URLs d'images en ne gardant que celles dont le slug
   * contient au moins un mot-clé issu du nom du POI.
   * Si aucune image ne matche (slug opaque), retourne toutes les images.
   */
  private filterImagesForPOI(images: string[], poiName: string): string[] {
    const keywords = this.slugifyKeywords(poiName);
    if (keywords.length === 0) return images;

    const filtered = images.filter((url: string) =>
      keywords.some(kw => url.toLowerCase().includes(kw))
    );

    if (filtered.length > 0) {
      console.log(`🖼️ Images filtrées pour POI "${poiName}": ${filtered.length}/${images.length} retenues`);
      return filtered;
    }

    console.log(`🖼️ Filtre POI "${poiName}" sans résultat — toutes les images conservées`);
    return images;
  }

  /**
   * Enregistre en base (collection image_analyses) le nom du POI pour chaque image matchée.
   * Utilise $addToSet pour éviter les doublons.
   * Fire-and-forget : les erreurs n'interrompent pas la génération.
   */
  private async tagImagesWithPOI(imageUrls: string[], poiName: string): Promise<void> {
    if (!poiName || imageUrls.length === 0) return;
    try {
      await this.db.collection(COLLECTIONS.image_analyses).updateMany(
        { url: { $in: imageUrls } },
        { $addToSet: { poi_names: poiName } }
      );
      console.log(`🏷️ POI "${poiName}" enregistré sur ${imageUrls.length} image(s) dans image_analyses`);
    } catch (err: any) {
      console.warn(`⚠️ tagImagesWithPOI : erreur non bloquante — ${err.message}`);
    }
  }

  /**
   * Normalise un nom de POI en mots-clés utilisables pour filtrer des URLs d'images.
   * Ex: "Piscines Naturelles Los Abrigos" → ["piscines", "naturelles", "abrigos"]
   * Les mots de moins de 4 caractères sont ignorés (articles, prépositions…).
   */
  private slugifyKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4);
  }

  /**
   * Sélectionne la meilleure image pour un article selon des critères
   */
  selectBestImage(article: any, criteria?: SelectionCriteria): string | null {
    if (!article.images_analysis || article.images_analysis.length === 0) {
      // Pas d'analyse, retourner la première image
      return article.images?.[0] || null;
    }

    const bestImage = this.imageAnalysisService.selectBestImage(
      article.images_analysis,
      criteria
    );

    return bestImage?.url || null;
  }

  /**
   * Construit la liste des meilleures images du pool destination pour les injecter
   * dans les ai_instructions des champs image marqués source='destination_pool'.
   *
   * Strategie :
   *  1. Charge toutes les analyses de la collection image_analyses
   *  2. Filtre optionnellement par detail_type (union des pool_tags de tous les champs pool)
   *  3. Filtre d'abord editorial_relevance='forte', puis complète avec le reste si besoin
   *  4. Trie par score qualite moyen (visual_clarity + composition + lighting) desc
   *  5. Retourne les TOP_N sous forme de liste texte pour le prompt
   */
  /**
   * Requête commune au pool de photos destination.
   * Retourne les analyses triées par score qualité (forte pertinence en premier).
   * Partagée par buildImagePoolContext (texte pour le prompt) et
   * deduplicateImageFields (URLs pour le remplacement des doublons).
   */
  /** Retourne l'ensemble des URLs d'images associées à la destination du guide. */
  private async _buildDestImageUrls(guideId: string): Promise<Set<string>> {
    const guide = await this.db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
    const destination: string = guide?.destination ?? guide?.destinations?.[0] ?? '';

    const destArticles = await this.db
      .collection(COLLECTIONS.articles_raw)
      .find(
        destination ? { categories: { $regex: destination, $options: 'i' } } : {},
        { projection: { images: 1 } }
      )
      .toArray();

    const urls = new Set<string>();
    for (const art of destArticles) {
      if (art.images?.length) for (const url of art.images) urls.add(url);
    }
    return urls;
  }

  /**
   * Requête le pool d'images analysées filtrées par mots-clés (texte libre dans
   * analysis_summary ou detail_type). Si `keywords` est vide, retourne les meilleures
   * images de la destination sans filtre thématique.
   * Si `destImageUrls` est vide, interroge toute la collection image_analyses.
   */
  private async _queryPoolByKeywords(
    destImageUrls: Set<string>,
    keywords: string[],
    topN = 10
  ): Promise<Array<{ url: string; score: number; analysis?: any }>> {
    const baseFilter: any = {
      'analysis.is_composite':     { $ne: true },
      'analysis.has_text_overlay': { $ne: true },
    };
    if (destImageUrls.size > 0) baseFilter.url = { $in: [...destImageUrls] };

    if (keywords.length > 0) {
      const pattern = keywords
        .map((k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const regex = new RegExp(pattern, 'i');
      baseFilter['$or'] = [
        { 'analysis.detail_type':      { $regex: regex } },
        { 'analysis.analysis_summary': { $regex: regex } },
      ];
    }

    let analyses = await this.db.collection(COLLECTIONS.image_analyses).find(baseFilter).toArray();

    // Fallback sans filtre destination si aucun résultat
    if (analyses.length === 0 && destImageUrls.size > 0) {
      const fallback: any = {
        'analysis.is_composite':     { $ne: true },
        'analysis.has_text_overlay': { $ne: true },
      };
      if (keywords.length > 0) {
        const p = keywords.map((k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const r = new RegExp(p, 'i');
        fallback['$or'] = [
          { 'analysis.detail_type':      { $regex: r } },
          { 'analysis.analysis_summary': { $regex: r } },
        ];
      }
      analyses = await this.db.collection(COLLECTIONS.image_analyses).find(fallback).toArray();
    }

    const scored = analyses.map((img: any) => {
      const a = img.analysis ?? {};
      const scores = [
        a.visual_clarity_score, a.composition_quality_score,
        a.lighting_quality_score, a.readability_small_screen_score,
      ].filter((s: any) => typeof s === 'number');
      const avg = scores.length > 0 ? scores.reduce((acc: number, s: number) => acc + s, 0) / scores.length : 0;
      return { url: String(img.url), score: avg, editorial: a.editorial_relevance, analysis: a };
    });

    const forte  = scored.filter((i: any) => i.editorial === 'forte').sort((a: any, b: any) => b.score - a.score);
    const others = scored.filter((i: any) => i.editorial !== 'forte').sort((a: any, b: any) => b.score - a.score);
    return [...forte, ...others].slice(0, topN);
  }


  /**
   * Dédoublonne les champs image dans le contenu généré par l'IA.
   *
   * Si plusieurs champs de type 'image' ont la même URL, les doublons sont
   * remplacés par la prochaine URL disponible dans replacementPool (triée par
   * qualité, déjà utilisées exclues). Les champs dont la valeur est absente ou
   * non-HTTP sont ignorés.
   *
   * @param content         Contenu généré par l'IA ({ fieldName: value })
   * @param fields          Définitions des champs du template
   * @param replacementPool Pool d'URLs de remplacement triées par priorité
   */
  private deduplicateImageFields(
    content: Record<string, any>,
    fields: any[],
    replacementPool: string[]
  ): Record<string, any> {
    const imageFields = fields.filter(
      (f: any) => f.type === 'image' && !f.default_value && !f.skip_ai
    );
    if (imageFields.length <= 1) return content;

    const result = { ...content };
    const usedUrls = new Set<string>();

    for (const field of imageFields) {
      const url: string | undefined = result[field.name];
      if (!url || typeof url !== 'string' || !url.startsWith('http')) continue;

      if (!usedUrls.has(url)) {
        usedUrls.add(url);
      } else {
        // Doublon détecté : chercher la prochaine URL non encore utilisée
        const replacement = replacementPool.find((u) => !usedUrls.has(u));
        if (replacement) {
          console.log(
            `🔄 [dedup] Image dupliquée pour "${field.name}" remplacée :` +
            `\n    avant : ...${url.slice(-50)}` +
            `\n    après : ...${replacement.slice(-50)}`
          );
          result[field.name] = replacement;
          usedUrls.add(replacement);
        } else {
          console.warn(`⚠️ [dedup] Aucune image alternative pour "${field.name}" — doublon conservé`);
        }
      }
    }

    return result;
  }
}
