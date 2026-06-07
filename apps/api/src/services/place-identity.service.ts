/**
 * Identité toponymique OSM — enrichissement au géocodage (phase 3).
 * Langue-neutre : osm_names alimente les 8 langues cibles à la traduction.
 */

import type { GeocodingBias, GeocodingService, PhotonPlaceMatch } from './geocoding.service.js';

/** Langues cibles du guide → clés OSM name:xx */
export const TARGET_LANG_TO_OSM: Record<string, string> = {
  fr:    'fr',
  en:    'en',
  de:    'de',
  it:    'it',
  es:    'es',
  'pt-pt': 'pt',
  nl:    'nl',
  da:    'da',
  sv:    'sv',
};

export interface PlaceIdentity {
  /** Nom local OSM (tag name / vernaculaire) */
  local_name: string | null;
  /** Libellé affiché complet (Photon display_name) */
  display_name: string | null;
  /** Type de lieu (osm_value ou type Photon) */
  place_type: string | null;
  osm_key: string | null;
  osm_value: string | null;
  osm_type: string | null;
  osm_id: number | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  /** Noms OSM indexés par code langue (en, de, es, default…) */
  osm_names: Record<string, string>;
  geocode_query: string | null;
  resolved_at: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_USER_AGENT = 'RedactorGuide/1.0 (poi-place-identity)';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extrait les tags name / name:xx depuis namedetails Nominatim. */
export function extractOsmNamesFromNamedetails(
  namedetails: Record<string, string> | undefined | null
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!namedetails) return out;

  for (const [key, raw] of Object.entries(namedetails)) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (key === 'name') {
      out.default = value;
    } else if (key.startsWith('name:')) {
      out[key.slice(5)] = value;
    }
  }
  return out;
}

/** Nom OSM dans la langue cible (ex. en → name:en). */
export function resolveOsmNameForLang(
  osmNames: Record<string, string> | undefined | null,
  targetLang: string
): string | null {
  if (!osmNames) return null;
  const osmKey = TARGET_LANG_TO_OSM[targetLang] ?? targetLang;
  const direct = osmNames[osmKey]?.trim();
  if (direct) return direct;
  const fallback = osmNames.default?.trim();
  return fallback || null;
}

async function nominatimFetch(path: string): Promise<any | null> {
  try {
    const response = await fetch(`${NOMINATIM_BASE}${path}`, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.warn(`⚠️ [OSM] Nominatim HTTP ${response.status} pour ${path}`);
      return null;
    }
    return await response.json();
  } catch (err: any) {
    console.warn(`⚠️ [OSM] Nominatim erreur:`, err.message);
    return null;
  }
}

/**
 * Récupère tous les tags name:* via lookup OSM (N/W/R + id).
 * Respecte la politique Nominatim : 1 req/s — l'appelant doit espacer les requêtes.
 */
export async function fetchOsmNamesByOsmId(
  osmType: string,
  osmId: number
): Promise<Record<string, string>> {
  const prefix = String(osmType || '').trim().charAt(0).toUpperCase();
  if (!prefix || !['N', 'W', 'R'].includes(prefix) || !osmId) return {};

  const data = await nominatimFetch(
    `/lookup?osm_ids=${prefix}${osmId}&format=json&namedetails=1`
  );
  const row = Array.isArray(data) ? data[0] : null;
  return extractOsmNamesFromNamedetails(row?.namedetails);
}

/**
 * Reverse geocoding Nominatim — pour POIs déjà coordonnés sans place_identity.
 */
export async function fetchOsmIdentityByCoordinates(
  lat: number,
  lon: number
): Promise<{ osm_names: Record<string, string>; match: Partial<PhotonPlaceMatch> }> {
  const data = await nominatimFetch(
    `/reverse?lat=${lat}&lon=${lon}&format=json&namedetails=1&addressdetails=1&zoom=18`
  );
  if (!data) return { osm_names: {}, match: {} };

  const addr = data.address ?? {};
  const match: Partial<PhotonPlaceMatch> = {
    lat,
    lon,
    name: data.name ?? data.display_name?.split(',')[0] ?? null,
    display_name: data.display_name ?? null,
    city: addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? null,
    state: addr.state ?? null,
    country: addr.country ?? null,
    countrycode: addr.country_code?.toUpperCase() ?? null,
    osm_type: data.osm_type?.charAt(0)?.toUpperCase() ?? null,
    osm_id: data.osm_id ?? null,
    osm_key: data.category ?? data.class ?? null,
    osm_value: data.type ?? null,
    type: data.type ?? null,
  };

  return {
    osm_names: extractOsmNamesFromNamedetails(data.namedetails),
    match,
  };
}

