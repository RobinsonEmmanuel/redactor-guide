/**
 * Profils de nommage toponymique par destination.
 * Langue-neutre : consommés par les 8 langues cibles via le même moteur de localisation.
 */

export type PlaceNamingPolicy = 'vernacular_proper_nouns';

export interface PlaceNamingProfile {
  /** Langue vernaculaire locale (ex. es pour Canaries) */
  vernacular_lang: string;
  /** Pays pour le contexte géographique */
  country: string;
  /** Politique de conservation des noms propres locaux */
  naming_policy: PlaceNamingPolicy;
}

/** Correspondance destination → profil (clés normalisées lowercase). */
const DESTINATION_PROFILES: Record<string, PlaceNamingProfile> = {
  tenerife:       { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  'gran canaria': { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  lanzarote:      { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  fuerteventura:  { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  'la palma':     { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  'la gomera':    { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  'el hierro':    { vernacular_lang: 'es', country: 'Spain',       naming_policy: 'vernacular_proper_nouns' },
  marrakech:      { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  marrakesh:      { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  essaouira:      { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  agadir:         { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  fès:            { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  fez:            { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  tanger:         { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  tangier:        { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  casablanca:     { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  rabat:          { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  chefchaouen:    { vernacular_lang: 'ar', country: 'Morocco',     naming_policy: 'vernacular_proper_nouns' },
  lisbonne:       { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  lisbon:         { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  porto:          { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  algarve:        { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  madère:         { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  madeira:        { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  açores:         { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
  azores:         { vernacular_lang: 'pt', country: 'Portugal',    naming_policy: 'vernacular_proper_nouns' },
};

const DEFAULT_PROFILE: PlaceNamingProfile = {
  vernacular_lang: 'local',
  country: '',
  naming_policy: 'vernacular_proper_nouns',
};

function normalizeDestinationKey(destination: string): string {
  return destination.toLowerCase().trim();
}

/**
 * Résout le profil toponymique à partir du nom de destination du guide.
 */
export function resolvePlaceNamingProfile(destination: string): PlaceNamingProfile {
  const key = normalizeDestinationKey(destination);
  if (DESTINATION_PROFILES[key]) return DESTINATION_PROFILES[key];

  for (const [profileKey, profile] of Object.entries(DESTINATION_PROFILES)) {
    if (key.includes(profileKey) || profileKey.includes(key)) return profile;
  }

  return { ...DEFAULT_PROFILE, country: destination.trim() };
}

/**
 * Extrait la destination principale d'un document guide MongoDB.
 */
export function resolveGuideDestination(guide: Record<string, unknown> | null | undefined): string {
  if (!guide) return '';
  const destinations = guide.destinations;
  const firstDest = Array.isArray(destinations) && destinations.length > 0
    ? destinations[0]
    : undefined;
  const dest = guide.destination ?? firstDest ?? guide.name ?? '';
  return String(dest).trim();
}
