import { Db, Collection } from 'mongodb';
import type { Prompt } from '@redactor-guide/core-model';
import { PromptSchema } from '@redactor-guide/core-model';

/**
 * Interface du service de prompts
 */
export interface IPromptService {
  getPromptByIntent(intent: string, pageType?: string, langue?: string): Promise<Prompt | null>;
  renderPrompt(promptOrKey: Prompt | string, variables: Record<string, string>): Promise<string>;
}

/**
 * Service de gestion des prompts IA
 * 
 * Responsabilités :
 * - Récupérer les prompts depuis MongoDB
 * - Rendre les templates avec les variables
 * - Gérer le cache des prompts
 */
export class PromptService implements IPromptService {
  private promptsCollection: Collection<Prompt>;
  private cache = new Map<string, Prompt>();

  /**
   * Injection de dépendances via constructeur
   */
  constructor(private readonly db: Db) {
    this.promptsCollection = this.db.collection<Prompt>('prompts');
  }

  /**
   * Récupérer un prompt par son intent (avec résolution fallback)
   */
  async getPromptByIntent(
    intent: string,
    pageType?: string,
    langue: string = 'fr'
  ): Promise<Prompt | null> {
    const cacheKey = `${intent}-${pageType || 'none'}-${langue}`;
    
    // Vérifier le cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Stratégie de résolution avec fallback
    // 1. intent + page_type + langue
    let prompt = await this.promptsCollection.findOne({
      intent: intent as any,
      page_type: pageType as any,
      langue_source: langue,
      actif: true,
    } as any);

    // 2. intent + langue
    if (!prompt && pageType) {
      prompt = await this.promptsCollection.findOne({
        intent: intent as any,
        page_type: { $exists: false },
        langue_source: langue,
        actif: true,
      } as any);
    }

    // 3. intent + langue par défaut (fr)
    if (!prompt && langue !== 'fr') {
      prompt = await this.promptsCollection.findOne({
        intent: intent as any,
        langue_source: 'fr',
        actif: true,
      } as any);
    }

    if (!prompt) {
      return null;
    }

    // Valider avec Zod
    const validatedPrompt = PromptSchema.parse(prompt);

    // Mettre en cache
    this.cache.set(cacheKey, validatedPrompt);

    return validatedPrompt;
  }

  /**
   * Rendre un template de prompt avec les variables
   * Accepte soit un objet Prompt, soit une clé de prompt (pour compatibilité)
   */
  async renderPrompt(
    promptOrKey: Prompt | string,
    variables: Record<string, string>
  ): Promise<string> {
    let prompt: Prompt;

    // Si c'est une string, c'est une clé legacy
    if (typeof promptOrKey === 'string') {
      const foundPrompt = await this.getPromptByIntent(promptOrKey);
      if (!foundPrompt) {
        throw new Error(`Prompt avec la clé "${promptOrKey}" introuvable`);
      }
      prompt = foundPrompt;
    } else {
      prompt = promptOrKey;
    }

    // Remplacer les variables dans le texte_prompt
    let rendered = prompt.texte_prompt;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(regex, value);
    }

    return rendered;
  }

  /**
   * Nettoyer le cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
