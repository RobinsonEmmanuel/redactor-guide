import { Db, ObjectId } from 'mongodb';
import { COLLECTIONS } from '../config/collections.js';
import { GeocodingService } from './geocoding.service.js';
import {
  buildPlaceIdentityFromCoordinates,
  buildPlaceIdentityFromGeocodeQuery,
  type PlaceIdentity,
} from './place-identity.service.js';

const PHOTON_RATE_LIMIT_MS = 300;

export interface PoiGeocodeEntryResult {
  page_id: string;
  titre: string;
  status: 'geocoded' | 'failed' | 'skipped' | 'enriched';
  query?: string;
  coordinates?: { lat: number; lon: number; display_name: string };
  error?: string;
}

export interface GeocodeMissingPoisResult {
  total_pois: number;
  missing_before: number;
  geocoded: number;
  failed: number;
  already_had_coords: number;
  /** POIs déjà coordonnés enrichis avec place_identity OSM */
  identities_enriched: number;
  results: PoiGeocodeEntryResult[];
}

export interface RegeocodePoiResult {
  page_id: string;
  titre: string;
  query: string;
  coordinates: { lat: number; lon: number; display_name: string };
  place_identity: PlaceIdentity;
}

export interface PoiMissingCoordinatesEntry {
  page_id: string;
  titre: string;
  query: string | null;
  error: string | null;
}

export type PoiGeocodeQualityStatus = 'ok' | 'missing' | 'out_of_scope' | 'no_gps';

export interface PoiGeocodeQualityEntry {
  page_id: string;
  titre: string;
  ordre: number | null;
  cluster_name: string | null;
  query: string | null;
  status: PoiGeocodeQualityStatus;
  issue: string | null;
  coordinates: { lat: number; lon: number; display_name?: string | null } | null;
  gps_not_applicable: boolean;
  place_identity: PlaceIdentity | null;
}

