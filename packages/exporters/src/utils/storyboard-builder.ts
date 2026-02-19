/**
 * storyboard-builder.ts
 *
 * Transforme le JSON normalisé d'un guide en un storyboard séquentiel
 * utilisable directement par le renderer InDesign.
 *
 * Pipeline :
 *   buildGuideExport()  →  normalizeGuideExport()  →  buildGuideStoryboard()
 *
 * Contrat :
 *  - Fonction pure et déterministe (même entrée → même sortie)
 *  - IDs de pages stables (ne dépendent pas du temps ni de l'aléatoire)
 *  - Aucune page null
 *  - Pages strictement séquentielles, ordonnées par page_number
 *  - Pas de calcul de layout ici (délégué au normalizer)
 */

// ─── Types entrant ────────────────────────────────────────────────────────────

/** Subset des types du normalizer (compatible sans dépendance croisée) */
export interface StoryboardInputPage {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  entity_meta?: {
    page_type?:         string | null;
    cluster_id?:        string | null;
    cluster_name?:      string | null;
    poi_id?:            string | null;
    poi_name?:          string | null;
    inspiration_id?:    string | null;
    inspiration_title?: string | null;
    season?:            string | null;
  };
  content: {
    text:          Record<string, string>;
    images:        Record<string, unknown>;
    pictos:        Record<string, unknown>;
    pictos_active: unknown[];
  };
  layout?: Record<string, unknown>;
}

export interface StoryboardInputGuide {
  meta:     Record<string, unknown>;
  mappings: Record<string, unknown>;
  pages:    StoryboardInputPage[];
  normalization?: Record<string, unknown>;
}

// ─── Types sortant ────────────────────────────────────────────────────────────

/**
 * Type sémantique de page — dérivé du nom de template.
 * Utilisé par le script InDesign pour choisir le gabarit de page.
 */
export type StoryboardPageType =
  | 'cover'
  | 'presentation_guide'
  | 'presentation_destination'
  | 'map'
  | 'section_intro'
  | 'cluster'
  | 'poi'
  | 'inspiration'
  | 'season'
  | 'aller_plus_loin'
  | 'a_propos'
  | 'generic';

export interface StoryboardPage {
  /** ID déterministe — stable pour une entrée identique */
  storyboard_id: string;
  /** Position 0-based dans le storyboard final */
  index: number;
  /** Type sémantique de la page */
  type: StoryboardPageType;
  /** Nom du template d'origine */
  template: string;

  // ── Identifiants d'entité (présents selon le type) ──────────────────────
  cluster_id?:        string;
  cluster_name?:      string;
  poi_id?:            string;
  poi_name?:          string;
  inspiration_id?:    string;
  inspiration_title?: string;
  season?:            string;
  section?:           string | null;

  // ── Contenu de la page ───────────────────────────────────────────────────
  data: {
    titre:      string;
    status:     string;
    url_source: string | null;
    content:    StoryboardInputPage['content'];
  };

  /** Flags layout propagés depuis le normalizer (vide si non calculé) */
  layout: Record<string, unknown>;

  /** ID de la page source (MongoDB _id) — traçabilité */
  source_page_id: string;
}

export interface StoryboardMeta {
  guide_id:     string;
  guide_name:   string;
  destination:  string;
  year:         unknown;
  language:     string;
  version:      string;
  built_at:     string;
  source_exported_at: string;
}

export interface StoryboardStats {
  total_pages: number;
  by_type:     Record<StoryboardPageType | string, number>;
}

export interface StoryboardOutput {
  guide:  StoryboardMeta;
  pages:  StoryboardPage[];
  stats:  StoryboardStats;
}

// ─── Mapping template → type sémantique ──────────────────────────────────────

const TEMPLATE_TYPE_MAP: Array<[prefix: string, type: StoryboardPageType]> = [
  ['COUVERTURE',                'cover'],
  ['PRESENTATION_GUIDE',        'presentation_guide'],
  ['PRESENTATION_DESTINATION',  'presentation_destination'],
  ['CARTE_DESTINATION',         'map'],
  ['SECTION_INTRO',             'section_intro'],
  ['CLUSTER',                   'cluster'],
  ['POI',                       'poi'],
  ['INSPIRATION',               'inspiration'],
  ['SAISON',                    'season'],
  ['ALLER_PLUS_LOIN',           'aller_plus_loin'],
  ['A_PROPOS_RL',               'a_propos'],
];

function resolvePageType(templateName: string): StoryboardPageType {
  const upper = templateName.toUpperCase();
  for (const [prefix, type] of TEMPLATE_TYPE_MAP) {
    if (upper.startsWith(prefix)) return type;
  }
  return 'generic';
}

// ─── ID déterministe ──────────────────────────────────────────────────────────

