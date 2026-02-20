/**
 * normalize-export.service.ts
 *
 * Transforme le JSON "riche" produit par ExportService (Mongo-aware)
 * en un JSON "layout strict" prêt pour le script InDesign.
 *
 * Pipeline :
 *   buildGuideExport()  →  normalizeGuideExport()  →  InDesign / resolveImages
 *
 * Opérations :
 *  1. Suppression des null / vides / pictos inactifs
 *  2. Troncature des textes selon max_chars (template ou override)
 *  3. Calcul des flags layout par page
 *  4. Construction du tableau pictos_active (ordonné, picto_key non null)
 *  5. Stabilisation de la structure (clés constantes sur chaque page)
 */

// ─── Types publics ────────────────────────────────────────────────────────────

export interface NormalizerOptions {
  /**
   * Longueurs max par nom de champ.
   * Surcharge les limites issues du template.
   * Ex: { POI_texte_1: 480, POI_texte_2: 480 }
   */
  maxTextLengths?: Record<string, number>;

  /**
   * Supprimer les pictos dont picto_key === null (défaut: true).
   * Mettre à false pour conserver toutes les valeurs dans pictos_active.
   */
  dropNullPictos?: boolean;

  /**
   * Suffixe ajouté quand un texte est tronqué (défaut: '…').
   */
  truncateMarker?: string;
}

export interface ActivePicto {
  field: string;
  picto_key: string;
  indesign_layer: string;
  label: string;
  value: string;
}

export interface LayoutFlags {
  /** La page a au moins un champ image avec une URL valide */
  has_image: boolean;
  /** Nombre de champs image renseignés */
  image_count: number;
  /** Densité textuelle estimée en caractères totaux */
  text_char_count: number;
  /** Catégorie de densité */
  text_density: 'light' | 'medium' | 'heavy';
  /** Nombre de pictos actifs (picto_key non null) */
  picto_count: number;
  /** Variant de mise en page déduit du nom de template */
  layout_variant: string;
  /** Tous les champs obligatoires présents (titre + ≥ 1 texte) */
  is_complete: boolean;
  /** Champs qui semblent manquer (titre vide, aucun texte, aucune image) */
  missing_hints: string[];
  /** Nombre de textes tronqués sur cette page */
  texts_truncated: number;
}

export interface NormalizedImage {
  url: string;
  local_filename: string;
  local_path: string;
  local?: string;
}

export interface EntityMeta {
  page_type:         string | null;
  cluster_id:        string | null;
  cluster_name:      string | null;
  poi_id:            string | null;
  poi_name:          string | null;
  inspiration_id:    string | null;
  inspiration_title: string | null;
  season:            string | null;
}

export interface NormalizedPage {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  /** Identifiants d'entité propagés depuis le chemin de fer — utilisés par le storyboard builder */
  entity_meta: EntityMeta;
  content: {
    /** Textes filtrés, potentiellement tronqués */
    text: Record<string, string>;
    /** Images filtrées (url non vide) */
    images: Record<string, NormalizedImage>;
    /** Pictos résolus — uniquement picto_key !== null */
    pictos: Record<string, ActivePicto>;
    /** Tableau ordonné des pictos actifs (pour scripts InDesign) */
    pictos_active: ActivePicto[];
  };
  layout: LayoutFlags;
}

export interface NormalizationStats {
  pages_processed: number;
  texts_truncated: number;
  null_fields_removed: number;
  empty_fields_removed: number;
  pictos_inactive_removed: number;
}

export interface NormalizedGuideExport {
  meta: Record<string, unknown> & { normalized_at: string };
  mappings: Record<string, unknown>;
  pages: NormalizedPage[];
  normalization: {
    version: string;
    options: NormalizerOptions;
    stats: NormalizationStats;
  };
}

// ─── Limites par défaut issues des templates connus ──────────────────────────

const DEFAULT_MAX_LENGTHS: Record<string, number> = {
  POI_texte_1: 480,
  POI_texte_2: 480,
  CLUSTER_texte_description: 600,
  CLUSTER_texte_ambiance: 400,
  CLUSTER_texte_conseil_acces: 300,
  PRESENTATION_GUIDE_texte_intro: 800,
  PRESENTATION_GUIDE_texte_comment_utiliser: 600,
  PRESENTATION_DESTINATION_texte_intro: 800,
  PRESENTATION_DESTINATION_texte_histoire: 600,
  PRESENTATION_DESTINATION_texte_geographie: 500,
  SECTION_INTRO_texte_chapeau: 400,
  SECTION_INTRO_texte_presentation: 600,
  SAISON_texte_description: 600,
  SAISON_texte_conseil: 300,
  ALLER_PLUS_LOIN_texte_intro: 500,
  A_PROPOS_RL_texte_presentation: 600,
  A_PROPOS_RL_texte_mission: 400,
  INSPIRATION_texte_angle_editorial: 400,
};

