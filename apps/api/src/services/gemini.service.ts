import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ValidationResult, ContentValidationReport } from './perplexity.service';

export class GeminiService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Valide le contenu d'une fiche POI via Gemini 2.5 Flash Lite avec Search Grounding.
   *
   * Stratégie deux passes :
   * 1. Appel avec googleSearch → réponse factuelle en prose + groundingChunks
   * 2. Appel sans outils → structuration en JSON à partir de la prose
   *
   * Gemini ignore souvent les instructions de format quand le grounding est actif ;
   * la deuxième passe garantit un JSON propre.
   */
  async validatePageContent(
    poiName: string,
    destination: string,
    fields: Array<{ name: string; label: string; value: string }>
  ): Promise<ContentValidationReport> {
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const fieldsText = fields.map(f => `- ${f.label} (champ: ${f.name}) : "${f.value}"`).join('\n');

    // ── Passe 1 : recherche factuelle avec grounding ───────────────────────────
    const groundingModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      tools: [{ googleSearch: {} }] as any,
    });

    const researchPrompt = `Tu es un fact-checker expert en tourisme.
Recherche des informations fiables sur "${poiName}" (${destination}) et vérifie chaque point ci-dessous.

Informations à vérifier :
${fieldsText}

Pour chaque point indique :
- si l'information est correcte, incorrecte ou incertaine
- la valeur correcte si elle est inexacte
- une courte explication factuelle (max 120 caractères)
- l'URL de la source utilisée si disponible`;

    const groundingResult = await groundingModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    } as any);

    const groundingResponse = groundingResult.response;
    const researchText = groundingResponse.text();

    const candidate = (groundingResponse as any).candidates?.[0];
    const groundingChunks: Array<{ uri: string; title: string }> =
      candidate?.groundingMetadata?.groundingChunks
        ?.map((c: any) => ({ uri: c.web?.uri || '', title: c.web?.title || '' }))
        .filter((c: any) => c.uri) || [];

    // ── Passe 2 : structuration JSON sans outils ───────────────────────────────
    const jsonModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
    });

    const fieldsList = fields.map(f => `"${f.name}"`).join(', ');
    const sourcesHint = groundingChunks.length
      ? `\nSources disponibles :\n${groundingChunks.map((c, i) => `${i + 1}. ${c.uri} — ${c.title}`).join('\n')}`
      : '';

    const jsonPrompt = `Voici le résultat d'une vérification factuelle sur "${poiName}" :

--- RÉSULTAT DE RECHERCHE ---
${researchText}
---${sourcesHint}

Champs originaux vérifiés (dans l'ordre) :
${fieldsText}

Convertis ce résultat en JSON strict. Retourne UNIQUEMENT l'objet JSON, sans markdown, sans backticks, sans texte avant ou après.

Format attendu (un objet par champ, champs disponibles : ${fieldsList}) :
{"results":[{"field":"nom_du_champ","label":"Libellé du champ","value":"valeur originale fournie","status":"valid|invalid|uncertain","correction":"valeur corrigée ou null","source_url":"URL ou null","source_title":"Titre source ou null","comment":"explication max 120 caractères"}]}`;

    const jsonResult = await jsonModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: jsonPrompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });

    let rawJson = jsonResult.response.text().trim();

    // Nettoyage défensif des blocs markdown éventuels
    rawJson = rawJson
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/`/g, "'")
      .trim();

    const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Pas de JSON dans la réponse de structuration Gemini: ${rawJson.substring(0, 400)}`);
    }

    let parsed: { results: ValidationResult[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error(`Impossible de parser le JSON Gemini: ${jsonMatch[0].substring(0, 400)}`);
    }

    // Enrichir avec les sources grounding si l'IA n'a pas fourni d'URL
    const results = parsed.results.map((r, idx) => {
      if (!r.source_url && groundingChunks[idx]) {
        return { ...r, source_url: groundingChunks[idx].uri, source_title: groundingChunks[idx].title };
      }
      if (!r.source_url && r.status !== 'valid' && groundingChunks[0]) {
        return { ...r, source_url: groundingChunks[0].uri, source_title: groundingChunks[0].title };
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
