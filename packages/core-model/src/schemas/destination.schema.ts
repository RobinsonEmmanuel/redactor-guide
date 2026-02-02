import { z } from 'zod';
import { LanguageEnum } from './guide.schema';

/**
 * Type de destination
 */
export const DestinationTypeEnum = z.enum([
  'city',         // Ville
  'region',       // Région
  'country',      // Pays
  'monument',     // Monument
  'activity',     // Activité
  'restaurant',   // Restaurant
  'hotel',        // Hôtel
]);

export type DestinationType = z.infer<typeof DestinationTypeEnum>;

/**
 * Contenu traduit pour une destination
 */
export const TranslatedContentSchema = z.object({
  language: LanguageEnum,
  title: z.string(),
  description: z.string(),
  shortDescription: z.string().optional(),
  translatedBy: z.enum(['human', 'ai', 'deepl']).optional(),
  translatedAt: z.date().optional(),
});

export type TranslatedContent = z.infer<typeof TranslatedContentSchema>;

/**
 * Image associée à une destination
 */
export const ImageSchema = z.object({
  url: z.string().url(),
  localPath: z.string().optional(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  credits: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type Image = z.infer<typeof ImageSchema>;

/**
 * Schema d'une destination
 */
export const DestinationSchema = z.object({
  _id: z.string().optional(),
  
  // Informations de base
  wpId: z.number().optional(), // ID WordPress source
  wpSiteUrl: z.string().url().optional(),
  slug: z.string(),
  type: DestinationTypeEnum,
  
  // Contenus multilingues
  contents: z.array(TranslatedContentSchema).min(1),
  
  // Images
  images: z.array(ImageSchema).default([]),
  featuredImage: ImageSchema.optional(),
  
  // Métadonnées
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  
  // Géolocalisation
  location: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  
  // Données ACF WordPress (champs personnalisés)
  acf: z.record(z.unknown()).optional(),
  
  // Timestamps
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  lastSyncAt: z.date().optional(),
});

export type Destination = z.infer<typeof DestinationSchema>;

/**
 * DTO pour la création d'une destination
 */
export const CreateDestinationSchema = DestinationSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncAt: true,
});

export type CreateDestinationDto = z.infer<typeof CreateDestinationSchema>;
