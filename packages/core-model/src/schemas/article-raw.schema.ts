import { z } from 'zod';

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

  /** Dernière mise à jour côté WordPress (ISO string ou Date) */
  updated_at: z.union([z.string(), z.date()]),
});

export type ArticleRaw = z.infer<typeof ArticleRawSchema>;
