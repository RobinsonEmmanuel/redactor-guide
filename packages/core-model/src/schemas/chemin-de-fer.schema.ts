import { z } from 'zod';

/**
 * Schéma pour un chemin de fer (structure ordonnée de pages)
 * Un chemin de fer est indépendant de la langue et définit l'ordre narratif du guide
 */
export const CheminDeFerSchema = z.object({
  _id: z.unknown().optional(),
  
  /** ID du guide auquel appartient ce chemin de fer */
  guide_id: z.string(),
  
  /** Nom du chemin de fer (optionnel, par défaut = nom du guide) */
  nom: z.string().optional(),
  
  /** Description du chemin de fer */
  description: z.string().optional(),
  
  /** Nombre total de pages */
  nombre_pages: z.number().int().min(0).default(0),
  
  /** Version du guide (année) */
  version: z.string().optional(),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type CheminDeFer = z.infer<typeof CheminDeFerSchema>;

/**
 * Schéma pour créer un nouveau chemin de fer
 */
export const CreateCheminDeFerSchema = CheminDeFerSchema.omit({
  _id: true,
  created_at: true,
  updated_at: true,
  nombre_pages: true,
});

export type CreateCheminDeFer = z.infer<typeof CreateCheminDeFerSchema>;

/**
 * Schéma pour mettre à jour un chemin de fer
 */
export const UpdateCheminDeFerSchema = CreateCheminDeFerSchema.partial().extend({
  guide_id: z.string().optional(),
});

export type UpdateCheminDeFer = z.infer<typeof UpdateCheminDeFerSchema>;

/**
 * Schéma pour une section (regroupement logique de pages)
 */
export const SectionSchema = z.object({
  _id: z.unknown().optional(),
  
  /** ID du chemin de fer */
  chemin_de_fer_id: z.string(),
  
  /** ID unique de la section */
  section_id: z.string().min(1),
  
  /** Nom de la section */
  nom: z.string().min(1),
  
  /** Numéro d'ordre de la section */
  ordre: z.number().int().min(1),
  
  /** Couleur d'affichage (hex) */
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type Section = z.infer<typeof SectionSchema>;

/**
 * Schéma pour créer une section
 */
export const CreateSectionSchema = SectionSchema.omit({
  _id: true,
  created_at: true,
  updated_at: true,
});

export type CreateSection = z.infer<typeof CreateSectionSchema>;
