import OpenAI from 'openai';

export interface ImageAnalysis {
  url: string;
  analysis: {
    shows_entire_site: boolean;
    shows_detail: boolean;
    detail_type: 'architecture' | 'nature' | 'intérieur' | 'paysage' | 'usage' | 'symbole' | 'indéterminé';
    is_iconic_view: boolean;
    is_contextual: boolean;
    visual_clarity_score: number;
    composition_quality_score: number;
    lighting_quality_score: number;
    readability_small_screen_score: number;
    has_text_overlay: boolean;
    has_graphic_effects: boolean;
    editorial_relevance: 'faible' | 'moyenne' | 'forte';
    analysis_summary: string;
  };
  analyzed_at: string;
}

export interface SelectionCriteria {
  preferGlobalView?: boolean;
  minClarityScore?: number;
  minCompositionScore?: number;
  minReadabilityScore?: number;
  avoidTextOverlay?: boolean;
  avoidGraphicEffects?: boolean;
  preferIconicView?: boolean;
  minRelevance?: 'faible' | 'moyenne' | 'forte';
}

/**
 * Service pour analyser les images d'articles avec OpenAI Vision
 */
export class ImageAnalysisService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Analyse une liste d'images
   */
  async analyzeImages(
    imageUrls: string[],
    analysisPrompt: string
  ): Promise<ImageAnalysis[]> {
    if (!imageUrls || imageUrls.length === 0) {
      console.log('📸 Aucune image à analyser');
      return [];
    }

    console.log(`📸 Analyse de ${imageUrls.length} image(s)...`);

    const analyses: ImageAnalysis[] = [];

    // Analyser chaque image individuellement
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      console.log(`📸 Analyse image ${i + 1}/${imageUrls.length}: ${url}`);

      try {
        const analysis = await this.analyzeSingleImage(url, analysisPrompt, i);
        analyses.push(analysis);
        console.log(`✅ Image ${i + 1} analysée avec succès`);
      } catch (error: any) {
        console.error(`❌ Erreur analyse image ${i + 1}:`, error.message);
        // Continuer avec l'image suivante
      }

      // Petit délai entre les appels pour éviter rate limiting
      if (i < imageUrls.length - 1) {
        await this.sleep(500);
      }
    }

    console.log(`✅ ${analyses.length}/${imageUrls.length} image(s) analysée(s)`);
    return analyses;
  }

  /**
   * Analyse une image unique
   */
  private async analyzeSingleImage(
    imageUrl: string,
    analysisPrompt: string,
    imageIndex: number
  ): Promise<ImageAnalysis> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: analysisPrompt,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyse cette image (image_id: "image_${imageIndex}"). Réponds UNIQUEMENT avec le JSON demandé, sans texte avant ou après.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'auto',
              },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.3, // Faible pour cohérence
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Pas de réponse de l\'API OpenAI');
    }

    // Parser le JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Réponse non-JSON de l\'API');
    }

    const analysisData = JSON.parse(jsonMatch[0]);

    return {
      url: imageUrl,
      analysis: {
        shows_entire_site: analysisData.shows_entire_site ?? false,
        shows_detail: analysisData.shows_detail ?? false,
        detail_type: analysisData.detail_type || 'indéterminé',
        is_iconic_view: analysisData.is_iconic_view ?? false,
        is_contextual: analysisData.is_contextual ?? false,
        visual_clarity_score: analysisData.visual_clarity_score ?? 0,
        composition_quality_score: analysisData.composition_quality_score ?? 0,
        lighting_quality_score: analysisData.lighting_quality_score ?? 0,
        readability_small_screen_score: analysisData.readability_small_screen_score ?? 0,
        has_text_overlay: analysisData.has_text_overlay ?? false,
        has_graphic_effects: analysisData.has_graphic_effects ?? false,
        editorial_relevance: analysisData.editorial_relevance || 'faible',
        analysis_summary: analysisData.analysis_summary || '',
      },
      analyzed_at: new Date().toISOString(),
    };
  }

  /**
   * Sélectionne la meilleure image selon des critères
   */
  selectBestImage(
    analyses: ImageAnalysis[],
    criteria: SelectionCriteria = {}
  ): ImageAnalysis | null {
    if (!analyses || analyses.length === 0) {
      return null;
    }

    // Critères par défaut
    const {
      preferGlobalView = true,
      minClarityScore = 0.6,
      minCompositionScore = 0.5,
      minReadabilityScore = 0.6,
      avoidTextOverlay = true,
      avoidGraphicEffects = true,
      preferIconicView = true,
      minRelevance = 'moyenne',
    } = criteria;

    // Filtrer les images selon les critères obligatoires
    let candidates = analyses.filter((img) => {
      const a = img.analysis;

      // Filtres obligatoires
      if (a.visual_clarity_score < minClarityScore) return false;
      if (a.composition_quality_score < minCompositionScore) return false;
      if (a.readability_small_screen_score < minReadabilityScore) return false;
      if (avoidTextOverlay && a.has_text_overlay) return false;
      if (avoidGraphicEffects && a.has_graphic_effects) return false;

      // Relevance minimale
      if (minRelevance === 'forte' && a.editorial_relevance !== 'forte') {
        return false;
      }
      if (minRelevance === 'moyenne' && a.editorial_relevance === 'faible') {
        return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      console.warn('⚠️ Aucune image ne correspond aux critères, utilisation de la première');
      return analyses[0];
    }

    // Calculer un score pour chaque image
    const scored = candidates.map((img) => {
      const a = img.analysis;
      let score = 0;

      // Scores de qualité (40%)
      score += a.visual_clarity_score * 15;
      score += a.composition_quality_score * 10;
      score += a.lighting_quality_score * 5;
      score += a.readability_small_screen_score * 10;

      // Vue globale (30%)
      if (preferGlobalView && a.shows_entire_site) {
        score += 30;
      }

      // Vue iconique (20%)
      if (preferIconicView && a.is_iconic_view) {
        score += 20;
      }

      // Relevance éditoriale (10%)
      if (a.editorial_relevance === 'forte') score += 10;
      else if (a.editorial_relevance === 'moyenne') score += 5;

      return { img, score };
    });

    // Trier par score décroissant
    scored.sort((a, b) => b.score - a.score);

    console.log(`📸 Meilleure image sélectionnée avec score: ${scored[0].score.toFixed(2)}/100`);

    return scored[0].img;
  }

  /**
   * Trouve toutes les images correspondant à des critères
   */
  filterImages(
    analyses: ImageAnalysis[],
    criteria: SelectionCriteria = {}
  ): ImageAnalysis[] {
    if (!analyses || analyses.length === 0) {
      return [];
    }

    const {
      minClarityScore = 0.5,
      minCompositionScore = 0.5,
      minReadabilityScore = 0.5,
      avoidTextOverlay = false,
      avoidGraphicEffects = false,
      minRelevance = 'faible',
    } = criteria;

    return analyses.filter((img) => {
      const a = img.analysis;

      if (a.visual_clarity_score < minClarityScore) return false;
      if (a.composition_quality_score < minCompositionScore) return false;
      if (a.readability_small_screen_score < minReadabilityScore) return false;
      if (avoidTextOverlay && a.has_text_overlay) return false;
      if (avoidGraphicEffects && a.has_graphic_effects) return false;

      if (minRelevance === 'forte' && a.editorial_relevance !== 'forte') {
        return false;
      }
      if (minRelevance === 'moyenne' && a.editorial_relevance === 'faible') {
        return false;
      }

      return true;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
