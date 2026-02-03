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
    this.model = config.model || 'gpt-5-mini';
    this.reasoningEffort = config.reasoningEffort || 'medium';
  }

  /**
   * Appeler OpenAI avec un prompt et récupérer une réponse JSON
   * Utilise l'API Responses pour GPT-5-mini avec raisonnement
   */
  async generateJSON(prompt: string, maxOutputTokens: number = 4000): Promise<any> {
    try {
      console.log(`🤖 Appel OpenAI - Modèle: ${this.model}, Max tokens: ${maxOutputTokens}, Reasoning: ${this.reasoningEffort}`);
      
      const response = await this.client.responses.create({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        max_output_tokens: maxOutputTokens,
        input: [
          {
            role: 'user',
            content: [
              { 
                type: 'input_text', 
                text: `Tu es un assistant qui répond UNIQUEMENT en JSON valide, sans markdown ni formatage.\n\n${prompt}` 
              }
            ]
          }
        ]
      });

      // Extraction correcte du texte selon la syntaxe GPT-5
      const content = response.output
        .flatMap((item: any) => item.content || [])
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('\n');

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
