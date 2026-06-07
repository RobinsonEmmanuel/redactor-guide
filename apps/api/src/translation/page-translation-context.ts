import {
  resolveGuideDestination,
  resolvePlaceNamingProfile,
  type PlaceNamingProfile,
} from './place-naming-profiles.js';
import {
  resolveOsmNameForLang,
  type PlaceIdentity,
} from '../services/place-identity.service.js';
import { buildGenericToponymRules } from './place-name-generic-rules.js';

const DESCRIPTION_FIELD_CANDIDATES = [
  'POI_texte_1',
  'CLUSTER_texte_description',
  'INSPIRATION_texte_angle_editorial',
];

const DESCRIPTION_EXCERPT_MAX = 320;

export interface PageTranslationContext {
  destination: string;
  country: string;
  cluster_name: string | null;
  page_titre: string | null;
  page_type: string | null;
  template_name: string | null;
  poi_name: string | null;
  /** Nom local OSM / vernaculaire */
  local_name: string | null;
  /** Nom OSM officiel dans la langue cible (name:en, name:de…) */
  osm_name_target: string | null;
  /** Type de lieu OSM (church, beach, market…) */
  place_type: string | null;
  description_excerpt: string | null;
  naming_profile: PlaceNamingProfile;
  /** Noms OSM bruts (pour debug / validation) */
  osm_names: Record<string, string>;
}

/** Lit content.text si présent, sinon content plat (legacy). */
export function getPageTextContent(page: Record<string, unknown>): Record<string, unknown> {
  const content = (page.content ?? {}) as Record<string, unknown>;
  const nested = content.text;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return content;
}

