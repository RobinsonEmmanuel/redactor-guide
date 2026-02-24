import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * Modèles qui supportent l'API Responses avec reasoning.
 * Les modèles gpt-4o/gpt-4o-mini utilisent Chat Completions (pas de reasoning).
 */
function supportsReasoning(model: string): boolean {
  return (
    model.startsWith('gpt-5') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  );
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
   * Appeler OpenAI avec un prompt et récupérer une réponse JSON.
   * - Modèles gpt-5 / o-series : API Responses avec reasoning
   * - Modèles gpt-4o / gpt-4o-mini : API Chat Completions (pas de reasoning)
   */
  async generateJSON(prompt: string, maxOutputTokens: number = 12000): Promise<any> {
    try {
      const useReasoning = supportsReasoning(this.model);
      console.log(`🤖 Appel OpenAI - Modèle: ${this.model}, Max tokens: ${maxOutputTokens}${useReasoning ? `, Reasoning: ${this.reasoningEffort}` : ''}`);

      let content: string;

      if (useReasoning) {
        // API Responses (gpt-5-mini, o3, o4-mini…)
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
                  text: `Tu es un assistant qui répond UNIQUEMENT en JSON valide, sans markdown ni formatage.\n\n${prompt}`,
                },
              ],
            },
          ],
        } as any);

        content = response.output
          .flatMap((item: any) => item.content || [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text)
          .join('\n');
      } else {
        // Chat Completions (gpt-4o-mini, gpt-4o…)
        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: maxOutputTokens,
          messages: [
            {
              role: 'user',
              content: `Tu es un assistant qui répond UNIQUEMENT en JSON valide, sans markdown ni formatage.\n\n${prompt}`,
            },
          ],
        });

        content = response.choices[0]?.message?.content ?? '';
      }

      if (!content) {
        console.error('Réponse OpenAI vide:', JSON.stringify(response, null, 2));
        throw new Error('Aucune réponse de OpenAI');
      }

      console.log(`✅ Réponse OpenAI reçue (${content.length} caractères)`);

      // Nettoyer le contenu (enlever markdown, espaces, etc.)
      let cleanedContent = content.trim();
      
      // Enlever les balises markdown JSON si présentes
      if (cleanedContent.startsWith('```json')) {
        cleanedContent = cleanedContent.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
      } else if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
      }
      
      cleanedContent = cleanedContent.trim();
      
      // Log des premiers et derniers caractères pour debug
      console.log(`📝 Contenu nettoyé - Début: "${cleanedContent.substring(0, 100)}..."`);
      console.log(`📝 Contenu nettoyé - Fin: "...${cleanedContent.substring(cleanedContent.length - 100)}"`);

      // Parser le JSON de la réponse
      try {
        return JSON.parse(cleanedContent);
      } catch (parseError: any) {
        console.error('❌ Erreur parsing JSON:', parseError.message);
        console.error('📄 Contenu complet reçu:', content);
        throw new Error(`Erreur parsing JSON: ${parseError.message}`);
      }
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
