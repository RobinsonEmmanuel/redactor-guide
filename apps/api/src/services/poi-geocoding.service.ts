import { Db, ObjectId } from 'mongodb';
import { COLLECTIONS } from '../config/collections.js';
import { GeocodingService } from './geocoding.service.js';

const RATE_LIMIT_MS = 300;

export interface PoiGeocodeEntryResult {
  page_id: string;
  titre: string;
  status: 'geocoded' | 'failed' | 'skipped';
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
  results: PoiGeocodeEntryResult[];
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

/**
 * Géocode via Photon les pages POI sans coordonnées et persiste le résultat en base.
 */
export async function geocodeMissingPoiPages(
  db: Db,
  guideId: string,
  geocodingService: GeocodingService
): Promise<GeocodeMissingPoisResult> {
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

  const destination: string =
    guide.destination ??
    guide.destinations?.[0] ??
    guide.name ??
    '';
  const country = destination
    ? geocodingService.getCountryFromDestination(destination)
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

    const resolved = await geocodingService.resolve(query, country);

    if (!resolved) {
      failed++;
      results.push({
        page_id: pageId,
        titre,
        status: 'failed',
        query,
        error: 'Aucun résultat Photon',
      });
      if (i < pages.length - 1) await sleep(RATE_LIMIT_MS);
      continue;
    }

    const coordinates = {
      lat: resolved.lat,
      lon: resolved.lon,
      display_name: resolved.display_name,
    };

    await db.collection(COLLECTIONS.pages).updateOne(
      { _id: page._id },
      { $set: { coordinates, updated_at: new Date().toISOString() } }
    );

    geocoded++;
    results.push({
      page_id: pageId,
      titre,
      status: 'geocoded',
      query,
      coordinates,
    });

    console.log(`✅ [GEOCODE-MISSING] ${titre} → ${resolved.lat}, ${resolved.lon}`);

    if (i < pages.length - 1) await sleep(RATE_LIMIT_MS);
  }

  console.log(
    `📍 [GEOCODE-MISSING] Terminé : ${geocoded} géolocalisé(s), ${failed} échec(s), ${alreadyHadCoords} déjà OK`
  );

  return {
    total_pois: pages.length,
    missing_before: missingBefore,
    geocoded,
    failed,
    already_had_coords: alreadyHadCoords,
    results,
  };
}

/**
 * Persiste les coordonnées sur une page POI si elle n'en a pas encore.
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
