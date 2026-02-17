import { z } from 'zod';

/**
 * Types de blocs dans la structure d'un guide template
 */
export const GuideTemplateBlockTypeEnum = z.enum([
  'fixed_page',  // Page fixe avec un template spécifique
  'section',     // Section dynamique générée depuis les données
]);

export type GuideTemplateBlockType = z.infer<typeof GuideTemplateBlockTypeEnum>;

/**
 * Sources de données pour les sections dynamiques
 */
export const SectionSourceEnum = z.enum([
  'clusters',      // Données des clusters (étape 3)
  'inspirations',  // Données des inspirations (étape 4)
  'none',          // Pas de source (pages fixes)
]);

export type SectionSource = z.infer<typeof SectionSourceEnum>;

/**
 * Bloc de structure dans un guide template
 */
export const GuideTemplateBlockSchema = z.object({
  /** Type de bloc */
  type: GuideTemplateBlockTypeEnum,
  
  /** Nom identifiant la section (pour sections dynamiques) */
  name: z.string().optional(),
  
  /** Template de page à utiliser (pour fixed_page ou sections avec template fixe) */
  template_name: z.string().optional(),
  
  /** Ordre dans la structure globale */
  ordre: z.number().int().min(1),
  
  /** Source de données (pour sections dynamiques) */
  source: SectionSourceEnum.optional(),
  
  /** Nombre de POIs par page (pour inspirations) */
  pois_per_page: z.number().int().positive().optional(),
  
  /** Nombre de pages à créer (pour sections fixes répétées comme les saisons) */
  pages_count: z.number().int().positive().optional(),
  
  /** Titre de la section (optionnel) */
  section_title: z.string().optional(),
  
  /** Description de la section (optionnel) */
  description: z.string().optional(),
});

export type GuideTemplateBlock = z.infer<typeof GuideTemplateBlockSchema>;

/**
 * Schéma pour un template de guide
 */
export const GuideTemplateSchema = z.object({
  _id: z.unknown().optional(),
  
  /** Nom du template de guide */
  name: z.string().min(1).max(100),
  
  /** Slug pour identification */
  slug: z.string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Le slug doit être en minuscules avec tirets'),
  
  /** Description du template */
  description: z.string().optional(),
  
  /** Structure du guide (ordre des pages et sections) */
  structure: z.array(GuideTemplateBlockSchema),
  
  /** Template par défaut ? */
  is_default: z.boolean().default(false),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type GuideTemplate = z.infer<typeof GuideTemplateSchema>;

/**
 * Schéma pour créer un nouveau guide template
 */
export const CreateGuideTemplateSchema = GuideTemplateSchema.omit({
  _id: true,
  created_at: true,
  updated_at: true,
});

export type CreateGuideTemplate = z.infer<typeof CreateGuideTemplateSchema>;

/**
 * Schéma pour mettre à jour un guide template
 */
export const UpdateGuideTemplateSchema = CreateGuideTemplateSchema.partial();

export type UpdateGuideTemplate = z.infer<typeof UpdateGuideTemplateSchema>;
