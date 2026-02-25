export interface ValidationPoint {
  point: string;           // Description de l'information vérifiée
  source_display?: string; // Nom lisible de la source (ex: "Wikipedia")
  source_url?: string;     // URL de la source
}

export interface InvalidPoint extends ValidationPoint {
  correction: string;      // Valeur alternative trouvée par les sources
}

export interface ValidationResult {
  field: string;
  label: string;
  value: string;
  // Vérification factuelle (Gemini Search Grounding)
  status: 'valid' | 'invalid' | 'uncertain';
  validated_points?: ValidationPoint[];  // Informations confirmées par les sources
  invalid_points?: InvalidPoint[];       // Informations contredites par les sources
  correction?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  source_display_name?: string;
  comment?: string | null;
  // Cohérence avec l'article source (OpenAI)
  article_consistency?: 'present' | 'absent' | 'partial' | 'not_checked';
  article_excerpt?: string | null;
  article_comment?: string | null;
}

export interface ContentValidationReport {
  validated_at: string;
  overall_status: 'valid' | 'issues_found' | 'error';
  results: ValidationResult[];
  raw_response?: string;
  grounding_sources?: Array<{ uri: string; title: string; display_name: string }>;
}

/** Extrait un hostname lisible depuis une URL Perplexity (vraies URLs, pas de redirections). */
function perplexityDisplayName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export class PerplexityService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'sonar') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Valide le contenu d'une fiche POI via Perplexity Sonar (search grounding temps réel).
   *
   * Le prompt est passé en paramètre (chargé depuis MongoDB par la route appelante).
   * Les citations Perplexity (`citations[]`) sont mappées aux `source_ref` des points
   * pour fournir de vraies URLs lisibles.
   *
   * @param renderedPrompt Prompt déjà résolu (variables injectées) depuis la collection prompts
   */
  async validatePageContent(
    renderedPrompt: string,
  ): Promise<ContentValidationReport> {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: renderedPrompt }],
        return_citations: true,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Perplexity API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as any;
    const rawContent: string = data.choices?.[0]?.message?.content || '';

    // Citations Perplexity : tableau d'URLs dans l'ordre d'apparition [1], [2]...
    const citations: string[] = data.citations || [];
    const groundingSources = citations
      .filter((u) => u && !u.includes('canarias-lovers.com'))
      .map((uri) => ({ uri, title: perplexityDisplayName(uri), display_name: perplexityDisplayName(uri) }));

    // Nettoyer le JSON (parfois encadré de ```json ... ```)
    let cleaned = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Pas de JSON dans la réponse Perplexity: ${cleaned.substring(0, 300)}`);
    }

    let parsed: { results: ValidationResult[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error(`Impossible de parser la réponse Perplexity: ${jsonMatch[0].substring(0, 300)}`);
    }

    // Mapper les source_ref (numéros de citation 1-based) aux vraies URLs
    const mapPoints = <T extends { source_ref?: number; source_url?: string; source_display?: string }>(
      points: T[] = []
    ): T[] =>
      points.map((p) => {
        const url = p.source_url || (p.source_ref ? citations[p.source_ref - 1] : undefined);
        if (url && !url.includes('canarias-lovers.com')) {
          return { ...p, source_url: url, source_display: p.source_display || perplexityDisplayName(url) };
        }
        return { ...p, source_url: undefined };
      });

    const results: ValidationResult[] = parsed.results.map((r) => ({
      ...r,
      validated_points: mapPoints(r.validated_points ?? []),
      invalid_points: mapPoints(r.invalid_points ?? []),
    }));

    return {
      validated_at: new Date().toISOString(),
      overall_status: results.some((r) => r.status === 'invalid') ? 'issues_found' : 'valid',
      results,
      grounding_sources: groundingSources,
    };
  }
}
