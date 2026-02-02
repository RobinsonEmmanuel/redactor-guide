import { Db, Collection } from 'mongodb';
import { Prompt, PromptSchema } from '@redactor-guide/core-model';

/**
 * Interface du service de prompts
 */
export interface IPromptService {
  getPromptByKey(key: string): Promise<Prompt | null>;
  renderPrompt(promptKey: string, variables: Record<string, string>): Promise<string>;
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
   * Récupérer un prompt par sa clé
   */
  async getPromptByKey(key: string): Promise<Prompt | null> {
    // Vérifier le cache
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Récupérer depuis la base
    const prompt = await this.promptsCollection.findOne({
      key,
      isActive: true,
    });

    if (!prompt) {
      return null;
    }

    // Valider avec Zod
    const validatedPrompt = PromptSchema.parse(prompt);

    // Mettre en cache
    this.cache.set(key, validatedPrompt);

    return validatedPrompt;
  }

  /**
   * Rendre un template de prompt avec les variables
   */
  async renderPrompt(
    promptKey: string,
    variables: Record<string, string>
  ): Promise<string> {
    const prompt = await this.getPromptByKey(promptKey);

    if (!prompt) {
      throw new Error(`Prompt avec la clé "${promptKey}" introuvable`);
    }

    // Vérifier que toutes les variables requises sont fournies
    const missingVars = prompt.variables.filter((v) => !(v in variables));
    if (missingVars.length > 0) {
      throw new Error(
        `Variables manquantes pour le prompt "${promptKey}": ${missingVars.join(', ')}`
      );
    }

    // Remplacer les variables dans le template
    let rendered = prompt.template;
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
