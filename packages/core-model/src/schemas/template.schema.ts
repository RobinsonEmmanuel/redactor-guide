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
  'repetitif',
]);

export type TemplateFieldType = z.infer<typeof TemplateFieldTypeEnum>;

/**
 * Schéma pour les règles de validation d'un champ
 */
export const FieldValidationSchema = z.object({
  /** Champ obligatoire ou non */
  required: z.boolean().optional().catch(undefined),
  
  /** Longueur maximale (caractères) */
  max_length: z.number().int().positive().optional().catch(undefined),
  
  /** Longueur minimale (caractères) */
  min_length: z.number().int().positive().optional().catch(undefined),
  
  /** Nombre de phrases attendu (pour texte) */
  sentence_count: z.number().int().positive().optional().catch(undefined),
  
  /**
   * Pattern regex que la valeur DOIT respecter (validation positive).
   * Ex: "^https?://.+\\.(jpg|jpeg|png|webp)$" pour une URL d'image.
   */
  pattern: z.string().optional().catch(undefined),

  /** Mots interdits (vocabulaire promotionnel, etc.) */
  forbidden_words: z.array(z.string()).optional().catch(undefined),
  
  /** Patterns interdits (regex ou texte simple) */
  forbidden_patterns: z.array(z.string()).optional().catch(undefined),
  
  /** Termes temporels interdits */
  forbidden_temporal_terms: z.array(z.string()).optional().catch(undefined),
  
  /** Messages d'erreur personnalisés */
  messages: z.record(z.string(), z.string()).optional().catch(undefined),
  
  /** Sévérité (error = bloquant, warning = avertissement) */
  severity: z.enum(['error', 'warning']).default('error').catch('error'),
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
    /^[A-Z][A-Z0-9_]*_(titre|texte|image|lien|meta|liste|picto|repetitif)_[a-z0-9_]+$/,
    'Format: <TEMPLATE>_<TYPE>_<INDEX> (ex: POI_titre_1, POI_meta_duree, POI_picto_interet, INSPIRATION_repetitif_poi_cards)'
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

  /**
   * Si true, l'IA ignore ce champ — aucune instruction n'est envoyée, aucune valeur n'est générée.
   * La saisie est manuelle, page par page, dans l'éditeur de contenu.
   * Utilisé pour les champs dont la valeur est unique à chaque page mais non générée
   * (ex: URL d'image spécifique, lien externe particulier, durée de visite...).
   * Ne s'applique que si default_value et service_id sont absents.
   */
  skip_ai: z.boolean().optional().catch(undefined),

  /**
   * Identifiant d'un FieldService enregistré dans la collection `field_services`.
   * Quand ce champ est renseigné, la valeur est calculée automatiquement à l'export
   * par le service correspondant (ex: sommaire, statistiques...).
   *
   * Ce mode est exclusif : ai_instructions, default_value et skip_ai sont ignorés.
   *
   * Ex: "sommaire_generator", "stats_calculator"
   */
  service_id: z.string().optional(),

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
   * Si type=repetitif : gabarit des sous-champs à répéter.
   * Chaque entrée décrit un champ de l'objet JSON répété.
   * Ex: [ { name:"image", type:"image", label:"Photo" }, { name:"titre", type:"titre" }, { name:"hashtag", type:"meta" } ]
   */
  sub_fields: z.array(z.object({
    name:            z.string().min(1),
    type:            z.enum(['titre', 'texte', 'image', 'lien', 'meta']),
    label:           z.string().optional(),
    ai_instructions: z.string().optional(),
  })).optional(),

  /**
   * Si type=repetitif : nombre maximum de répétitions autorisées.
   * L'IA génère entre 1 et max_repetitions entrées selon le contenu disponible.
   */
  max_repetitions: z.number().int().min(1).optional(),

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

  /**
   * Pour type=lien uniquement — configuration de l'intitulé du lien.
   * Si absent, le comportement est hérité du mode top-level (ai_instructions / default_value / skip_ai).
   * Quand link_label ET link_url sont définis, la valeur exportée est un objet JSON :
   *   { "label": "...", "url": "..." }
   */
  link_label: z.object({
    /** Instructions pour l'IA (mode IA) */
    ai_instructions: z.string().optional(),
    /** Valeur fixe identique sur toutes les pages (mode valeur par défaut) */
    default_value: z.string().optional(),
    /** L'IA ignore ce champ — saisie manuelle page par page (mode manuel) */
    skip_ai: z.boolean().optional(),
  }).optional(),

  /**
   * Pour type=lien uniquement — configuration de l'URL du lien.
   * Fonctionne de pair avec link_label.
   */
  link_url: z.object({
    ai_instructions: z.string().optional(),
    default_value: z.string().optional(),
    skip_ai: z.boolean().optional(),
  }).optional(),

  /**
   * Pour type=image uniquement.
   * Si 'destination_pool', l'IA choisit l'image dans le pool des photos analysées
   * de la destination (collection image_analyses) plutôt que de la générer librement.
   */
  source: z.literal('destination_pool').optional(),

  /**
   * Filtres optionnels par detail_type appliqués au pool destination.
   * Ex: ['paysage', 'vue_aerienne']
   */
  pool_tags: z.array(z.string()).optional(),

  /**
   * Critères de sélection pour le mode pool destination.
   * Indépendant de ai_instructions (mode IA standard).
   * Ex: "Préférer une image panoramique sans texte superposé."
   */
  pool_instructions: z.string().optional(),
});

