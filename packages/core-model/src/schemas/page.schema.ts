import { z } from 'zod';

/**
 * Types de page dans un guide
 */
export const PageTypeEnum = z.enum([
  'intro',
  'section',
  'poi',
  'inspiration',
  'transition',
  'outro',
  'pratique',
  'conseil',
]);

export type PageType = z.infer<typeof PageTypeEnum>;

/**
 * Statut éditorial d'une page
 */
export const PageStatusEnum = z.enum([
  'draft',
  'generee_ia',
  'relue',
  'validee',
  'texte_coule',
  'visuels_montes',
  'texte_recu',
  'en_attente',
  'non_conforme',
]);

export type PageStatus = z.infer<typeof PageStatusEnum>;

/**
 * Schéma pour une page de guide
 * Une page est une instance d'un template dans un chemin de fer
 */
export const PageSchema = z.object({
  _id: z.unknown().optional(),
  
  /** ID unique et stable de la page (indépendant de la langue et de l'ordre) */
  page_id: z.string().min(1),
  
  /** ID du chemin de fer auquel appartient cette page */
  chemin_de_fer_id: z.string(),
  
  /** Titre éditorial de la page */
  titre: z.string().min(1),
  
  /** ID du template utilisé par cette page */
  template_id: z.string(),
  
  /** Nom du template (dénormalisé pour l'affichage) */
  template_name: z.string().optional(),
  
  /** Numéro d'ordre dans le chemin de fer (1-indexed) */
  ordre: z.number().int().min(1),
  
  /** Type de page (fortement recommandé) */
  type_de_page: PageTypeEnum.optional(),
  
  /** ID de la section à laquelle appartient la page */
  section_id: z.string().optional(),
  
  /** Nom de la section (dénormalisé pour l'affichage) */
  section_name: z.string().optional(),
  
  /** URL source (WordPress ou autre) */
  url_source: z.string().url().optional(),
  
  /** Statut éditorial */
  statut_editorial: PageStatusEnum.default('draft'),
  
  /** Commentaire interne (non exporté) */
  commentaire_interne: z.string().optional(),
  
  /** Contenu rédactionnel (champs du template remplis) */
  content: z.record(z.string(), z.any()).optional(),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type Page = z.infer<typeof PageSchema>;

/**
 * Schéma pour créer une nouvelle page
 * Note: chemin_de_fer_id est omis car calculé par l'API
 */
export const CreatePageSchema = PageSchema.omit({
  _id: true,
  chemin_de_fer_id: true,
  created_at: true,
  updated_at: true,
  template_name: true,
  section_name: true,
});

export type CreatePage = z.infer<typeof CreatePageSchema>;

/**
 * Schéma pour mettre à jour une page
 */
export const UpdatePageSchema = CreatePageSchema.partial().extend({
  page_id: z.string().optional(),
  chemin_de_fer_id: z.string().optional(),
});

export type UpdatePage = z.infer<typeof UpdatePageSchema>;

/**
 * Labels pour les types de page
 */
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  intro: 'Introduction',
  section: 'Section',
  poi: 'Point d\'intérêt',
  inspiration: 'Inspiration',
  transition: 'Transition',
  outro: 'Conclusion',
  pratique: 'Pratique',
  conseil: 'Conseil',
};

/**
 * Labels pour les statuts éditoriaux
 */
export const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
  draft: 'Brouillon',
  generee_ia: 'Générée par IA',
  relue: 'Relue',
  validee: 'Validée',
  texte_coule: 'Texte coulé',
  visuels_montes: 'Visuels montés',
  texte_recu: 'Texte reçu',
  en_attente: 'En attente',
  non_conforme: 'Non conforme',
};

/**
 * Couleurs pour les statuts (style badges)
 */
export const PAGE_STATUS_COLORS: Record<PageStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  generee_ia: 'bg-blue-100 text-blue-700',
  relue: 'bg-yellow-100 text-yellow-700',
  validee: 'bg-green-100 text-green-700',
  texte_coule: 'bg-cyan-100 text-cyan-700',
  visuels_montes: 'bg-purple-100 text-purple-700',
  texte_recu: 'bg-orange-100 text-orange-700',
  en_attente: 'bg-pink-100 text-pink-700',
  non_conforme: 'bg-red-100 text-red-700',
};
