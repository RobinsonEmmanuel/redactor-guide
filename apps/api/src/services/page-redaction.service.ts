import { Db, ObjectId } from 'mongodb';
import { OpenAIService } from './openai.service';

export interface RedactionRequest {
  guideId: string;
  pageId: string;
}

export interface RedactionResult {
  content: Record<string, any>;
  status: 'success' | 'error';
  error?: string;
}

export class PageRedactionService {
  private openaiService: OpenAIService;

  constructor(private readonly db: Db, openaiApiKey: string) {
    this.openaiService = new OpenAIService({
      apiKey: openaiApiKey,
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
    });
  }

  /**
   * Générer le contenu d'une page via IA
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

      // 5. Construire les instructions du template
      const templateInstructions = this.buildTemplateInstructions(template);

      // 6. Construire le prompt final
      const prompt = this.openaiService.replaceVariables(promptRedaction, {
        REGLES_REGION_LOVERS: promptRegles,
        ARTICLE_WORDPRESS: this.formatArticle(article),
        TEMPLATE_INSTRUCTIONS: templateInstructions,
      });

      console.log('📝 Prompt construit, appel OpenAI...');

      // 7. Appeler OpenAI
      const generatedContent = await this.openaiService.generateJSON(prompt, 16000);

      console.log('✅ Contenu généré avec succès');

      return {
        content: generatedContent,
        status: 'success',
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
  private buildTemplateInstructions(template: any): string {
    const instructions = template.fields.map((field: any) => {
      const parts = [
        `Champ: ${field.name}`,
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

      return parts.join('\n');
    });

    return instructions.join('\n\n---\n\n');
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
