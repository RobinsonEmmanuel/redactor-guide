import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ValidationResult, ContentValidationReport } from './perplexity.service';

/**
 * Extrait un nom de source lisible depuis le titre et l'URI Gemini.
 * Gemini retourne souvent des URLs vertexaisearch.cloud.google.com (redirections opaques).
 * On préfère donc extraire le nom du site depuis le titre (ex: "Page - Wikipedia" → "wikipedia.org").
 */
function extractSourceDisplayName(uri: string, title: string): string {
  // Si c'est une URL normale (non-redirect), extraire le hostname directement
  if (!uri.includes('vertexaisearch.cloud.google.com')) {
    try {
      return new URL(uri).hostname.replace(/^www\./, '');
    } catch {
      // fall through
    }
  }

  // Extraire le nom de site depuis le titre (pattern "Titre - NomSite" ou "Titre | NomSite")
  if (title) {
    const separators = [' - ', ' | ', ' – ', ' — '];
    for (const sep of separators) {
      const parts = title.split(sep);
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        // Garder si c'est court (probablement un nom de site)
        if (lastPart.length > 0 && lastPart.length < 60) {
          // Essayer de transformer en hostname-like si ça ressemble à un domaine
          const lc = lastPart.toLowerCase().replace(/\s+/g, '');
          if (lc.includes('.') && !lc.includes(' ')) return lc;
          // Sinon retourner tel quel (ex: "Wikipedia", "Gobierno de Canarias")
          return lastPart;
        }
      }
    }
    // Pas de séparateur : tronquer le titre
    return title.length > 45 ? title.substring(0, 42) + '…' : title;
  }

  return 'source';
}

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

    const researchPrompt = `Tu es un fact-checker expert en tourisme. Utilise tes sources web pour vérifier chaque information sur "${poiName}" (${destination}).

Informations à vérifier :
${fieldsText}

Pour CHAQUE point, fournis une analyse détaillée :
1. Verdict : correct / incorrect / incertain
2. Ce que tu as trouvé en ligne (valeur réelle confirmée par tes sources)
3. Si incorrect : quelle est la valeur correcte et pourquoi
4. Explication détaillée de ta vérification (2-3 phrases minimum) : que disent tes sources ? Y a-t-il des contradictions entre sources ?
5. URL de la source principale utilisée

Pour les champs de type picto (ex. niveau de recommandation, accessibilité) : vérifie si la valeur choisie est cohérente avec la réputation et les caractéristiques réelles du lieu.`;

    const groundingResult = await groundingModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    } as any);

    const groundingResponse = groundingResult.response;
    const researchText = groundingResponse.text();

    const candidate = (groundingResponse as any).candidates?.[0];
    const groundingChunks: Array<{ uri: string; title: string; display_name: string }> =
      candidate?.groundingMetadata?.groundingChunks
        ?.map((c: any) => {
          const uri = c.web?.uri || '';
          const title = c.web?.title || '';
          return { uri, title, display_name: extractSourceDisplayName(uri, title) };
        })
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

IMPORTANT pour le champ "comment" : sois précis et détaillé. Indique ce que tu as trouvé, ce qui est confirmé, ce qui diffère. Minimum 1 phrase complète, maximum 300 caractères.

Format attendu (un objet par champ, champs disponibles : ${fieldsList}) :
{"results":[{"field":"nom_du_champ","label":"Libellé du champ","value":"valeur originale fournie","status":"valid|invalid|uncertain","correction":"valeur corrigée ou null","source_url":"URL ou null","source_title":"Titre source ou null","comment":"explication détaillée de la vérification, ce qui est confirmé ou non, max 300 caractères"}]}`;

    const jsonResult = await jsonModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: jsonPrompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
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
      const chunk = groundingChunks[idx] ?? (r.status !== 'valid' ? groundingChunks[0] : null);
      if (!r.source_url && chunk) {
        return {
          ...r,
          source_url: chunk.uri,
          source_title: chunk.title,
          source_display_name: chunk.display_name,
        };
      }
      // Calculer display_name pour les sources déjà fournies par l'IA
      if (r.source_url) {
        return {
          ...r,
          source_display_name: extractSourceDisplayName(r.source_url, r.source_title || ''),
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
