import {
  TranslationRequest,
  TranslationRequestSchema,
  TranslationResponse,
} from '../schemas/ai-response.schema';
import { IPromptService } from './prompt.service';

/**
 * Interface du service de traduction
 */
export interface ITranslationService {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

/**
 * Service de traduction
 * 
 * Responsabilités :
 * - Traduire du texte via IA ou DeepL
 * - Utiliser les prompts stockés en base
 * - Valider les entrées/sorties avec Zod
 * 
 * Note : Implémentation de base, à compléter avec les appels IA réels
 */
export class TranslationService implements ITranslationService {
  /**
   * Injection de dépendances via constructeur
   */
  constructor(
    private readonly promptService: IPromptService
  ) {}

  /**
   * Traduire un texte
   */
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    // Validation de la requête avec Zod
    const validatedRequest = TranslationRequestSchema.parse(request);

    // Récupérer le prompt de traduction
    const promptText = await this.promptService.renderPrompt('translation', {
      text: validatedRequest.text,
      sourceLanguage: validatedRequest.sourceLanguage,
      targetLanguage: validatedRequest.targetLanguage,
      context: validatedRequest.context || '',
    });

    // TODO: Appel à l'API IA (OpenAI, Anthropic, etc.)
    // Pour l'instant, retour d'un placeholder
    const translatedText = `[Traduction ${validatedRequest.targetLanguage}] ${validatedRequest.text}`;

    return {
      originalText: validatedRequest.text,
      translatedText,
      sourceLanguage: validatedRequest.sourceLanguage,
      targetLanguage: validatedRequest.targetLanguage,
      method: 'ai',
      confidence: 0.95,
      metadata: {
        promptUsed: promptText,
      },
    };
  }
}
