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

export interface NormalizedPage {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
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

// ─── Service principal ────────────────────────────────────────────────────────

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
      const entry: ActivePicto = {
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
