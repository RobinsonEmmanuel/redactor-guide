import { z } from 'zod';

/**
 * Types de champs autorisés dans un template
 */
export const TemplateFieldTypeEnum = z.enum([
  'titre',
  'texte',
  'image',
  'lien',
  'meta',
  'liste',
  'picto',
]);

export type TemplateFieldType = z.infer<typeof TemplateFieldTypeEnum>;

/**
 * Schéma pour les règles de validation d'un champ
 */
export const FieldValidationSchema = z.object({
  /** Champ obligatoire ou non */
  required: z.boolean().optional(),
  
  /** Longueur maximale (caractères) */
  max_length: z.number().int().positive().optional(),
  
  /** Longueur minimale (caractères) */
  min_length: z.number().int().positive().optional(),
  
  /** Nombre de phrases attendu (pour texte) */
  sentence_count: z.number().int().positive().optional(),
  
  /** Mots interdits (vocabulaire promotionnel, etc.) */
  forbidden_words: z.array(z.string()).optional(),
  
  /** Patterns interdits (regex ou texte simple) */
  forbidden_patterns: z.array(z.string()).optional(),
  
  /** Termes temporels interdits */
  forbidden_temporal_terms: z.array(z.string()).optional(),
  
  /** Messages d'erreur personnalisés */
  messages: z.record(z.string(), z.string()).optional(),
  
  /** Sévérité (error = bloquant, warning = avertissement) */
  severity: z.enum(['error', 'warning']).default('error'),
});

export type FieldValidation = z.infer<typeof FieldValidationSchema>;

/**
 * Schéma pour un champ de template
 * Le nom du champ suit la convention : <TEMPLATE>_<TYPE>_<INDEX>
 */
export const TemplateFieldSchema = z.object({
  /** ID unique du champ (généré automatiquement) */
  id: z.string(),
  
  /** Type de champ */
  type: TemplateFieldTypeEnum,
  
  /** Nom du champ (ex: POI_titre_1) - sera généré automatiquement selon la convention */
  name: z.string().regex(
    /^[A-Z][A-Z0-9_]*_(titre|texte|image|lien|meta|liste|picto)_[a-z0-9_]+$/,
    'Format: <TEMPLATE>_<TYPE>_<INDEX> (ex: POI_titre_1, POI_meta_duree, POI_picto_interet)'
  ),
  
  /** Label pour l'affichage (optionnel) */
  label: z.string().optional(),
  
  /** Description ou note pour ce champ (optionnel) */
  description: z.string().optional(),
  
  /** Instructions pour l'IA lors du remplissage automatique (optionnel) */
  ai_instructions: z.string().optional(),

  /**
   * Valeur par défaut à injecter directement sans passer par l'IA.
   * Quand ce champ est renseigné, ai_instructions est ignoré.
   * La valeur est copiée telle quelle dans le contenu de la page à la création.
   * Exemples : lien statique, mention légale, texte récurrent...
   */
  default_value: z.string().optional(),

  /** Règles de validation du champ (optionnel) */
  validation: FieldValidationSchema.optional(),
  
  /** Position dans le template (ordre d'affichage) */
  order: z.number().int().min(0),
  
  /** Calibre recommandé (nombre de caractères max) - optionnel */
  max_chars: z.number().int().positive().optional(),
  
  /** Si type=liste, nombre d'éléments fixes dans la liste */
  list_size: z.number().int().positive().optional(),

  /** Si type=picto, liste des valeurs autorisées (ex: ['oui', 'non'] ou ['incontournable', 'interessant', 'a_voir']) */
  options: z.array(z.string()).optional(),

  /**
   * Nom du calque InDesign cible pour ce champ.
   * Si absent, le nom est dérivé automatiquement à l'export via deriveLayerName().
   * Ex: "txt_poi_nom", "img_poi_grand_rond", "picto_interet"
   */
  indesign_layer: z.string().optional(),

  /**
   * Pour type=picto uniquement.
   * Mappe chaque valeur d'option vers le calque InDesign variant exact.
   * C'est la source de vérité pour la résolution du variant_layer à l'export.
   *
   * Ex:
   *   { "interessant": "picto_interet_2", "incontournable": "picto_interet_1", "a_voir": "picto_interet_3" }
   *   { "100": "picto_pmr_full", "50": "picto_pmr_half", "0": "picto_pmr_none" }
   *   { "oui": "picto_escaliers", "non": null }  ← null = picto non affiché
   */
  option_layers: z.record(z.string(), z.string().nullable()).optional(),
});

export type TemplateField = z.infer<typeof TemplateFieldSchema>;

/**
 * Schéma pour un template éditorial
 */
export const TemplateSchema = z.object({
  _id: z.unknown().optional(),
  
  /** Nom du template (en MAJUSCULES, ex: POI, RESTAURANT, PLAGE) */
  name: z.string()
    .min(1)
    .max(50)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Le nom doit être en MAJUSCULES (ex: POI, RESTAURANT)'),
  
  /** Description du template */
  description: z.string().optional(),
  
  /** Liste ordonnée des champs du template */
  fields: z.array(TemplateFieldSchema),
  
  /** Date de création */
  created_at: z.union([z.string(), z.date()]).optional(),
  
  /** Date de dernière modification */
  updated_at: z.union([z.string(), z.date()]).optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

/**
 * Schéma pour créer un nouveau template
 */
export const CreateTemplateSchema = TemplateSchema.omit({
  _id: true,
  created_at: true,
  updated_at: true,
});

export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;

/**
 * Schéma pour mettre à jour un template
 */
export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export type UpdateTemplate = z.infer<typeof UpdateTemplateSchema>;

/**
 * Labels pour les types de champs (affichage frontend)
 */
export const FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  titre: 'Titre',
  texte: 'Texte',
  image: 'Image',
  lien: 'Lien',
  meta: 'Métadonnée',
  liste: 'Liste',
  picto: 'Pictogramme',
};

/**
 * Descriptions des types de champs
 */
export const FIELD_TYPE_DESCRIPTIONS: Record<TemplateFieldType, string> = {
  titre: 'Texte court servant de titre ou sous-titre',
  texte: 'Texte informatif court, calibré, non narratif long',
  image: 'Référence à une image locale copiée depuis WordPress',
  lien: 'URL pointant vers un contenu externe',
  meta: 'Métadonnée éditoriale normée, non narrative',
  liste: 'Élément de liste courte, avec nombre fixe de champs',
  picto: 'Valeur parmi une liste d\'options prédéfinies (ex: oui/non, incontournable/intéressant/à voir)',
};
