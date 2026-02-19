/**
 * normalize-export.ts  (package @redactor-guide/exporters)
 *
 * Ré-export des types publics du normaliseur + fonction standalone
 * utilisable depuis le CLI et les scripts locaux sans dépendre du backend.
 *
 * Usage CLI :
 *   import { normalizeGuideExport } from '@redactor-guide/exporters';
 *   const normalized = normalizeGuideExport(rawJson, { dropNullPictos: true });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizerOptions {
  maxTextLengths?: Record<string, number>;
  dropNullPictos?: boolean;
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
  has_image: boolean;
  image_count: number;
  text_char_count: number;
  text_density: 'light' | 'medium' | 'heavy';
  picto_count: number;
  layout_variant: string;
  is_complete: boolean;
  missing_hints: string[];
  texts_truncated: number;
}

export interface NormalizedImage {
  url: string;
  local_filename: string;
  local_path: string;
  local?: string;
}

export interface NormalizedPage {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  content: {
    text: Record<string, string>;
    images: Record<string, NormalizedImage>;
    pictos: Record<string, ActivePicto>;
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

// ─── Constantes ───────────────────────────────────────────────────────────────

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

const TEMPLATE_VARIANT_MAP: Record<string, string> = {
  POI: 'poi',
  CLUSTER: 'cluster',
  SAISON: 'saison',
  COUVERTURE: 'couverture',
  SECTION_INTRO: 'section_intro',
  PRESENTATION_GUIDE: 'presentation_guide',
  PRESENTATION_DESTINATION: 'presentation_destination',
  CARTE_DESTINATION: 'carte',
  INSPIRATION: 'inspiration',
  ALLER_PLUS_LOIN: 'aller_plus_loin',
  A_PROPOS_RL: 'a_propos',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveLayoutVariant(templateName: string): string {
  const upper = templateName.toUpperCase();
  for (const [key, variant] of Object.entries(TEMPLATE_VARIANT_MAP)) {
    if (upper.startsWith(key)) return variant;
  }
  return 'generic';
}

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

/**
 * Picto enrichi avec variant_layer résolu.
 * Étend ActivePicto — indesign_layer est conservé pour la rétro-compatibilité.
 */
export interface ActivePictoV2 extends ActivePicto {
  /**
   * Calque InDesign spécifique à la valeur du picto.
   * Ex : POI_picto_interet = "interessant" → "picto_interet_2"
   * null si aucune règle de variant ne correspond.
   */
  variant_layer: string | null;
}

/**
 * Image avec hints de mise en page (dimensions si disponibles, null sinon).
 * Étend NormalizedImage — les champs existants sont conservés.
 */
export interface NormalizedImageV2 extends NormalizedImage {
  /** Rapport largeur/hauteur (ex: 1.78 pour 16:9). null si non disponible. */
  aspect_ratio: number | null;
  /** Orientation déduite du rapport. null si non disponible. */
  orientation: 'landscape' | 'portrait' | 'square' | null;
}

/** Stats supplémentaires introduites en V2. */
export interface NormalizationStatsV2 extends NormalizationStats {
  variant_layers_resolved:  number;
  pictos_active_derived:    number;
  images_with_layout_hints: number;
}

