import { z } from 'zod';

/**
 * Type de prompt IA
 */
export const PromptTypeEnum = z.enum([
  'translation',      // Traduction
  'summary',          // Résumé
  'enrichment',       // Enrichissement de contenu
  'validation',       // Validation
  'extraction',       // Extraction d'informations
  'generation',       // Génération de contenu
]);

export type PromptType = z.infer<typeof PromptTypeEnum>;

/**
 * Schema d'un prompt IA
 */
export const PromptSchema = z.object({
  _id: z.string().optional(),
  
  // Identification
  key: z.string().min(1), // Clé unique pour retrouver le prompt
  name: z.string().min(1),
  type: PromptTypeEnum,
  
  // Contenu du prompt
  template: z.string().min(1), // Template avec variables {{var}}
  systemPrompt: z.string().optional(),
  
  // Variables attendues
  variables: z.array(z.string()).default([]),
  
  // Configuration
  config: z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
  }).optional(),
  
  // Métadonnées
  description: z.string().optional(),
  version: z.string().default('1.0'),
  isActive: z.boolean().default(true),
  
  // Timestamps
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

/**
 * DTO pour la création d'un prompt
 */
export const CreatePromptSchema = PromptSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreatePromptDto = z.infer<typeof CreatePromptSchema>;

/**
 * Schema pour l'exécution d'un prompt avec ses variables
 */
export const ExecutePromptSchema = z.object({
  promptKey: z.string(),
  variables: z.record(z.string()),
});

export type ExecutePromptDto = z.infer<typeof ExecutePromptSchema>;
