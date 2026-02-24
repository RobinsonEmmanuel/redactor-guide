import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ValidationResult, ContentValidationReport } from './perplexity.service';

export class GeminiService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Valide le contenu d'une fiche POI via Gemini 2.5 Flash Lite avec Search Grounding.
   * Pour chaque champ textuel, vérifie la véracité factuelle et retourne correction + source.
   */
  async validatePageContent(
    poiName: string,
    destination: string,
    fields: Array<{ name: string; label: string; value: string }>
  ): Promise<ContentValidationReport> {
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      tools: [{ googleSearch: {} }] as any,
    });

    const fieldsText = fields.map(f => `- ${f.label} (champ: ${f.name}) : "${f.value}"`).join('\n');

    const prompt = `Tu es un fact-checker expert en tourisme. Vérifie la véracité de chaque information sur "${poiName}" (${destination}) en utilisant tes sources web.

Informations à vérifier :
${fieldsText}

Pour chaque champ, détermine :
- "valid" : information correcte et confirmée par des sources
- "invalid" : information factuellement incorrecte (précise la valeur correcte)
- "uncertain" : impossible à confirmer ou infirmer avec certitude

Retourne UNIQUEMENT un objet JSON valide sans markdown ni backticks :
{ "results": [ { "field": "nom_du_champ", "label": "Libellé", "value": "valeur fournie", "status": "valid|invalid|uncertain", "correction": "valeur corrigée ou null", "source_url": "URL source trouvée ou null", "source_title": "Titre de la source ou null", "comment": "explication factuelle max 120 caractères" } ] }`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    } as any);

    const response = result.response;
    let rawText = response.text();

    // Extraire les sources depuis les grounding chunks
    const candidate = (response as any).candidates?.[0];
    const groundingChunks: Array<{ uri: string; title: string }> =
      candidate?.groundingMetadata?.groundingChunks
        ?.map((c: any) => ({ uri: c.web?.uri || '', title: c.web?.title || '' }))
        .filter((c: any) => c.uri) || [];

    // Nettoyer le JSON (Gemini peut ajouter des backticks même si demandé sans)
    rawText = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: { results: ValidationResult[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Tentative d'extraction du JSON si du texte entoure le bloc
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`Impossible de parser la réponse Gemini: ${rawText.substring(0, 300)}`);
      }
    }

    // Enrichir les résultats avec les sources grounding si l'IA n'a pas fourni d'URL
    const results = parsed.results.map((r, idx) => {
      if (!r.source_url && groundingChunks[idx]) {
        return {
          ...r,
          source_url: groundingChunks[idx].uri,
          source_title: groundingChunks[idx].title,
        };
      }
      // Fallback : associer la première source disponible aux champs invalid/uncertain
      if (!r.source_url && r.status !== 'valid' && groundingChunks[0]) {
        return {
          ...r,
          source_url: groundingChunks[0].uri,
          source_title: groundingChunks[0].title,
        };
      }
      return r;
    });

    return {
      validated_at: new Date().toISOString(),
      overall_status: results.some(r => r.status === 'invalid') ? 'issues_found' : 'valid',
      results,
      grounding_sources: groundingChunks,
    };
  }
}
