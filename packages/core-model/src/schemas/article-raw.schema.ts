import { z } from 'zod';

/**
 * Schéma pour l'analyse d'une image
 */
export const ImageAnalysisSchema = z.object({
  url: z.string().url(),
  analysis: z.object({
    shows_entire_site: z.boolean(),
    shows_detail: z.boolean(),
    detail_type: z.string(),
    is_iconic_view: z.boolean(),
    is_contextual: z.boolean(),
    /** Vrai si l'image est un collage, mosaïque ou montage — doit être exclue de la sélection */
    is_composite: z.boolean().default(false),
    visual_clarity_score: z.number().min(0).max(1),
    composition_quality_score: z.number().min(0).max(1),
    lighting_quality_score: z.number().min(0).max(1),
    readability_small_screen_score: z.number().min(0).max(1),
    has_text_overlay: z.boolean(),
    has_graphic_effects: z.boolean(),
    editorial_relevance: z.enum(['faible', 'moyenne', 'forte']),
    analysis_summary: z.string(),
  }),
  analyzed_at: z.string(),
});

export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

/**
 * Critères de sélection d'image
 */
export interface SelectionCriteria {
  preferGlobalView?: boolean;
  minClarityScore?: number;
  minCompositionScore?: number;
  minReadabilityScore?: number;
  avoidTextOverlay?: boolean;
  avoidGraphicEffects?: boolean;
  /** Exclure les collages, mosaïques et montages (défaut: true) */
  avoidComposite?: boolean;
  preferIconicView?: boolean;
  minRelevance?: 'faible' | 'moyenne' | 'forte';
}

/**
 * Schéma pour un article brut ingéré depuis WordPress (collection articles_raw).
 * Aucune transformation éditoriale.
 */
export const ArticleRawSchema = z.object({
  _id: z.unknown().optional(),

  site_id: z.string(),
  destination_ids: z.array(z.string()).default([]),

  slug: z.string(),
  title: z.string(),
  html_brut: z.string(),
  
  /** Version Markdown du contenu (pour aide IA à la rédaction) */
  markdown: z.string().optional(),

  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),

  /** URL source par langue (ex: { fr: "https://...", en: "https://..." }) */
  urls_by_lang: z.record(z.string(), z.string().url()),

  /** URLs des images extraites du HTML */
  images: z.array(z.string().url()).default([]),

  /** Analyses des images (optionnel, généré par OpenAI Vision) */
  images_analysis: z.array(ImageAnalysisSchema).optional(),

  /** Dernière mise à jour côté WordPress (ISO string ou Date) */
  updated_at: z.union([z.string(), z.date()]),
});

export type ArticleRaw = z.infer<typeof ArticleRawSchema>;