/**
 * Génère un ID de page storyboard stable et lisible.
 *
 * Format : stb_{guide_suffix}_{padded_index}_{type}_{entity_slug}
 *
 * Déterministe car il dépend uniquement de :
 *   - La fin de l'ID guide (immuable)
 *   - L'index dans le tableau trié (lui-même dérivé de page_number)
 *   - Le type sémantique (dérivé du template)
 *   - L'identifiant d'entité (cluster_id / poi_id / source_page_id)
 */
function buildStoryboardId(
  guideSuffix: string,
  index: number,
  type: StoryboardPageType,
  entitySlug: string
): string {
  const idx = String(index).padStart(4, '0');
  // Normalise l'entitySlug : minuscules, alphanumérique + tirets seulement
  const slug = entitySlug.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24);
  return `stb_${guideSuffix}_${idx}_${type}_${slug}`;
}

/** Choisit le meilleur identifiant d'entité pour construire l'ID */
function pickEntitySlug(page: StoryboardInputPage, fallbackId: string): string {
  const em = page.entity_meta ?? {};
  return (
    em.poi_id         ||
    em.cluster_id     ||
    em.inspiration_id ||
    em.season         ||
    fallbackId
  );
}

// ─── Statuses considérés comme "actifs" ──────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  'generee_ia',
  'relue',
  'validee',
  'texte_coule',
  'visuels_montes',
]);

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Construit un storyboard séquentiel à partir d'un guide normalisé.
 *
 * @param input - Sortie de normalizeGuideExport() ou buildGuideExport()
 * @returns     - Objet { guide, pages, stats } prêt pour InDesign
 *
 * @pure        - Aucun effet de bord, résultat déterministe
 */
export function buildGuideStoryboard(input: StoryboardInputGuide): StoryboardOutput {
  const meta = input.meta;

  // Suffix de l'ID guide pour les storyboard_ids
  const guideId      = String(meta.guide_id ?? 'unknown');
  const guideSuffix  = guideId.slice(-8);

  // ── 1. Trier les pages par page_number (tri explicite pour déterminisme) ──
  const sorted = [...input.pages].sort((a, b) => {
    const na = a.page_number ?? 0;
    const nb = b.page_number ?? 0;
    return na !== nb ? na - nb : a.id.localeCompare(b.id);
  });

  // ── 2. Filtrer les pages draft / inactives ─────────────────────────────
  //    (le normalizer le fait déjà en amont mais on garantit ici aussi)
  const active = sorted.filter(p => {
    if (!p) return false;
    if (!p.status) return true; // statut absent → on garde (déjà filtré)
    return ACTIVE_STATUSES.has(p.status);
  });

  // ── 3. Construire les StoryboardPage ──────────────────────────────────
  const pages: StoryboardPage[] = active.map((page, index) => {
    const type        = resolvePageType(page.template);
    const entitySlug  = pickEntitySlug(page, page.id);
    const em          = page.entity_meta ?? {};

    const storyboardPage: StoryboardPage = {
      storyboard_id: buildStoryboardId(guideSuffix, index, type, entitySlug),
      index,
      type,
      template: page.template,
      section:  page.section ?? null,

      data: {
        titre:      page.titre ?? '',
        status:     page.status ?? '',
        url_source: page.url_source ?? null,
        content:    page.content,
      },

      layout: (page.layout as Record<string, unknown>) ?? {},
      source_page_id: page.id,
    };

    // Injecter les identifiants d'entité s'ils existent (pas de clés null/undefined)
    if (em.cluster_id)        storyboardPage.cluster_id        = em.cluster_id;
    if (em.cluster_name)      storyboardPage.cluster_name      = em.cluster_name;
    if (em.poi_id)            storyboardPage.poi_id            = em.poi_id;
    if (em.poi_name)          storyboardPage.poi_name          = em.poi_name;
    if (em.inspiration_id)    storyboardPage.inspiration_id    = em.inspiration_id;
    if (em.inspiration_title) storyboardPage.inspiration_title = em.inspiration_title;
    if (em.season)            storyboardPage.season            = em.season;

    return storyboardPage;
  });

  // ── 4. Calculer les stats par type ─────────────────────────────────────
  const byType: Record<string, number> = {};
  for (const p of pages) {
    byType[p.type] = (byType[p.type] ?? 0) + 1;
  }

  // ── 5. Construire le guide metadata ───────────────────────────────────
  const guideMeta: StoryboardMeta = {
    guide_id:           guideId,
    guide_name:         String(meta.guide_name         ?? ''),
    destination:        String(meta.destination        ?? ''),
    year:               meta.year,
    language:           String(meta.language           ?? 'fr'),
    version:            String(meta.version            ?? '1.0.0'),
    built_at:           new Date().toISOString(),
    source_exported_at: String(meta.exported_at        ?? meta.normalized_at ?? ''),
  };

  return {
    guide: guideMeta,
    pages,
    stats: {
      total_pages: pages.length,
      by_type:     byType,
    },
  };
}
