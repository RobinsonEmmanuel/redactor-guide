import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIService {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'gpt-4o-mini';
  }

  /**
   * Appeler OpenAI avec un prompt et récupérer une réponse JSON
   */
  async generateJSON(prompt: string, maxTokens: number = 4000): Promise<any> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Tu es un assistant qui répond UNIQUEMENT en JSON valide, sans markdown ni formatage.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Aucune réponse de OpenAI');
      }

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
