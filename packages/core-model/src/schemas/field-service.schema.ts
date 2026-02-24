import { z } from 'zod';

/**
 * Schéma pour un service de champ calculé.
 *
 * Un FieldService est une unité de traitement enregistrée dans MongoDB et référençable
 * depuis un champ de template via `service_id`.
 * À l'export, le service reçoit le contexte complet du guide (pages construites, guide, db)
 * et retourne une valeur calculée injectée dans le champ.
 *
 * Exemples de services :
 *  - "sommaire_generator" → table des matières avec numéros de page
 *  - "stats_calculator"   → statistiques du guide (nombre de POI, clusters…)
 *  - "cluster_summary"    → synthèse textuelle des clusters
 */
export const FieldServiceSchema = z.object({
  _id: z.unknown().optional(),

  /**
   * Identifiant technique, unique, en snake_case.
   * Doit correspondre à un handler enregistré dans FieldServiceRunner.
   * Ex: "sommaire_generator", "stats_calculator"
   */
  service_id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'Format: snake_case minuscules (ex: sommaire_generator)'),

  /** Nom lisible pour l'affichage dans le formulaire de template */
  label: z.string().min(1),

  /** Description de ce que fait le service */
  description: z.string().optional(),

  /**
   * Type de valeur retournée par le service.
   * - "text" : valeur texte brute (titre, méta, etc.)
   * - "json" : JSON sérialisé (structure, sommaire, stats…)
   */
  output_type: z.enum(['text', 'json']).default('json'),

  /**
   * Clés de contexte nécessaires au service.
   * Informatif uniquement — le runner passe toujours l'intégralité du contexte.
   * Ex: ["guide", "all_pages"], ["current_page"]
   */
  context_keys: z.array(z.string()).optional(),

  /** Si false, le service est masqué dans l'UI et ignoré à l'export */
  active: z.boolean().default(true),

  created_at: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type FieldService = z.infer<typeof FieldServiceSchema>;

export const CreateFieldServiceSchema = FieldServiceSchema.omit({
  _id: true,
  created_at: true,
  updated_at: true,
});
export type CreateFieldService = z.infer<typeof CreateFieldServiceSchema>;

export const UpdateFieldServiceSchema = CreateFieldServiceSchema.partial();
export type UpdateFieldService = z.infer<typeof UpdateFieldServiceSchema>;
