import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export class OpenAIService {
  private client: OpenAI;
  private model: string;
  private reasoningEffort: 'low' | 'medium' | 'high';

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'gpt-5-mini-2025-08-07';
    this.reasoningEffort = config.reasoningEffort || 'medium';
  }

  /**
   * Appeler OpenAI avec un prompt et récupérer une réponse JSON
   * Utilise la nouvelle Responses API pour GPT-5
   */
  async generateJSON(prompt: string, maxOutputTokens: number = 4000): Promise<any> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content: 'Tu es un assistant qui répond UNIQUEMENT en JSON valide, sans markdown ni formatage.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        reasoning: {
          effort: this.reasoningEffort,
        },
        max_output_tokens: maxOutputTokens,
      });

      const content = response.output_text;
      if (!content) {
        throw new Error('Aucune réponse de OpenAI');
      }

      // Parser le JSON de la réponse
      return JSON.parse(content);
    } catch (error: any) {
      console.error('Erreur OpenAI:', error);
      throw new Error(`Erreur lors de l\'appel à OpenAI: ${error.message}`);
    }
  }

  /**
   * Remplacer les variables dans un prompt
   */
  replaceVariables(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }
}