function pickDescriptionExcerpt(textContent: Record<string, unknown>): string | null {
  for (const key of DESCRIPTION_FIELD_CANDIDATES) {
    const raw = textContent[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    if (trimmed.length <= DESCRIPTION_EXCERPT_MAX) return trimmed;
    return `${trimmed.slice(0, DESCRIPTION_EXCERPT_MAX).trim()}…`;
  }
  return null;
}

function readPlaceIdentity(page: Record<string, unknown>): PlaceIdentity | null {
  const pi = page.place_identity;
  if (!pi || typeof pi !== 'object') return null;
  return pi as PlaceIdentity;
}

export function buildPageTranslationContext(
  page: Record<string, unknown>,
  guide: Record<string, unknown> | null | undefined,
  targetLang?: string
): PageTranslationContext {
  const destination = resolveGuideDestination(guide);
  const naming_profile = resolvePlaceNamingProfile(destination);
  const metadata = (page.metadata ?? page.entity_meta ?? {}) as Record<string, unknown>;
  const textContent = getPageTextContent(page);
  const coordinates = page.coordinates as { display_name?: string } | null | undefined;
  const placeIdentity = readPlaceIdentity(page);
  const osm_names = placeIdentity?.osm_names ?? {};

  const poi_name =
    (metadata.poi_name as string | undefined) ??
    (page.entity_meta as Record<string, unknown> | undefined)?.poi_name as string | undefined ??
    null;

  const local_name =
    placeIdentity?.local_name?.trim() ||
    osm_names.default?.trim() ||
    (coordinates?.display_name?.trim()) ||
    (textContent.POI_titre_1 as string | undefined)?.trim() ||
    null;

  const osm_name_target = targetLang
    ? resolveOsmNameForLang(osm_names, targetLang)
    : null;

  return {
    destination,
    country: placeIdentity?.country?.trim() || naming_profile.country || destination,
    cluster_name:
      (metadata.cluster_name as string | undefined)?.trim() ||
      (page.section_name as string | undefined)?.trim() ||
      null,
    page_titre: (page.titre as string | undefined)?.trim() || null,
    page_type:
      (page.type_de_page as string | undefined)?.trim() ||
      (metadata.page_type as string | undefined)?.trim() ||
      null,
    template_name: (page.template_name as string | undefined)?.trim() || null,
    poi_name: poi_name?.trim() || null,
    local_name,
    osm_name_target,
    place_type: placeIdentity?.place_type?.trim() || null,
    description_excerpt: pickDescriptionExcerpt(textContent),
    naming_profile,
    osm_names,
  };
}

export function formatPageContextBlock(ctx: PageTranslationContext): string {
  const lines: string[] = [
    'Page context (use for disambiguation — do NOT translate this block):',
    `- Destination: ${ctx.destination || 'unknown'}${ctx.country ? `, ${ctx.country}` : ''}`,
    `- Vernacular language of the place: ${ctx.naming_profile.vernacular_lang}`,
  ];

  if (ctx.cluster_name) lines.push(`- Area / cluster: ${ctx.cluster_name}`);
  if (ctx.page_titre) lines.push(`- Editorial page title (FR): ${ctx.page_titre}`);
  if (ctx.poi_name) lines.push(`- POI reference name: ${ctx.poi_name}`);
  if (ctx.local_name) lines.push(`- OSM local / vernacular name: ${ctx.local_name}`);
  if (ctx.osm_name_target) lines.push(`- OSM official name (target language): ${ctx.osm_name_target}`);
  if (ctx.place_type) lines.push(`- Place type (OSM): ${ctx.place_type}`);
  if (ctx.page_type) lines.push(`- Page type: ${ctx.page_type}`);
  if (ctx.template_name) lines.push(`- Template: ${ctx.template_name}`);
  if (ctx.description_excerpt) {
    lines.push(`- Description excerpt (FR): ${ctx.description_excerpt}`);
  }

  return lines.join('\n');
}

export function buildPlaceNameNamingRules(
  langName: string,
  ctx: PageTranslationContext,
  targetLang: string
): string {
  const genericRules = buildGenericToponymRules(
    targetLang,
    ctx.naming_profile.vernacular_lang
  );

  const osmHint = ctx.osm_name_target
    ? `- OSM name in target language (reference for proper nouns): "${ctx.osm_name_target}" — apply the mandatory generic-word rule above; do NOT copy Spanish/French generics from OSM into ${langName} output`
    : ctx.local_name
      ? `- OSM local name (reference for proper nouns): "${ctx.local_name}" — translate generic words, keep this proper name`
      : '';

  return `
Place name localization rules (POI_titre and similar fields — tourist-facing toponyms):
- These values are PLACE NAMES for a travel guide, not sentences or marketing copy
- Target language: ${langName} (${targetLang})
- Destination vernacular: ${ctx.naming_profile.vernacular_lang}
${genericRules}
${osmHint}
- Translate the place TYPE, not the identity: Church, Museum, Market, Viewpoint, Natural Pools, Garden, Path/Trail are types; San Marcos Evangelista, Nuestra Señora de África, Punta de Teno, La Caleta de Adeje, Vilaflor de Chasna are proper-name identities
- Do NOT translate Spanish connectors/articles inside proper names ("de", "del", "de la", "La", "Los", "El") into "of/the" when they belong to the official name
- Never produce hybrid French/Spanish proper names such as "Notre-Dame de la Conception" for Spanish places; prefer the Spanish official form "Nuestra Señora de la Concepción" unless a well-established target-language name exists
- If the source label is only a street/local proper name but the context says the POI is a garden, viewpoint, market, etc., add the translated type around the unchanged proper name (e.g. "Garden of Calle de la Verdad")
- Do NOT drop any part of the name (keep qualifiers in parentheses, keep "La/Los/El" when part of the official proper name)
- Do NOT invent a different place, substitute a nearby landmark, or hallucinate a variant spelling
- Pure proper nouns without generic (La Caleta de Adeje, Charco Los Chochos) → keep official form, adjust only word order if natural in ${langName}
- Respect strict character limits (InDesign frame calibration)`;
}