// ─── Variant de mise en page déduit du template ───────────────────────────────

const TEMPLATE_VARIANT_MAP: Record<string, string> = {
  POI:                    'poi',
  CLUSTER:                'cluster',
  SAISON:                 'saison',
  COUVERTURE:             'couverture',
  SECTION_INTRO:          'section_intro',
  PRESENTATION_GUIDE:     'presentation_guide',
  PRESENTATION_DESTINATION: 'presentation_destination',
  CARTE_DESTINATION:      'carte',
  INSPIRATION:            'inspiration',
  ALLER_PLUS_LOIN:        'aller_plus_loin',
  A_PROPOS_RL:            'a_propos',
};

function resolveLayoutVariant(templateName: string): string {
  const upper = templateName.toUpperCase();
  for (const [key, variant] of Object.entries(TEMPLATE_VARIANT_MAP)) {
    if (upper.startsWith(key)) return variant;
  }
  return 'generic';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function truncate(text: string, max: number, marker: string): [string, boolean] {
  if (text.length <= max) return [text, false];
  return [text.slice(0, max - marker.length).trimEnd() + marker, true];
}

function textDensity(chars: number): 'light' | 'medium' | 'heavy' {
  if (chars < 400) return 'light';
  if (chars < 1000) return 'medium';
  return 'heavy';
}

// ─── Types V2 ─────────────────────────────────────────────────────────────────

export interface ActivePictoV2 extends ActivePicto {
  variant_layer: string | null;
}

export interface NormalizedImageV2 extends NormalizedImage {
  aspect_ratio: number | null;
  orientation: 'landscape' | 'portrait' | 'square' | null;
}

export interface NormalizationStatsV2 extends NormalizationStats {
  variant_layers_resolved:  number;
  pictos_active_derived:    number;
  images_with_layout_hints: number;
}

export interface NormalizedPageV2 {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  entity_meta: EntityMeta;
  content: {
    text:    Record<string, string>;
    images:  Record<string, NormalizedImageV2>;
    pictos:  Record<string, ActivePictoV2>;
    /** @deprecated Utiliser content._derived.pictos_active */
    pictos_active: ActivePictoV2[];
    pictos_active_meta: {
      derived:    true;
      deprecated: true;
    };
    _derived: {
      pictos_active: ActivePictoV2[];
    };
  };
  layout: LayoutFlags;
}

export interface NormalizedGuideExportV2 {
  meta:     Record<string, unknown> & { normalized_at: string };
  mappings: Record<string, unknown>;
  pages:    NormalizedPageV2[];
  normalization: {
    version: '1.1.0';
    options: NormalizerOptions;
    stats:   NormalizationStatsV2;
  };
}

// ─── Helpers exportés ─────────────────────────────────────────────────────────

/**
 * Résout le variant_layer d'un picto.
 * Depuis la v1.1, variant_layer est calculé par export.service.ts (via field.option_layers
 * du template, ou VARIANT_LAYER_FALLBACK). Le normaliseur le passe simplement tel quel.
 * Cette fonction reste pour la rétrocompatibilité des appels externes.
 */
export function resolveVariantLayer(
  picto: Pick<ActivePicto, 'field' | 'value'> & { variant_layer?: string | null },
): string | null {
  return picto.variant_layer ?? null;
}

/**
 * Dérive le tableau ordonné des pictos actifs depuis le dictionnaire pictos V2.
 * Source de vérité unique — ne jamais lire pictos_active directement.
 */
export function deriveActivePictos(
  pictos: Record<string, ActivePictoV2>
): ActivePictoV2[] {
  return Object.values(pictos).filter(p => p.picto_key !== null && p.picto_key !== '');
}

/**
 * Enrichit une image avec des hints de layout (aspect_ratio, orientation).
 * Les dimensions ne sont PAS récupérées à distance : passer { width, height }
 * après téléchargement si disponibles, ou null pour différer l'enrichissement.
 */
export function enrichImageLayoutHints(
  img: NormalizedImage,
  dimensions?: { width: number; height: number } | null
): NormalizedImageV2 {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { ...img, aspect_ratio: null, orientation: null };
  }
  const ratio = dimensions.width / dimensions.height;
  let orientation: NormalizedImageV2['orientation'];
  if (Math.abs(ratio - 1) < 0.05) {
    orientation = 'square';
  } else if (ratio > 1) {
    orientation = 'landscape';
  } else {
    orientation = 'portrait';
  }
  return {
    ...img,
    aspect_ratio: Math.round(ratio * 1000) / 1000,
    orientation,
  };
}

// ─── Service principal V1 ─────────────────────────────────────────────────────

