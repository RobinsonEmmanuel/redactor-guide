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
   *
   * IMPORTANT pour les modèles avec reasoning : max_output_tokens inclut
   * les tokens de raisonnement interne. Toujours passer une valeur suffisante
   * (≥ 8000) pour ne pas étouffer la réponse textuelle.
   */
  async generateJSON(prompt: string, maxOutputTokens: number = 12000, maxRetries: number = 3): Promise<any> {
    const useReasoning = supportsReasoning(this.model);
    // Pour les modèles avec reasoning, imposer un minimum de 8000 tokens
    // afin que le raisonnement interne ne consomme pas toute la fenêtre.
    const effectiveMaxTokens = useReasoning ? Math.max(maxOutputTokens, 8000) : maxOutputTokens;

    let lastError: Error = new Error('Aucune tentative effectuée');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        const delay = attempt * 3000;
        console.log(`⏳ OpenAI retry ${attempt}/${maxRetries} dans ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        console.log(`🤖 Appel OpenAI - Modèle: ${this.model}, Max tokens: ${effectiveMaxTokens}${useReasoning ? `, Reasoning: ${this.reasoningEffort}` : ''}${attempt > 1 ? ` (tentative ${attempt}/${maxRetries})` : ''}`);

        let content: string;

        if (useReasoning) {
          // API Responses (gpt-5-mini, o3, o4-mini…)
          const response = await this.client.responses.create({
            model: this.model,
            reasoning: { effort: this.reasoningEffort },
            max_output_tokens: effectiveMaxTokens,
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
            max_tokens: effectiveMaxTokens,
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
          throw new Error('Réponse OpenAI vide (contenu extrait vide)');
        }

        console.log(`✅ Réponse OpenAI reçue (${content.length} caractères)`);

        // Nettoyer le contenu (enlever markdown, espaces, etc.)
        let cleanedContent = content.trim();
        if (cleanedContent.startsWith('```json')) {
          cleanedContent = cleanedContent.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
        } else if (cleanedContent.startsWith('```')) {
          cleanedContent = cleanedContent.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
        }
        cleanedContent = cleanedContent.trim();

        console.log(`📝 Début: "${cleanedContent.substring(0, 100)}..."`);
        console.log(`📝 Fin: "...${cleanedContent.substring(cleanedContent.length - 100)}"`);

        try {
          return JSON.parse(cleanedContent);
        } catch (parseError: any) {
          console.error('❌ Erreur parsing JSON:', parseError.message);
          console.error('📄 Contenu complet reçu:', content);
          throw new Error(`Erreur parsing JSON: ${parseError.message}`);
        }

      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Erreur OpenAI (tentative ${attempt}/${maxRetries}): ${lastError.message}`);
        if ((error as any).response) {
          console.error('Détails erreur API:', (error as any).response.data);
        }
        // Ne pas retenter sur les erreurs de parsing JSON (le contenu est reçu mais invalide)
        if (lastError.message.startsWith('Erreur parsing JSON')) {
          break;
        }
      }
    }

    throw new Error(`Erreur lors de l'appel à OpenAI: ${lastError.message}`);
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
