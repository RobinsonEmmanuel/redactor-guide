import { z } from 'zod';

/**
 * Schema de validation pour les posts WordPress via l'API REST
 */
export const WordPressPostSchema = z.object({
  id: z.number(),
  date: z.string(),
  date_gmt: z.string(),
  modified: z.string(),
  modified_gmt: z.string(),
  slug: z.string(),
  status: z.string(),
  type: z.string(),
  link: z.string().url(),
  
  title: z.object({
    rendered: z.string(),
  }),
  
  content: z.object({
    rendered: z.string(),
    protected: z.boolean().optional(),
  }),
  
  excerpt: z.object({
    rendered: z.string(),
    protected: z.boolean().optional(),
  }).optional(),
  
  featured_media: z.number().optional(),
  
  // Métadonnées
  categories: z.array(z.number()).optional(),
  tags: z.array(z.number()).optional(),
  
  // ACF (champs personnalisés)
  acf: z.record(z.unknown()).optional(),
  
  // WPML
  wpml_current_locale: z.string().optional(),
  wpml_translations: z.array(z.object({
    locale: z.string(),
    id: z.number(),
    post_title: z.string().optional(),
    href: z.string().url().optional(),
  })).optional(),
});

export type WordPressPost = z.infer<typeof WordPressPostSchema>;

/**
 * Schema pour les médias WordPress
 */
export const WordPressMediaSchema = z.object({
  id: z.number(),
  date: z.string(),
  slug: z.string(),
  type: z.string(),
  link: z.string().url(),
  
  title: z.object({
    rendered: z.string(),
  }),
  
  caption: z.object({
    rendered: z.string(),
  }).optional(),
  
  alt_text: z.string().optional(),
  media_type: z.string(),
  mime_type: z.string(),
  
  media_details: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    file: z.string().optional(),
    sizes: z.record(z.object({
      file: z.string(),
      width: z.number(),
      height: z.number(),
      mime_type: z.string(),
      source_url: z.string().url(),
    })).optional(),
  }).optional(),
  
  source_url: z.string().url(),
});

export type WordPressMedia = z.infer<typeof WordPressMediaSchema>;

/**
 * Schema pour les catégories WordPress
 */
export const WordPressCategorySchema = z.object({
  id: z.number(),
  count: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  parent: z.number().optional(),
});

export type WordPressCategory = z.infer<typeof WordPressCategorySchema>;

/**
 * Schema pour les tags WordPress
 */
export const WordPressTagSchema = z.object({
  id: z.number(),
  count: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
});

export type WordPressTag = z.infer<typeof WordPressTagSchema>;
