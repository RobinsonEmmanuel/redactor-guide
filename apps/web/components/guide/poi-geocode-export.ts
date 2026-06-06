export interface PoiGeocodeFailure {
  page_id: string;
  titre: string;
  query?: string | null;
  error?: string | null;
}

export type PendingGeoExport =
  | { kind: 'geojson'; lang: string }
  | { kind: 'zip'; lang: string }
  | { kind: 'package'; lang: string };

export async function fetchPoiGeocodeFailures(
  apiUrl: string,
  guideId: string
): Promise<PoiGeocodeFailure[]> {
  const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/poi-geocode-status`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.missing ?? [];
}

export async function runAutoGeocodeMissingPois(
  apiUrl: string,
  guideId: string
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/geocode-missing-pois`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
}

/** Géocodage auto puis retourne les POIs encore sans coordonnées. */
export async function ensurePoiGeocodeReady(
  apiUrl: string,
  guideId: string
): Promise<PoiGeocodeFailure[]> {
  await runAutoGeocodeMissingPois(apiUrl, guideId);
  const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/poi-geocode-status`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Impossible de vérifier les coordonnées GPS');
  const data = await res.json();
  return data.missing ?? [];
}