export interface PoiGeocodeQualityReport {
  destination: string;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
  stats: {
    total: number;
    ok: number;
    missing: number;
    out_of_scope: number;
    no_gps: number;
  };
  pois: PoiGeocodeQualityEntry[];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Construit la requête Photon pour un POI (même logique que geocoding_maps_link).
 */
export function buildPoiGeocodingQuery(
  page: Record<string, any>,
  guide: Record<string, any>,
  queryField?: string | null
): string {
  let query: string =
    page.entity_meta?.poi_name ||
    page.titre ||
    '';

  if (queryField) {
    const fromContent =
      page.content?.text?.[queryField] ??
      page.content?.[queryField];
    if (fromContent) query = String(fromContent);
  } else {
    const poiTitre =
      page.content?.text?.POI_titre_1 ??
      page.content?.POI_titre_1;
    if (poiTitre) query = String(poiTitre);
  }

  const destination: string =
    guide.destination ??
    guide.destinations?.[0] ??
    guide.name ??
    '';
  const clusterName: string =
    page.metadata?.cluster_name?.trim() ??
    page.section_name?.trim() ??
    '';

  if (clusterName && destination) return `${query}, ${clusterName}, ${destination}`;
  if (destination) return `${query}, ${destination}`;
  return query;
}

function hasCoordinates(page: Record<string, any>): boolean {
  const c = page.coordinates;
  return c?.lat != null && c?.lon != null && !isNaN(c.lat) && !isNaN(c.lon);
}

function hasPlaceIdentity(page: Record<string, any>): boolean {
  const pi = page.place_identity as PlaceIdentity | undefined;
  return !!(pi?.local_name || (pi?.osm_names && Object.keys(pi.osm_names).length > 0));
}

function isGpsNotApplicable(page: Record<string, any>): boolean {
  return page.gps_not_applicable === true;
}

function isPoiGeocodeResolved(page: Record<string, any>): boolean {
  return hasCoordinates(page) || isGpsNotApplicable(page);
}

function getGuideDestination(guide: Record<string, any>): string {
  return guide.destination ?? guide.destinations?.[0] ?? guide.name ?? '';
}

function isInsideBounds(
  coordinates: { lat: number; lon: number },
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): boolean {
  return (
    coordinates.lat >= bounds.minLat &&
    coordinates.lat <= bounds.maxLat &&
    coordinates.lon >= bounds.minLon &&
    coordinates.lon <= bounds.maxLon
  );
}

async function loadGuidePoiPages(db: Db, guideId: string) {
  if (!ObjectId.isValid(guideId)) {
    throw new Error('guideId invalide');
  }

  const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
  if (!guide) throw new Error('Guide non trouvé');

  const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
  if (!cheminDeFer) throw new Error('Chemin de fer non trouvé pour ce guide');

  const pages = await db
    .collection(COLLECTIONS.pages)
    .find({
      chemin_de_fer_id: cheminDeFer._id.toString(),
      $or: [{ type_de_page: 'poi' }, { 'metadata.page_type': 'poi' }],
    })
    .sort({ ordre: 1 })
    .toArray();

  return { guide, pages };
}

/** Persiste coordonnées + identité OSM sur une page POI. */
export async function persistPoiGeocodeResult(
  db: Db,
  pageId: string,
  payload: {
    coordinates: { lat: number; lon: number; display_name: string };
    place_identity: PlaceIdentity;
    onlyIfMissingCoords?: boolean;
  }
): Promise<void> {
  if (!ObjectId.isValid(pageId)) return;

  const filter: Record<string, unknown> = { _id: new ObjectId(pageId) };
  if (payload.onlyIfMissingCoords) {
    filter.$or = [
      { coordinates: { $exists: false } },
      { coordinates: null },
      { 'coordinates.lat': { $exists: false } },
      { 'coordinates.lon': { $exists: false } },
    ];
  }

  await db.collection(COLLECTIONS.pages).updateOne(
    filter,
    {
      $set: {
        coordinates: payload.coordinates,
        place_identity: payload.place_identity,
        gps_not_applicable: false,
        updated_at: new Date().toISOString(),
      },
    }
  );
}

/** Persiste uniquement place_identity (POI déjà coordonné). */
export async function persistPlaceIdentity(
  db: Db,
  pageId: string,
  place_identity: PlaceIdentity
): Promise<void> {
  if (!ObjectId.isValid(pageId)) return;

  await db.collection(COLLECTIONS.pages).updateOne(
    { _id: new ObjectId(pageId) },
    {
      $set: {
        place_identity,
        updated_at: new Date().toISOString(),
      },
    }
  );
}

/** Liste les POIs sans coordonnées GPS (pour alertes export). */
export async function listPoisMissingCoordinates(
  db: Db,
  guideId: string
): Promise<PoiMissingCoordinatesEntry[]> {
  const { guide, pages } = await loadGuidePoiPages(db, guideId);
  const missing: PoiMissingCoordinatesEntry[] = [];

  for (const page of pages) {
    if (isPoiGeocodeResolved(page)) continue;
    const pageId = page._id.toString();
    const titre = String(page.titre ?? page.template_name ?? pageId);
    const query = buildPoiGeocodingQuery(page, guide).trim() || null;
    missing.push({
      page_id: pageId,
      titre,
      query,
      error: query ? 'Coordonnées GPS manquantes' : 'Nom du lieu introuvable',
    });
  }

  return missing;
}

/** Rapport complet pour contrôler les coordonnées déjà présentes. */
export async function getPoiGeocodeQualityReport(
  db: Db,
  guideId: string,
  geocodingService: GeocodingService
): Promise<PoiGeocodeQualityReport> {
  const { guide, pages } = await loadGuidePoiPages(db, guideId);
  const destination = getGuideDestination(guide);
  const bias = destination ? geocodingService.getBiasFromDestination(destination) : undefined;
  const bounds = bias?.bounds ?? null;

  const pois: PoiGeocodeQualityEntry[] = pages.map((page) => {
    const pageId = page._id.toString();
    const titre = String(page.titre ?? page.template_name ?? pageId);
    const query = buildPoiGeocodingQuery(page, guide).trim() || null;
    const gpsNotApplicable = isGpsNotApplicable(page);
    const rawCoords = page.coordinates;
    const coordinates = hasCoordinates(page)
      ? {
          lat: Number(rawCoords.lat),
          lon: Number(rawCoords.lon),
          display_name: rawCoords.display_name ?? null,
        }
      : null;

    let status: PoiGeocodeQualityStatus = 'ok';
    let issue: string | null = null;

    if (gpsNotApplicable) {
      status = 'no_gps';
      issue = 'POI volontairement sans point GPS';
    } else if (!coordinates) {
      status = 'missing';
      issue = 'Coordonnées GPS manquantes';
    } else if (bounds && !isInsideBounds(coordinates, bounds)) {
      status = 'out_of_scope';
      issue = `Coordonnées hors zone ${bias?.destinationLabel ?? destination}`;
    }

    return {
      page_id: pageId,
      titre,
      ordre: typeof page.ordre === 'number' ? page.ordre : null,
      cluster_name: page.metadata?.cluster_name ?? page.section_name ?? null,
      query,
      status,
      issue,
      coordinates,
      gps_not_applicable: gpsNotApplicable,
      place_identity: page.place_identity ?? null,
    };
  });

  const stats = {
    total: pois.length,
    ok: pois.filter((p) => p.status === 'ok').length,
    missing: pois.filter((p) => p.status === 'missing').length,
    out_of_scope: pois.filter((p) => p.status === 'out_of_scope').length,
    no_gps: pois.filter((p) => p.status === 'no_gps').length,
  };

  return { destination, bounds, stats, pois };
}

/** Regéocode un seul POI, même s'il possède déjà des coordonnées. */
export async function regeocodePoiPage(
  db: Db,
  guideId: string,
  pageId: string,
  geocodingService: GeocodingService
): Promise<RegeocodePoiResult> {
  const { guide, pages } = await loadGuidePoiPages(db, guideId);
  const page = pages.find((p) => p._id.toString() === pageId);
  if (!page) throw new Error('Page POI non trouvée');

  const destination = getGuideDestination(guide);
  const country = destination ? geocodingService.getCountryFromDestination(destination) : undefined;
  const geoBias = destination ? geocodingService.getBiasFromDestination(destination) : undefined;
  const query = buildPoiGeocodingQuery(page, guide).trim();
  if (!query) throw new Error('Nom du lieu introuvable');

  const payload = await buildPlaceIdentityFromGeocodeQuery(
    geocodingService,
    query,
    country,
    geoBias
  );
  if (!payload) {
    throw new Error(
      geoBias?.destinationLabel
        ? `Aucun résultat Photon dans le périmètre ${geoBias.destinationLabel}`
        : 'Aucun résultat Photon'
    );
  }

  await persistPoiGeocodeResult(db, pageId, payload);

  return {
    page_id: pageId,
    titre: String(page.titre ?? page.template_name ?? pageId),
    query,
    coordinates: payload.coordinates,
    place_identity: payload.place_identity,
  };
}

/**
 * Enrichit place_identity pour les POIs coordonnés qui n'en ont pas encore.
 */
export async function enrichMissingPlaceIdentities(
  db: Db,
  guideId: string
): Promise<number> {
  const { guide, pages } = await loadGuidePoiPages(db, guideId);
  let enriched = 0;

  for (const page of pages) {
    if (!hasCoordinates(page) || hasPlaceIdentity(page)) continue;

    const c = page.coordinates;
    const query = buildPoiGeocodingQuery(page, guide).trim() || null;
    const place_identity = await buildPlaceIdentityFromCoordinates(
      c.lat,
      c.lon,
      query
    );

    if (!place_identity) continue;

    await persistPlaceIdentity(db, page._id.toString(), place_identity);
    enriched++;
    console.log(`🏷️ [PLACE-IDENTITY] Enrichi ${page.titre ?? page._id} → ${place_identity.local_name}`);
  }

  return enriched;
}

/**
 * Géocode via Photon les pages POI sans coordonnées, enrichit place_identity OSM,
 * puis backfill les POIs déjà coordonnés sans identité.
 */
export async function geocodeMissingPoiPages(
  db: Db,
  guideId: string,
  geocodingService: GeocodingService
): Promise<GeocodeMissingPoisResult> {
  const { guide, pages } = await loadGuidePoiPages(db, guideId);

  const destination = getGuideDestination(guide);
  const country = destination
    ? geocodingService.getCountryFromDestination(destination)
    : undefined;
  const geoBias = destination
    ? geocodingService.getBiasFromDestination(destination)
    : undefined;

  const results: PoiGeocodeEntryResult[] = [];
  let missingBefore = 0;
  let geocoded = 0;
  let failed = 0;
  let alreadyHadCoords = 0;

  console.log(`🌍 [GEOCODE-MISSING] Guide ${guideId} — ${pages.length} POI(s) à analyser`);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageId = page._id.toString();
    const titre = String(page.titre ?? page.template_name ?? pageId);

    if (hasCoordinates(page)) {
      alreadyHadCoords++;
      results.push({ page_id: pageId, titre, status: 'skipped' });
      continue;
    }

    if (isGpsNotApplicable(page)) {
      alreadyHadCoords++;
      results.push({ page_id: pageId, titre, status: 'skipped' });
      continue;
    }

    missingBefore++;
    const query = buildPoiGeocodingQuery(page, guide).trim();

    if (!query) {
      failed++;
      results.push({
        page_id: pageId,
        titre,
        status: 'failed',
        error: 'Nom du lieu introuvable',
      });
      continue;
    }

    const payload = await buildPlaceIdentityFromGeocodeQuery(geocodingService, query, country, geoBias);

    if (!payload) {
      failed++;
      results.push({
        page_id: pageId,
        titre,
        status: 'failed',
        query,
        error: 'Aucun résultat Photon',
      });
      if (i < pages.length - 1) await sleep(PHOTON_RATE_LIMIT_MS);
      continue;
    }

    await db.collection(COLLECTIONS.pages).updateOne(
      { _id: page._id },
      {
        $set: {
          coordinates: payload.coordinates,
          place_identity: payload.place_identity,
          gps_not_applicable: false,
          updated_at: new Date().toISOString(),
        },
      }
    );

    geocoded++;
    results.push({
      page_id: pageId,
      titre,
      status: 'geocoded',
      query,
      coordinates: payload.coordinates,
    });

    console.log(
      `✅ [GEOCODE-MISSING] ${titre} → ${payload.coordinates.lat}, ${payload.coordinates.lon}` +
      (payload.place_identity.local_name ? ` (${payload.place_identity.local_name})` : '')
    );

    if (i < pages.length - 1) await sleep(PHOTON_RATE_LIMIT_MS);
  }