/** Page normalisée V2 — super-ensemble de NormalizedPage. */
export interface NormalizedPageV2 {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  entity_meta?: Record<string, unknown>;
  content: {
    text:    Record<string, string>;
    /** Images avec hints de layout (rétro-compatible NormalizedImage). */
    images:  Record<string, NormalizedImageV2>;
    /** Pictos avec variant_layer (rétro-compatible ActivePicto). */
    pictos:  Record<string, ActivePictoV2>;
    /**
     * @deprecated Conservé pour rétro-compatibilité.
     * Utiliser content._derived.pictos_active à la place.
     */
    pictos_active: ActivePictoV2[];
    /** Métadonnées signalant que pictos_active est désormais dérivé. */
    pictos_active_meta: {
      derived: true;
      deprecated: true;
    };
    /** Champs dérivés recalculés à la normalisation — source de vérité V2. */
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

// ─── Table de variants picto ──────────────────────────────────────────────────
//
// Clé  : "<field_name>|<value>"
// Value: calque InDesign spécifique à cette combinaison champ/valeur.
//
// À compléter au fur et à mesure que de nouveaux champs picto sont ajoutés.

const PICTO_VARIANT_TABLE: Record<string, string> = {
  // Intérêt du lieu (3 niveaux)
  'POI_picto_interet|incontournable': 'picto_interet_1',
  'POI_picto_interet|interessant':    'picto_interet_2',
  'POI_picto_interet|a_voir':         'picto_interet_3',
  // Accessibilité PMR (3 niveaux)
  'POI_picto_pmr|100': 'picto_pmr_full',
  'POI_picto_pmr|50':  'picto_pmr_half',
  'POI_picto_pmr|0':   'picto_pmr_none',
  // Pictos booléens
  'POI_picto_escaliers|oui':    'picto_escaliers_oui',
  'POI_picto_escaliers|non':    'picto_escaliers_non',
  'POI_picto_toilettes|oui':    'picto_toilettes_oui',
  'POI_picto_toilettes|non':    'picto_toilettes_non',
  'POI_picto_restauration|oui': 'picto_restauration_oui',
  'POI_picto_restauration|non': 'picto_restauration_non',
  'POI_picto_famille|oui':      'picto_famille_oui',
  'POI_picto_famille|non':      'picto_famille_non',
};

// ─── Helpers exportés ─────────────────────────────────────────────────────────

/**
 * Résout le variant_layer d'un picto selon sa valeur.
 *
 * Priorité de résolution :
 *   1. mappings.picto_values (fourni au runtime depuis le JSON exporté)
 *   2. Table statique PICTO_VARIANT_TABLE (défaut)
 *   3. null (aucun variant défini)
 *
 * @param picto         - Entrée picto (ActivePicto ou sous-ensemble)
 * @param pictoValueMap - mappings.picto_values du JSON exporté (optionnel)
 */
export function resolveVariantLayer(
  picto: Pick<ActivePicto, 'field' | 'value'>,
  pictoValueMap?: Record<string, Record<string, string>>
): string | null {
  const key = `${picto.field}|${picto.value}`;

  // 1. Table runtime fournie depuis mappings.picto_values
  if (pictoValueMap) {
    const runtimeVariant = pictoValueMap[picto.field]?.[picto.value];
    if (runtimeVariant) return runtimeVariant;
  }

  // 2. Table statique
  return PICTO_VARIANT_TABLE[key] ?? null;
}

/**
 * Dérive le tableau ordonné des pictos actifs depuis le dictionnaire pictos.
 * pictos_active est recalculé à chaque normalisation — jamais stocké comme
 * source de vérité.
 *
 * @param pictos - Dictionnaire pictos normalisés (V2)
 */
export function deriveActivePictos(
  pictos: Record<string, ActivePictoV2>
): ActivePictoV2[] {
  return Object.values(pictos).filter(p => p.picto_key !== null && p.picto_key !== '');
}

/**
 * Enrichit une image avec des hints de layout (aspect_ratio, orientation).
 *
 * Les dimensions ne sont pas récupérées à distance — si elles ne sont pas
 * disponibles dans l'objet source, les champs restent null.
 * Prévoir un enrichissement asynchrone ultérieur si nécessaire.
 *
 * @param img - Image normalisée (V1 ou V2)
 * @param dimensions - Dimensions optionnelles { width, height } si connues
 */
export function enrichImageLayoutHints(
  img: NormalizedImage,
  dimensions?: { width: number; height: number } | null
): NormalizedImageV2 {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      ...img,
      aspect_ratio: null,
      orientation:  null,
    };
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

// ─── Fonction principale V1 ───────────────────────────────────────────────────

/**
 * Normalise un JSON de guide "riche" (sortie de buildGuideExport) en JSON
 * "layout strict" prêt pour InDesign.
 *
 * @param raw     - JSON brut retourné par ExportService.buildGuideExport()
 * @param options - Options de normalisation
 */
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

    // 1. Textes : nettoyage + troncature
    const cleanText: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawText)) {
      if (isEmptyValue(val)) { stats.null_fields_removed++; continue; }
      let str = String(val).trim();
      if (str === '') { stats.empty_fields_removed++; continue; }
      const maxLen = effectiveMaxLengths[key];
      if (maxLen) {
        const [t, wasTruncated] = truncate(str, maxLen, truncateMarker);
        if (wasTruncated) { stats.texts_truncated++; pageTruncated++; }
        str = t;
      }
      cleanText[key] = str;
    }

    // 2. Images : suppression des vides
    const cleanImages: Record<string, NormalizedImage> = {};
    for (const [key, img] of Object.entries(rawImages)) {
      if (!img || isEmptyValue(img.url)) { stats.null_fields_removed++; continue; }
      cleanImages[key] = {
        url: String(img.url),
        local_filename: img.local_filename ?? '',
        local_path: img.local_path ?? '',
        ...(img.local ? { local: String(img.local) } : {}),
      };
    }

    // 3. Pictos : suppression des inactifs + tableau pictos_active
    const cleanPictos: Record<string, ActivePicto> = {};
    const pictosActive: ActivePicto[] = [];

    for (const [key, picto] of Object.entries(rawPictos)) {
      if (!picto || isEmptyValue(picto.value)) { stats.null_fields_removed++; continue; }
      if (dropNullPictos && picto.picto_key === null) {
        stats.pictos_inactive_removed++;
        continue;
      }
      const entry: ActivePicto = {
        field: key,
        picto_key: picto.picto_key ?? '',
        indesign_layer: picto.indesign_layer ?? key.toLowerCase(),
        label: picto.label ?? '',
        value: String(picto.value),
      };
      cleanPictos[key] = entry;
      if (picto.picto_key !== null) pictosActive.push(entry);
    }

    // 4. Layout flags
    const imageCount = Object.keys(cleanImages).length;
    const charCount  = Object.values(cleanText).reduce((s, t) => s + t.length, 0);
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
      picto_count: pictosActive.length,
      layout_variant: resolveLayoutVariant(page.template ?? ''),
      is_complete: !!titre && Object.keys(cleanText).length > 0,
      missing_hints: missingHints,
      texts_truncated: pageTruncated,
    };

    return {
      id: page.id ?? '',
      page_number: page.page_number ?? 0,
      template: page.template ?? 'UNKNOWN',
      section: page.section ?? null,
      titre,
      status: page.status ?? '',
      url_source: page.url_source ?? null,
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

// ─── Fonction principale V2 ───────────────────────────────────────────────────

/**
 * normalizeGuideExportV2 — super-ensemble idempotent de normalizeGuideExport.
 *
 * Nouveautés par rapport à V1 :
 *   1. resolveVariantLayer  → pictos[*].variant_layer
 *   2. deriveActivePictos   → content._derived.pictos_active (source de vérité)
 *   3. enrichImageLayoutHints → images[*].aspect_ratio + orientation
 *
 * Rétro-compatibilité :
 *   - Tous les champs V1 sont conservés (pictos_active, indesign_layer…)
 *   - pictos_active_meta signale la dépréciation sans le supprimer
 *   - version passée à "1.1.0"
 *
 * @param raw     - JSON brut (buildGuideExport) ou JSON déjà normalisé V1
 * @param options - Mêmes options que normalizeGuideExport
 */
export function normalizeGuideExportV2(
  raw: Record<string, unknown>,
  options: NormalizerOptions = {}
): NormalizedGuideExportV2 {
  // ── 0. Appliquer la normalisation V1 ──────────────────────────────────────
  const v1 = normalizeGuideExport(raw, options);

  // Récupérer la table de variants runtime depuis mappings si fournie
  const pictoValueMap = (v1.mappings as any)?.picto_values as
    | Record<string, Record<string, string>>
    | undefined;

  // Stats V2 supplémentaires
  const statsV2: NormalizationStatsV2 = {
    ...v1.normalization.stats,
    variant_layers_resolved:  0,
    pictos_active_derived:    0,
    images_with_layout_hints: 0,
  };

  // ── 1. Enrichir les pages ─────────────────────────────────────────────────
  const pagesV2: NormalizedPageV2[] = v1.pages.map(page => {

    // ── 1a. Pictos → variant_layer ─────────────────────────────────────────
    const pictosV2: Record<string, ActivePictoV2> = {};
    for (const [key, picto] of Object.entries(page.content.pictos)) {
      const variantLayer = resolveVariantLayer(picto, pictoValueMap);
      if (variantLayer !== null) statsV2.variant_layers_resolved++;
      pictosV2[key] = { ...picto, variant_layer: variantLayer };
    }

    // ── 1b. pictos_active dérivé ───────────────────────────────────────────
    const derivedPictosActive = deriveActivePictos(pictosV2);
    statsV2.pictos_active_derived += derivedPictosActive.length;

    // ── 1c. Images → layout hints ─────────────────────────────────────────
    const imagesV2: Record<string, NormalizedImageV2> = {};
    for (const [key, img] of Object.entries(page.content.images)) {
      // Dimensions non disponibles sans fetch — null par défaut.
      // Un enrichissement asynchrone peut être effectué ultérieurement via
      // enrichImageLayoutHints(img, { width, height }) après téléchargement.
      const enriched = enrichImageLayoutHints(img, null);
      if (enriched.aspect_ratio !== null) statsV2.images_with_layout_hints++;
      imagesV2[key] = enriched;
    }

    return {
      // Champs V1 inchangés
      id:          page.id,
      page_number: page.page_number,
      template:    page.template,
      section:     page.section,
      titre:       page.titre,
      status:      page.status,
      url_source:  page.url_source,
      // entity_meta est optionnel (présent dans le service, absent dans le package)
      ...('entity_meta' in page ? { entity_meta: (page as any).entity_meta } : {}),
      layout: page.layout,
      content: {
        text:   page.content.text,
        images: imagesV2,
        pictos: pictosV2,
        // Rétro-compatibilité : pictos_active conservé mais dérivé
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