export type TemplateField = z.infer<typeof TemplateFieldSchema>;

/**
 * Source d'information pour la génération IA d'une page
 * - article_source      : uniquement l'article WordPress référencé dans les paramètres de la page
 * - cluster_auto_match  : recherche automatique de l'article "Que faire à <nom du cluster>"
 *                         parmi les articles WordPress ingérés, basée sur le titre de la page
 * - tous_articles_site  : l'ensemble des articles collectés depuis WordPress
 * - tous_articles_et_llm: les articles du site + la base de connaissances propre du LLM
 * - non_applicable      : aucune source (sommaire, couverture, etc.)
 */
export const InfoSourceEnum = z.enum([
  'article_source',
  'cluster_auto_match',
  'saison_auto_match',
  'inspiration_auto_match',
  'tous_articles_site',
  'tous_articles_et_llm',
  'non_applicable',
]);

export type InfoSource = z.infer<typeof InfoSourceEnum>;

export const INFO_SOURCE_LABELS: Record<InfoSource, string> = {
  article_source:          "L'article référencé dans les paramètres de la page",
  cluster_auto_match:      'Recherche automatique "Que faire à [cluster]"',
  saison_auto_match:       'Recherche automatique "Partir à [destination] en [mois]"',
  inspiration_auto_match:  'Articles sources de tous les POIs de la page inspiration',
  tous_articles_site:      "L'ensemble des articles WordPress collectés du site",
  tous_articles_et_llm:    "Les articles du site + la base de connaissances du LLM",
  non_applicable:          "Ne s'applique pas",
};

export const INFO_SOURCE_DESCRIPTIONS: Record<InfoSource, string> = {
  article_source:
    "L'IA se base uniquement sur l'article lié à cette page (ex : fiche POI, article inspiration)",
  cluster_auto_match:
    "L'IA recherche automatiquement l'article dont le titre contient le nom du cluster (ex: \"Que faire à Puerto de la Cruz\"). Idéal pour les pages de type Cluster.",
  saison_auto_match:
    "L'IA recherche automatiquement l'article saisonnier correspondant (ex: \"Partir à Tenerife en mai\" pour le printemps). La saison est définie page par page dans le chemin de fer.",
  inspiration_auto_match:
    "L'IA charge automatiquement l'article WordPress source de chaque POI associé à la page inspiration. Tous les articles sont fournis en contexte pour une rédaction multi-lieux cohérente.",
  tous_articles_site:
    "L'IA parcourt tous les articles WordPress ingérés pour trouver les informations pertinentes",
  tous_articles_et_llm:
    "L'IA utilise les articles du site et peut compléter avec ses propres connaissances sur la destination",
  non_applicable:
    "Aucune source requise — le contenu de la page est généré sans contexte éditorial (ex : sommaire, page de garde)",
};

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

  /**
   * Source d'information à utiliser lors de la génération IA des pages.
   * Détermine le contexte fourni au LLM :
   * - article_source      : article WordPress lié à la page
   * - tous_articles_site  : tous les articles WordPress du site
   * - tous_articles_et_llm: articles du site + connaissances propres du LLM
   * Par défaut : article_source
   */
  info_source: InfoSourceEnum.default('article_source'),
  
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
  titre:     'Titre',
  texte:     'Texte',
  image:     'Image',
  lien:      'Lien',
  meta:      'Métadonnée',
  liste:     'Liste',
  picto:     'Pictogramme',
  repetitif: 'Répétitif',
};

/**
 * Descriptions des types de champs
 */
export const FIELD_TYPE_DESCRIPTIONS: Record<TemplateFieldType, string> = {
  titre:     'Texte court servant de titre ou sous-titre',
  texte:     'Texte informatif court, calibré, non narratif long',
  image:     'Référence à une image locale copiée depuis WordPress',
  lien:      'URL pointant vers un contenu externe',
  meta:      'Métadonnée éditoriale normée, non narrative',
  liste:     'Élément de liste courte, avec nombre fixe de champs',
  picto:     'Valeur parmi une liste d\'options prédéfinies (ex: oui/non, incontournable/intéressant/à voir)',
  repetitif: 'Gabarit de sous-champs répété N fois (photo + titre + hashtag × 6, etc.)',
};
