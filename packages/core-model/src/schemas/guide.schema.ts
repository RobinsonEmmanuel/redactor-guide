import { z } from 'zod';

/**
 * Statuts possibles d'un guide
 */
export const GuideStatusEnum = z.enum([
  'draft',        // Brouillon
  'in_progress',  // En cours de création
  'review',       // En revue
  'ready',        // Prêt à publier
  'published',    // Publié
  'archived',     // Archivé
]);

export type GuideStatus = z.infer<typeof GuideStatusEnum>;

/**
 * Langues supportées par WPML
 */
export const LanguageEnum = z.enum(['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl']);

export type Language = z.infer<typeof LanguageEnum>;

/**
 * Labels des langues pour l'interface
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  fr: 'Français (source)',
  it: 'Italien',
  es: 'Espagnol',
  de: 'Allemand',
  da: 'Danois',
  sv: 'Suédois',
  en: 'Anglais',
  'pt-pt': 'Portugais',
  nl: 'Néerlandais',
};

/**
 * Schema principal d'un guide
 */
export const GuideSchema = z.object({
  _id: z.string().optional(),
  
  // Informations de base
  name: z.string().min(1, 'Le nom du guide est requis'),
  slug: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
  version: z.string(),
  
  // Langue principale
  language: LanguageEnum,
  
  // Langues disponibles pour la récupération des articles
  availableLanguages: z.array(LanguageEnum).default(['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl']),
  
  // Destinations incluses
  destinations: z.array(z.string()).min(1, 'Au moins une destination requise'),
  
  // Statut
  status: GuideStatusEnum.default('draft'),
  
  // Métadonnées
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  publishedAt: z.date().optional().nullable(),
  
  // Configuration
  config: z.object({
    enableAiTranslation: z.boolean().default(true),
    enableImageDownload: z.boolean().default(true),
    exportFormat: z.enum(['csv', 'json', 'xml']).default('csv'),
  }).optional(),
});

export type Guide = z.infer<typeof GuideSchema>;

/**
 * DTO pour la création d'un guide (sans _id, dates auto)
 */
export const CreateGuideSchema = GuideSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
});

export type CreateGuideDto = z.infer<typeof CreateGuideSchema>;

/**
 * DTO pour la mise à jour d'un guide (tous les champs optionnels sauf _id)
 */
export const UpdateGuideSchema = GuideSchema.partial().required({ _id: true });

export type UpdateGuideDto = z.infer<typeof UpdateGuideSchema>;
