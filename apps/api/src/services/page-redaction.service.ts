import { Db, ObjectId } from 'mongodb';
import { OpenAIService } from './openai.service';
import { FieldValidatorService, ValidationError } from './field-validator.service';

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
  private readonly MAX_RETRIES = 3;

  constructor(private readonly db: Db, openaiApiKey: string) {
    this.openaiService = new OpenAIService({
      apiKey: openaiApiKey,
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
    });
    this.validatorService = new FieldValidatorService();
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

      // 3. Charger l'article WordPress source
      const article = await this.loadArticleSource(page.url_source);
      if (!article) {
        throw new Error('Article WordPress source non trouvé');
      }

      // 4. Charger les prompts
      const promptRedaction = await this.loadPrompt('redaction_page');
      const promptRegles = await this.loadPrompt('regles_ecriture');

      // 5. Générer avec retry automatique
      const result = await this.generateWithRetry(
        template,
        article,
        promptRedaction,
        promptRegles
      );

      return result;
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
   * Génère le contenu avec retry automatique si validation échoue
   */
  private async generateWithRetry(
    template: any,
    article: any,
    promptRedaction: string,
    promptRegles: string
  ): Promise<RedactionResult> {
    let generatedContent: Record<string, any> = {};
    let retryCount = 0;
    let previousErrors: ValidationError[] = [];

    while (retryCount < this.MAX_RETRIES) {
      console.log(`🔄 Tentative ${retryCount + 1}/${this.MAX_RETRIES}`);

      // Construire les instructions du template (avec règles de validation)
      const templateInstructions = this.buildTemplateInstructions(
        template,
        previousErrors
      );

      // Construire le prompt (avec erreurs de la tentative précédente si retry)
      let prompt = this.openaiService.replaceVariables(promptRedaction, {
        REGLES_REGION_LOVERS: promptRegles,
        ARTICLE_WORDPRESS: this.formatArticle(article),
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
2. Respecte IMPÉRATIVEMENT les règles de validation (longueur, mots interdits, etc.)
3. Les autres champs sont déjà corrects, ne les modifie PAS`;
  }

  /**
   * Sleep helper pour backoff progressif
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Charger un article WordPress depuis la base
   */
  private async loadArticleSource(urlSource?: string): Promise<any> {
    if (!urlSource) {
      throw new Error('URL source manquante');
    }

    // Chercher l'article par son URL française
    const article = await this.db.collection('articles_raw').findOne({
      'urls_by_lang.fr': urlSource,
    });

    return article;
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
   * Construire les instructions pour chaque champ du template
   */
  private buildTemplateInstructions(
    template: any,
    failedFields?: ValidationError[]
  ): string {
    const failedFieldNames = failedFields
      ? this.validatorService.getFailedFields(failedFields)
      : [];

    const instructions = template.fields.map((field: any) => {
      const isFailed = failedFieldNames.includes(field.name);
      const parts = [
        `Champ: ${field.name}${isFailed ? ' ⚠️ EN ERREUR - À CORRIGER' : ''}`,
        `Type: ${field.type}`,
      ];

      if (field.label) {
        parts.push(`Label: ${field.label}`);
      }

      if (field.max_chars) {
        parts.push(`Calibre MAX: ${field.max_chars} caractères (IMPÉRATIF)`);
      }

      if (field.ai_instructions) {
        parts.push(`Instructions: ${field.ai_instructions}`);
      }

      // Ajouter les règles de validation si présentes
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
      rules.push('- Champ OBLIGATOIRE');
    }
    if (validation.max_length) {
      rules.push(`- Longueur MAX: ${validation.max_length} caractères`);
    }
    if (validation.min_length) {
      rules.push(`- Longueur MIN: ${validation.min_length} caractères`);
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
      `URL: ${article.url_francais || 'N/A'}`,
      '',
      `Contenu HTML:`,
      article.html_raw || '',
    ];

    if (article.categories && article.categories.length > 0) {
      parts.unshift(`Catégories: ${article.categories.join(', ')}`);
    }

    if (article.tags && article.tags.length > 0) {
      parts.unshift(`Tags: ${article.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}