  const identities_enriched = await enrichMissingPlaceIdentities(db, guideId);
  if (identities_enriched > 0) {
    console.log(`🏷️ [PLACE-IDENTITY] ${identities_enriched} identité(s) OSM enrichie(s) (backfill)`);
  }

  console.log(
    `📍 [GEOCODE-MISSING] Terminé : ${geocoded} géolocalisé(s), ${failed} échec(s), ` +
    `${alreadyHadCoords} déjà OK, ${identities_enriched} identité(s) enrichie(s)`
  );

  return {
    total_pois: pages.length,
    missing_before: missingBefore,
    geocoded,
    failed,
    already_had_coords: alreadyHadCoords,
    identities_enriched,
    results,
  };
}

/**
 * @deprecated Utiliser persistPoiGeocodeResult — conservé pour compatibilité field service.
 */
export async function persistPoiCoordinatesIfMissing(
  db: Db,
  pageId: string,
  coordinates: { lat: number; lon: number; display_name: string }
): Promise<void> {
  if (!ObjectId.isValid(pageId)) return;

  await db.collection(COLLECTIONS.pages).updateOne(
    {
      _id: new ObjectId(pageId),
      $or: [
        { coordinates: { $exists: false } },
        { coordinates: null },
        { 'coordinates.lat': { $exists: false } },
        { 'coordinates.lon': { $exists: false } },
      ],
    },
    { $set: { coordinates, updated_at: new Date().toISOString() } }
  );
}
