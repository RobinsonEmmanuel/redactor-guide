import { z } from 'zod';

/**
 * Schéma pour le cache global d'analyse d'images
 * Une entrée par URL d'image unique
 */
export const ImageAnalysisCacheSchema = z.object({
  _id: z.unknown().optional(),
  
  /** URL unique de l'image (clé primaire) */
  url: z.string().url(),
  
  /** Résultats de l'analyse IA */
  analysis: z.object({
    shows_entire_site: z.boolean(),
    shows_detail: z.boolean(),
    detail_type: z.string(),
    is_iconic_view: z.boolean(),
    is_contextual: z.boolean(),
    visual_clarity_score: z.number().min(0).max(1),
    composition_quality_score: z.number().min(0).max(1),
    lighting_quality_score: z.number().min(0).max(1),
    readability_small_screen_score: z.number().min(0).max(1),
    has_text_overlay: z.boolean(),
    has_graphic_effects: z.boolean(),
    editorial_relevance: z.enum(['faible', 'moyenne', 'forte']),
    analysis_summary: z.string(),
  }),
  
  /** Métadonnées */
  analyzed_at: z.string(), // ISO 8601
  model_used: z.string().default('gpt-4o'),
  prompt_version: z.string().default('1.0.0'),
  
  /** Nombre de fois que cette analyse a été réutilisée (économies) */
  reuse_count: z.number().default(0),
  last_reused_at: z.string().optional(),
});

export type ImageAnalysisCache = z.infer<typeof ImageAnalysisCacheSchema>;
