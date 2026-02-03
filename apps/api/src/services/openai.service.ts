import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export class OpenAIService {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'gpt-4o-mini'; // Modèle standard qui fonctionne
  }

  /**
   * Appeler OpenAI avec un prompt et récupérer une réponse JSON
   * Utilise l'API Chat Completions standard
   */
  async generateJSON(prompt: string, maxOutputTokens: number = 4000): Promise<any> {
    try {
      console.log(`🤖 Appel OpenAI - Modèle: ${this.model}, Max tokens: ${maxOutputTokens}`);
      
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
        max_tokens: maxOutputTokens,
        temperature: 0.7,
        response_format: { type: 'json_object' }, // Force la réponse JSON
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        console.error('Réponse OpenAI vide:', JSON.stringify(response, null, 2));
        throw new Error('Aucune réponse de OpenAI');
      }

      console.log(`✅ Réponse OpenAI reçue (${content.length} caractères)`);

      // Parser le JSON de la réponse
      return JSON.parse(content);
    } catch (error: any) {
      console.error('❌ Erreur OpenAI:', error.message);
      if (error.response) {
        console.error('Détails erreur API:', error.response.data);
      }
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