export function buildPlaceIdentity(
  match: PhotonPlaceMatch,
  osmNames: Record<string, string>,
  geocodeQuery: string | null
): PlaceIdentity {
  const localName =
    osmNames.default?.trim() ||
    match.name?.trim() ||
    null;

  return {
    local_name: localName,
    display_name: match.display_name?.trim() || localName,
    place_type: match.osm_value?.trim() || match.type?.trim() || null,
    osm_key: match.osm_key?.trim() || null,
    osm_value: match.osm_value?.trim() || null,
    osm_type: match.osm_type?.trim() || null,
    osm_id: match.osm_id ?? null,
    city: match.city?.trim() || null,
    country: match.country?.trim() || null,
    country_code: match.countrycode?.trim() || null,
    osm_names: osmNames,
    geocode_query: geocodeQuery,
    resolved_at: new Date().toISOString(),
  };
}

export function mergeOsmNames(
  primary: Record<string, string>,
  secondary: Record<string, string>
): Record<string, string> {
  return { ...secondary, ...primary };
}

const NOMINATIM_RATE_LIMIT_MS = 1100;

/** Pause polie entre appels Nominatim (max 1 req/s). */
export async function waitForNominatimRateLimit(): Promise<void> {
  await sleep(NOMINATIM_RATE_LIMIT_MS);
}

export interface PoiGeocodePersistPayload {
  coordinates: { lat: number; lon: number; display_name: string };
  place_identity: PlaceIdentity;
}

/**
 * Géocode une requête (Photon) + enrichit les noms OSM multilingues (Nominatim).
 */
export async function buildPlaceIdentityFromGeocodeQuery(
  geocodingService: GeocodingService,
  query: string,
  country?: string,
  bias?: GeocodingBias
): Promise<PoiGeocodePersistPayload | null> {
  const resolved = await geocodingService.resolveWithPlaceMatch(query, country, bias);
  if (!resolved) return null;

  let osmNames: Record<string, string> = {};
  const { osm_type, osm_id } = resolved.place_match;
  if (osm_type && osm_id) {
    osmNames = await fetchOsmNamesByOsmId(osm_type, osm_id);
    await waitForNominatimRateLimit();
  }

  const place_identity = buildPlaceIdentity(resolved.place_match, osmNames, query);

  return {
    coordinates: {
      lat: resolved.lat,
      lon: resolved.lon,
      display_name: resolved.display_name,
    },
    place_identity,
  };
}

/**
 * Enrichit place_identity depuis des coordonnées existantes (reverse Nominatim).
 */
export async function buildPlaceIdentityFromCoordinates(
  lat: number,
  lon: number,
  geocodeQuery: string | null = null
): Promise<PlaceIdentity | null> {
  const { osm_names, match } = await fetchOsmIdentityByCoordinates(lat, lon);
  await waitForNominatimRateLimit();

  const photonMatch: PhotonPlaceMatch = {
    lat,
    lon,
    name: match.name ?? null,
    display_name: match.display_name ?? `${lat}, ${lon}`,
    city: match.city ?? null,
    state: match.state ?? null,
    country: match.country ?? null,
    countrycode: match.countrycode ?? null,
    osm_key: match.osm_key ?? null,
    osm_value: match.osm_value ?? null,
    osm_type: match.osm_type ?? null,
    osm_id: match.osm_id ?? null,
    type: match.type ?? null,
  };

  if (!photonMatch.name && Object.keys(osm_names).length === 0) return null;

  return buildPlaceIdentity(photonMatch, osm_names, geocodeQuery);
}
