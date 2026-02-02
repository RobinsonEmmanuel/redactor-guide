import { z } from 'zod';
import { LanguageEnum } from './guide.schema';

/**
 * Configuration d'un site WordPress source
 */
export const WordPressSiteSchema = z.object({
  _id: z.string().optional(),
  
  // Informations de base
  name: z.string().min(1),
  url: z.string().url(),
  language: LanguageEnum,
  
  // Configuration WPML
  wpml: z.object({
    enabled: z.boolean().default(true),
    defaultLanguage: LanguageEnum,
    availableLanguages: z.array(LanguageEnum),
  }).optional(),
  
  // Authentification
  auth: z.object({
    type: z.enum(['none', 'basic', 'jwt', 'application_password']),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
  }).optional(),
  
  // Configuration de synchronisation
  sync: z.object({
    enabled: z.boolean().default(true),
    frequency: z.enum(['manual', 'hourly', 'daily', 'weekly']).default('manual'),
    lastSyncAt: z.date().optional(),
    postTypes: z.array(z.string()).default(['post', 'page']),
  }).optional(),
  
  // Métadonnées
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type WordPressSite = z.infer<typeof WordPressSiteSchema>;

/**
 * DTO pour la création d'un site
 */
export const CreateWordPressSiteSchema = WordPressSiteSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateWordPressSiteDto = z.infer<typeof CreateWordPressSiteSchema>;
