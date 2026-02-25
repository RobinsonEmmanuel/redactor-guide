export interface ValidationResult {
  field: string;
  label: string;
  value: string;
  // Vérification factuelle (Perplexity grounding)
  status: 'valid' | 'invalid' | 'uncertain';
  correction?: string;
  source_url?: string;
  source_title?: string;
  comment: string;
  // Cohérence avec l'article source (OpenAI)
  article_consistency?: 'present' | 'absent' | 'partial' | 'not_checked';
  article_excerpt?: string;
  article_comment?: string;
}

export interface ContentValidationReport {
  validated_at: string;
  overall_status: 'valid' | 'issues_found' | 'error';
  results: ValidationResult[];
  raw_response?: string;
  grounding_sources?: Array<{ uri: string; title: string; display_name: string }>;
}

export class PerplexityService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'sonar') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Valide le contenu d'une fiche POI via Perplexity (grounding web en temps réel).
   * Pour chaque champ textuel fourni, vérifie la véracité et retourne une correction + source si nécessaire.
   */
  async validatePageContent(
    poiName: string,
    destination: string,
    fields: Array<{ name: string; label: string; value: string }>
  ): Promise<ContentValidationReport> {
    const fieldsText = fields
      .map((f) => `- ${f.label} : "${f.value}"`)
      .join('\n');

    const prompt = `Tu es un fact-checker expert en tourisme. Valide les informations suivantes sur "${poiName}" (destination : ${destination}).

Pour chaque information, vérifie sa véracité grâce à tes sources en temps réel et retourne un objet JSON strictement structuré.

Informations à vérifier :
${fieldsText}

Retourne UNIQUEMENT un JSON valide, sans texte additionnel, avec cette structure exacte :
{
  "results": [
    {
      "field": "nom_du_champ",
      "label": "Libellé lisible",
      "value": "valeur fournie",
      "status": "valid | invalid | uncertain",
      "correction": "valeur corrigée si incorrect, null sinon",
      "source_url": "URL de la source utilisée ou null",
      "source_title": "Titre de la source ou null",
      "comment": "Explication courte (max 120 caractères)"
    }
  ]
}

Règles :
- "valid" : l'information est correcte selon tes sources
- "invalid" : l'information est factuellement incorrecte (donne la correction et la source)
- "uncertain" : impossible de confirmer ou infirmer avec certitude
- Ne valide que les champs contenant une vraie affirmation factuelle (ignore les textes marketing vagues)
- Utilise toujours des sources récentes et fiables`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        return_citations: true,
        search_recency_filter: 'month',
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Perplexity API error ${response.status}: ${err}`);
    }

    const data = await response.json() as any;
    const rawContent: string = data.choices?.[0]?.message?.content || '';

    // Nettoyer le JSON (parfois encadré de ```json ... ```)
    const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed: { results: ValidationResult[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Impossible de parser la réponse Perplexity: ${cleaned.substring(0, 300)}`);
    }

    return {
      validated_at: new Date().toISOString(),
      overall_status: parsed.results.some((r) => r.status === 'invalid') ? 'issues_found' : 'valid',
      results: parsed.results,
      raw_response: rawContent,
    };
  }
}