export function normalizeGuideExport(
  raw: Record<string, unknown>,
  options: NormalizerOptions = {}
): NormalizedGuideExport {
  const {
    maxTextLengths = {},
    dropNullPictos = true,
    truncateMarker = '…',
  } = options;

  const effectiveMaxLengths = { ...DEFAULT_MAX_LENGTHS, ...maxTextLengths };

  const stats: NormalizationStats = {
    pages_processed: 0,
    texts_truncated: 0,
    null_fields_removed: 0,
    empty_fields_removed: 0,
    pictos_inactive_removed: 0,
  };

  const rawPages = (raw.pages as any[]) ?? [];

  const normalizedPages: NormalizedPage[] = rawPages.map((page: any) => {
    stats.pages_processed++;

    const rawText   = (page.content?.text   ?? {}) as Record<string, unknown>;
    const rawImages = (page.content?.images ?? {}) as Record<string, any>;
    const rawPictos = (page.content?.pictos ?? {}) as Record<string, any>;

    let pageTruncated = 0;

    // ── 1. Textes ──────────────────────────────────────────────────────────
    const cleanText: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawText)) {
      if (isEmptyValue(val)) {
        stats.null_fields_removed++;
        continue;
      }
      let str = String(val).trim();
      if (str === '') {
        stats.empty_fields_removed++;
        continue;
      }
      const maxLen = effectiveMaxLengths[key];
      if (maxLen) {
        const [truncated, wasTruncated] = truncate(str, maxLen, truncateMarker);
        if (wasTruncated) {
          stats.texts_truncated++;
          pageTruncated++;
        }
        str = truncated;
      }
      cleanText[key] = str;
    }

    // ── 2. Images ──────────────────────────────────────────────────────────
    const cleanImages: Record<string, NormalizedImage> = {};
    for (const [key, img] of Object.entries(rawImages)) {
      if (!img || isEmptyValue(img.url)) {
        stats.null_fields_removed++;
        continue;
      }
      cleanImages[key] = {
        url: String(img.url),
        local_filename: img.local_filename ?? '',
        local_path: img.local_path ?? '',
        ...(img.local ? { local: String(img.local) } : {}),
      };
    }

    // ── 3. Pictos ──────────────────────────────────────────────────────────
    const cleanPictos: Record<string, ActivePicto> = {};
    const pictosActive: ActivePicto[] = [];

    for (const [key, picto] of Object.entries(rawPictos)) {
      if (!picto || isEmptyValue(picto.value)) {
        stats.null_fields_removed++;
        continue;
      }
      if (dropNullPictos && picto.picto_key === null) {
        stats.pictos_inactive_removed++;
        continue;
      }
      // Spread d'abord pour conserver toutes les propriétés du raw (variant_layer, etc.)
      // puis on surcharge avec les valeurs normalisées obligatoires.
      const entry: ActivePicto = {
        ...picto,
        field: key,
        picto_key: picto.picto_key ?? '',
        indesign_layer: picto.indesign_layer ?? key.toLowerCase(),
        label: picto.label ?? '',
        value: String(picto.value),
      };
      cleanPictos[key] = entry;
      if (picto.picto_key !== null) {
        pictosActive.push(entry);
      }
    }

    // ── 4. Layout flags ────────────────────────────────────────────────────
    const imageCount  = Object.keys(cleanImages).length;
    const charCount   = Object.values(cleanText).reduce((s, t) => s + t.length, 0);
    const pictoCount  = pictosActive.length;
    const missingHints: string[] = [];

    const titre = page.titre ?? '';
    if (!titre) missingHints.push('titre');
    if (Object.keys(cleanText).length === 0) missingHints.push('text_fields');
    if (imageCount === 0) missingHints.push('images');

    const layout: LayoutFlags = {
      has_image: imageCount > 0,
      image_count: imageCount,
      text_char_count: charCount,
      text_density: textDensity(charCount),
      picto_count: pictoCount,
      layout_variant: resolveLayoutVariant(page.template ?? ''),
      is_complete: !!titre && Object.keys(cleanText).length > 0,
      missing_hints: missingHints,
      texts_truncated: pageTruncated,
    };

    // ── 5. Page normalisée ─────────────────────────────────────────────────
    const rawEntityMeta = (page.entity_meta ?? {}) as Record<string, unknown>;
    const entity_meta: EntityMeta = {
      page_type:         (rawEntityMeta.page_type         as string)  ?? null,
      cluster_id:        (rawEntityMeta.cluster_id        as string)  ?? null,
      cluster_name:      (rawEntityMeta.cluster_name      as string)  ?? null,
      poi_id:            (rawEntityMeta.poi_id            as string)  ?? null,
      poi_name:          (rawEntityMeta.poi_name          as string)  ?? null,
      inspiration_id:    (rawEntityMeta.inspiration_id    as string)  ?? null,
      inspiration_title: (rawEntityMeta.inspiration_title as string)  ?? null,
      season:            (rawEntityMeta.season            as string)  ?? null,
    };

    return {
      id: page.id ?? '',
      page_number: page.page_number ?? 0,
      template: page.template ?? 'UNKNOWN',
      section: page.section ?? null,
      titre,
      status: page.status ?? '',
      url_source: page.url_source ?? null,
      entity_meta,
      content: {
        text: cleanText,
        images: cleanImages,
        pictos: cleanPictos,
        pictos_active: pictosActive,
      },
      layout,
    };
  });

  return {
    meta: {
      ...(raw.meta as Record<string, unknown>),
      normalized_at: new Date().toISOString(),
    },
    mappings: (raw.mappings as Record<string, unknown>) ?? {},
    pages: normalizedPages,
    normalization: {
      version: '1.0.0',
      options: { maxTextLengths, dropNullPictos, truncateMarker },
      stats,
    },
  };
}

