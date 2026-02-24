import { Db, ObjectId } from 'mongodb';
import { SAISON_MOIS } from '@redactor-guide/core-model';
import { OpenAIService } from './openai.service';
import { FieldValidatorService, ValidationError } from './field-validator.service';
import { ImageAnalysisService, SelectionCriteria } from './image-analysis.service';

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
  async generatePageContent(_guideId: string, pageId: string): Promise<RedactionResult> {
    try {
      console.log(`🚀 Démarrage rédaction IA pour page ${pageId}`);

      // 1. Charger la page
      const page = await this.db.collection('pages').findOne({ _id: new ObjectId(pageId) });
      if (!page) {
        throw new Error('Page non trouvée');
      }

      // 2. Charger le template
      const template = await this.db.collection('templates').findOne({ _id: new ObjectId(page.template_id) });
      if (!template) {
        throw new Error('Template non trouvé');
      }

      // 3. Charger le contenu source selon la stratégie info_source du template
      let article: any;
      let articleContext: string;
      let extraVars: Record<string, string> = {};

      const infoSource: string = template.info_source ?? 'article_source';

      if (infoSource === 'article_source') {
        // Mode article spécifique : utilise l'article WordPress lié à la page
        if (!page.url_source) {
          throw new Error("Ce template utilise 'article_source' mais aucune url_source n'est définie sur la page");
        }
        article = await this.loadArticleSource(page.url_source);
        if (!article) {
          throw new Error('Article WordPress source non trouvé');
        }
        await this.ensureImagesAnalyzed(article);
        articleContext = this.formatArticle(article);
        console.log(`📄 Mode article_source : ${article.title}`);

      } else if (infoSource === 'cluster_auto_match') {
        // Mode cluster : recherche automatique de l'article "Que faire à <nom du cluster>"
        const clusterName = page.metadata?.cluster_name || page.titre || '';
        article = await this.findBestClusterArticle(clusterName);

        if (article) {
          await this.ensureImagesAnalyzed(article);
          articleContext = this.formatArticle(article);
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

        const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(_guideId) });
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

        const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(_guideId) });

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

      } else if (infoSource === 'tous_articles_site') {
        // Mode tous articles : l'IA se base sur l'ensemble des articles WordPress collectés
        article = null;
        articleContext = await this.buildGeneralContext(_guideId, page);
        console.log(`📚 Mode tous_articles_site`);

      } else if (infoSource === 'tous_articles_et_llm') {
        // Mode tous_articles_et_llm : articles du site + connaissances propres du LLM
        article = null;
        const siteContext = await this.buildGeneralContext(_guideId, page);
        articleContext = `${siteContext}

=== INSTRUCTIONS COMPLÉMENTAIRES ===
Tu peux également t'appuyer sur tes propres connaissances sur cette destination pour enrichir et compléter le contenu généré, dans la mesure où les informations du site ne suffisent pas. Veille toutefois à rester cohérent avec le ton éditorial et les informations présentes dans les articles du site.`;
        console.log(`🧠 Mode tous_articles_et_llm`);

      } else {
        // Mode non_applicable : pas de contexte éditorial (ex: sommaire, page de garde)
        article = null;
        const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(_guideId) });
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

      // Injecter le commentaire interne de l'éditeur s'il est renseigné
      // (valable pour tous les modes — donne des directives éditoriales page par page)
      if (page.commentaire_interne?.trim()) {
        articleContext += `\n\n=== NOTES DE L'ÉDITEUR ===\n${page.commentaire_interne.trim()}\nCes notes doivent orienter et affiner la rédaction de cette page spécifiquement.`;
        console.log(`📝 Commentaire interne injecté dans le contexte`);
      }

      // 5. Extraire les champs avec valeur par défaut (pas d'appel IA pour ceux-ci)
      const defaultContent: Record<string, string> = {};
      const fieldsForAI = template.fields.filter((f: any) => {
        if (f.default_value !== undefined && f.default_value !== null) {
          defaultContent[f.name] = f.default_value;
          console.log(`📌 Valeur par défaut appliquée pour ${f.name}`);
          return false;
        }
        if (f.skip_ai) {
          console.log(`✏️  Saisie manuelle — champ ignoré par l'IA : ${f.name}`);
          return false;
        }
        return true;
      });

      const templateForAI = { ...template, fields: fieldsForAI };

      // Si tous les champs ont une valeur par défaut, pas besoin d'appeler l'IA
      if (fieldsForAI.length === 0) {
        console.log('✅ Tous les champs ont une valeur par défaut — pas d\'appel IA nécessaire');
        return { content: defaultContent, status: 'success', retryCount: 0 };
      }

      // 6. Charger les prompts
      const promptRedaction = await this.loadPrompt('redaction_page');
      const promptRegles = await this.loadPrompt('regles_ecriture');

      // 7. Générer avec retry automatique (uniquement les champs sans default_value)
      const result = await this.generateWithRetry(
        templateForAI,
        articleContext,
        promptRedaction,
        promptRegles,
        article,    // passé pour la substitution de variables dans les ai_instructions
        extraVars   // variables supplémentaires selon le mode (ex: SAISON, MOIS_REFERENCE)
      );

      // 8. Fusionner valeurs par défaut + contenu généré par l'IA
      return {
        ...result,
        content: { ...defaultContent, ...result.content },
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
      const promptDoc = await this.db.collection('prompts').findOne({
        $or: [
          { prompt_id: 'analyse_image', actif: true },
          { intent: 'analyse_image', actif: true },
        ],
      });

      if (!promptDoc) {
        console.warn('⚠️ Prompt analyse_image introuvable (cherché par prompt_id ou intent)');
        // Compter combien de prompts existent en base pour debug
        const totalPrompts = await this.db.collection('prompts').countDocuments();
        const activePrompts = await this.db.collection('prompts').countDocuments({ actif: true });
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
      await this.db.collection('articles_raw').updateOne(
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
    articleSource?: any,                  // article résolu (pour substitution {{URL_ARTICLE_SOURCE}}, etc.)
    extraVars: Record<string, string> = {} // variables supplémentaires (SAISON, MOIS_REFERENCE, etc.)
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
        extraVars
      );

      // Construire le prompt (avec erreurs de la tentative précédente si retry)
      let prompt = this.openaiService.replaceVariables(promptRedaction, {
        REGLES_REGION_LOVERS: promptRegles,
        ARTICLE_WORDPRESS: articleContext,
        TEMPLATE_INSTRUCTIONS: templateInstructions,
      });

      // Ajouter contexte de retry si ce n'est pas la première tentative
      if (retryCount > 0 && previousErrors.length > 0) {
        const errorContext = this.buildRetryContext(previousErrors, generatedContent);
        prompt += `\n\n⚠️ ATTENTION - TENTATIVE ${retryCount + 1}/${this.MAX_RETRIES}\n\n${errorContext}`;
      }

      console.log('📝 Prompt construit, appel OpenAI...');

      // Appeler OpenAI
      const newContent = await this.openaiService.generateJSON(prompt, 16000);

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
    const bestMatch = await this.db.collection('articles_raw').findOne({
      $and: [
        { title: { $regex: namePattern, $options: 'i' } },
        { title: { $regex: 'que faire', $options: 'i' } },
      ],
    });
    if (bestMatch) return bestMatch;

    // 2. Titre contient le nom du cluster (sans contrainte sur "que faire")
    const nameMatch = await this.db.collection('articles_raw').findOne({
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
      const partialMatch = await this.db.collection('articles_raw').findOne({
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
      const exactMatch = await this.db.collection('articles_raw').findOne({
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
      const looseMatch = await this.db.collection('articles_raw').findOne({
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
    const article = await this.db.collection('articles_raw').findOne({
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
  private async buildGeneralContext(guideId: string, page: any): Promise<string> {
    const parts: string[] = [];

    // 1. Métadonnées du guide
    const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(guideId) });
    if (guide) {
      parts.push(`=== GUIDE ===`);
      parts.push(`Destination : ${guide.destination ?? guide.destinations?.[0] ?? 'N/A'}`);
      parts.push(`Année : ${guide.year ?? 'N/A'}`);
      parts.push(`Langue cible : ${guide.language ?? 'fr'}`);
      if (page.titre) parts.push(`Page à rédiger : ${page.titre}`);
      if (page.template_name) parts.push(`Template : ${page.template_name}`);
    }

    // 2. Structure du guide (clusters + POIs)
    const poisDoc = await this.db.collection('pois_selection').findOne({ guide_id: guideId });
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

    // 3. Articles du site WordPress
    // GPT-5 mini dispose de 400 000 tokens de contexte d'entrée.
    // Un article en markdown ≈ 1 000–2 000 tokens → on peut en passer ~150 confortablement
    // (150 × 2 000 = 300 000 tokens, en laissant 100k pour le prompt + output).
    // On préfère le markdown (2–3× plus compact que le HTML).
    const sampleArticles = await this.db
      .collection('articles_raw')
      .find({}, { projection: { title: 1, categories: 1, tags: 1, markdown: 1, html_brut: 1 } })
      .limit(150)
      .toArray();

    if (sampleArticles.length > 0) {
      parts.push(`\n=== CONTENUS WORDPRESS DU SITE (${sampleArticles.length} articles) ===`);
      parts.push(`Ces articles constituent la base éditoriale et informative de la destination.`);
      for (const art of sampleArticles) {
        parts.push(`\n--- ${art.title ?? 'Article'} ---`);
        if (art.categories?.length) parts.push(`Catégories : ${art.categories.join(', ')}`);
        // Markdown en priorité (compact) ; sinon html_brut sans troncature
        const content = art.markdown || art.html_brut || '';
        parts.push(content);
      }
    }

    return parts.join('\n');
  }

  /**
   * Charger un prompt depuis la base
   */
  private async loadPrompt(intent: string): Promise<string> {
    const prompt = await this.db.collection('prompts').findOne({
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
    extraVars: Record<string, string> = {}
  ): string {
    const failedFieldNames = failedFields
      ? this.validatorService.getFailedFields(failedFields)
      : [];

    // Variables disponibles pour la substitution dans les ai_instructions
    const fieldVars: Record<string, string> = {
      URL_ARTICLE_SOURCE:   articleSource?.urls_by_lang?.fr
                            || articleSource?.url
                            || articleSource?.urls_by_lang?.en
                            || '',
      TITRE_ARTICLE_SOURCE: articleSource?.title || '',
      // Variables supplémentaires injectées selon le mode (saison, etc.)
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
            parts.push(`  • "${sf.name}" (${sf.type}${sf.label ? ` — ${sf.label}` : ''})${sfInstr}`);
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

      // ── Champs classiques ────────────────────────────────────────────────────
      if (field.max_chars) {
        parts.push(`⚠️ CALIBRAGE OBLIGATOIRE: ${field.max_chars} caractères MAXIMUM (ne JAMAIS dépasser, viser 95% du calibre)`);
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
  private formatArticle(article: any): string {
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

    // Ajouter les images disponibles
    if (article.images && article.images.length > 0) {
      parts.push('');
      parts.push(`Images disponibles (${article.images.length}):`);
      article.images.forEach((img: string, idx: number) => {
        parts.push(`  ${idx + 1}. ${img}`);
      });
    }

    return parts.join('\n');
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
}
