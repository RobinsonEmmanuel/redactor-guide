import { z } from 'zod';

/**
 * Intent du prompt (action attendue de l'IA)
 */
export const PromptIntentEnum = z.enum([
  'redaction_page',
  'resume_article',
  'extraction_infos',
  'traduction',
  'optimisation_seo',
  'generation_titre',
  'reformulation',
  'correction',
  'enrichissement',
  'structure_sections',
  'selection_pois',
  'pages_inspiration',
  'regles_ecriture',
]);

export type PromptIntent = z.infer<typeof PromptIntentEnum>;

/**
 * Type de page (correspond aux types du chemin de fer)
 */
export const PromptPageTypeEnum = z.enum([
  'intro',
  'section',
  'poi',
  'inspiration',
  'transition',
  'outro',
  'pratique',
  'conseil',
]);

export type PromptPageType = z.infer<typeof PromptPageTypeEnum>;

/**
 * Schéma pour un Prompt
 */
export const PromptSchema = z.object({
  _id: z.unknown().optional(),
  
  /** ID unique du prompt */
  prompt_id: z.string().min(1),
  
  /** Nom descriptif du prompt */
  prompt_nom: z.string().min(1),
  
  /** Intent (action attendue de l'IA) - obligatoire */
  intent: PromptIntentEnum,
  
  /** Catégories / tags pour organiser les prompts */
  categories: z.array(z.string()).default([]),
  
  /** Type de page spécifique (optionnel) */
  page_type: PromptPageTypeEnum.optional(),
  
  /** Langue source (par défaut 'fr') */
  langue_source: z.string().default('fr'),
  
  /** Texte du prompt */
  texte_prompt: z.string().min(10),
  
  /** Version du prompt */
  version: z.string().default('1.0.0'),
  
  /** Prompt actif ou désactivé */
  actif: z.boolean().default(true),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  date_mise_a_jour: z.union([z.string(), z.date()]).optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

/**
 * Schéma pour créer un nouveau prompt
 */
export const CreatePromptSchema = PromptSchema.omit({
  _id: true,
  created_at: true,
  date_mise_a_jour: true,
});

export type CreatePrompt = z.infer<typeof CreatePromptSchema>;

/**
 * Schéma pour mettre à jour un prompt
 */
export const UpdatePromptSchema = CreatePromptSchema.partial().extend({
  prompt_id: z.string().optional(),
});

export type UpdatePrompt = z.infer<typeof UpdatePromptSchema>;

/**
 * Schéma pour la résolution de prompt
 */
export const PromptResolutionSchema = z.object({
  intent: PromptIntentEnum,
  page_type: PromptPageTypeEnum.optional(),
  langue: z.string().default('fr'),
});

export type PromptResolution = z.infer<typeof PromptResolutionSchema>;

/**
 * Labels pour les intents
 */
export const PROMPT_INTENT_LABELS: Record<PromptIntent, string> = {
  redaction_page: 'Rédaction de page',
  resume_article: 'Résumé d\'article',
  extraction_infos: 'Extraction d\'informations',
  traduction: 'Traduction',
  optimisation_seo: 'Optimisation SEO',
  generation_titre: 'Génération de titre',
  reformulation: 'Reformulation',
  correction: 'Correction',
  enrichissement: 'Enrichissement',
  structure_sections: 'Structure du guide (sections)',
  selection_pois: 'Sélection des POI (lieux)',
  pages_inspiration: 'Pages inspiration',
  regles_ecriture: 'Règles d\'écriture',
};

/**
 * Couleurs pour les intents
 */
export const PROMPT_INTENT_COLORS: Record<PromptIntent, string> = {
  redaction_page: 'bg-blue-100 text-blue-700',
  resume_article: 'bg-purple-100 text-purple-700',
  extraction_infos: 'bg-green-100 text-green-700',
  traduction: 'bg-orange-100 text-orange-700',
  optimisation_seo: 'bg-pink-100 text-pink-700',
  generation_titre: 'bg-indigo-100 text-indigo-700',
  reformulation: 'bg-yellow-100 text-yellow-700',
  correction: 'bg-red-100 text-red-700',
  enrichissement: 'bg-teal-100 text-teal-700',
  structure_sections: 'bg-cyan-100 text-cyan-700',
  selection_pois: 'bg-emerald-100 text-emerald-700',
  pages_inspiration: 'bg-violet-100 text-violet-700',
  regles_ecriture: 'bg-slate-100 text-slate-700',
};