// ─── Service principal V2 ─────────────────────────────────────────────────────

/**
 * normalizeGuideExportV2 — super-ensemble idempotent de normalizeGuideExport.
 *
 * Nouveautés :
 *   1. pictos[*].variant_layer  — calque InDesign spécifique à la valeur
 *   2. content._derived.pictos_active — source de vérité dérivée
 *   3. images[*].aspect_ratio + orientation — hints de layout
 *
 * Rétro-compatibilité totale : tous les champs V1 sont préservés.
 */
export function normalizeGuideExportV2(
  raw: Record<string, unknown>,
  options: NormalizerOptions = {}
): NormalizedGuideExportV2 {
  const v1 = normalizeGuideExport(raw, options);

  const statsV2: NormalizationStatsV2 = {
    ...v1.normalization.stats,
    variant_layers_resolved:  0,
    pictos_active_derived:    0,
    images_with_layout_hints: 0,
  };

  const pagesV2: NormalizedPageV2[] = v1.pages.map(page => {

    // ── Pictos → variant_layer ─────────────────────────────────────────────
    // variant_layer est déjà calculé par export.service.ts (via field.option_layers
    // ou VARIANT_LAYER_FALLBACK). On le propage simplement ici.
    const pictosV2: Record<string, ActivePictoV2> = {};
    for (const [key, picto] of Object.entries(page.content.pictos)) {
      const variantLayer = (picto as any).variant_layer ?? null;
      if (variantLayer !== null) statsV2.variant_layers_resolved++;
      pictosV2[key] = { ...picto, variant_layer: variantLayer };
    }

    // ── pictos_active dérivé ───────────────────────────────────────────────
    const derivedPictosActive = deriveActivePictos(pictosV2);
    statsV2.pictos_active_derived += derivedPictosActive.length;

    // ── Images → layout hints ─────────────────────────────────────────────
    const imagesV2: Record<string, NormalizedImageV2> = {};
    for (const [key, img] of Object.entries(page.content.images)) {
      const enriched = enrichImageLayoutHints(img, null);
      if (enriched.aspect_ratio !== null) statsV2.images_with_layout_hints++;
      imagesV2[key] = enriched;
    }

    // entity_meta provient de NormalizedPage du service (présent ici)
    const rawEntityMeta = (page as any).entity_meta ?? {};
    const entity_meta: EntityMeta = {
      page_type:         rawEntityMeta.page_type         ?? null,
      cluster_id:        rawEntityMeta.cluster_id        ?? null,
      cluster_name:      rawEntityMeta.cluster_name      ?? null,
      poi_id:            rawEntityMeta.poi_id            ?? null,
      poi_name:          rawEntityMeta.poi_name          ?? null,
      inspiration_id:    rawEntityMeta.inspiration_id    ?? null,
      inspiration_title: rawEntityMeta.inspiration_title ?? null,
      season:            rawEntityMeta.season            ?? null,
    };

    return {
      id:          page.id,
      page_number: page.page_number,
      template:    page.template,
      section:     page.section,
      titre:       page.titre,
      status:      page.status,
      url_source:  page.url_source,
      entity_meta,
      layout: page.layout,
      content: {
        text:   page.content.text,
        images: imagesV2,
        pictos: pictosV2,
        pictos_active: derivedPictosActive,
        pictos_active_meta: {
          derived:    true as const,
          deprecated: true as const,
        },
        _derived: {
          pictos_active: derivedPictosActive,
        },
      },
    };
  });

  return {
    meta:     v1.meta,
    mappings: v1.mappings,
    pages:    pagesV2,
    normalization: {
      version: '1.1.0',
      options: v1.normalization.options,
      stats:   statsV2,
    },
  };
}
