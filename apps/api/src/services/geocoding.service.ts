/**
 * Service de géolocalisation via Photon (photon.komoot.io)
 *
 * Photon est un moteur de recherche géographique basé sur OpenStreetMap,
 * plus souple que Nominatim pour les noms partiels ou accentués.
 * Retourne du GeoJSON (FeatureCollection).
 * Pas de rate limit strict — un délai poli de 300 ms est quand même appliqué.
 */

export interface GeocodingResult {
  lat: number;
  lon: number;
  display_name: string;
  place_id: number;
  importance: number;
}

/** Distance en kilomètres entre deux points GPS (formule de haversine). */
export function haversineDistanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371; // rayon terrestre moyen en km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface MapUrls {
  /** Google Maps — standard universel web, fonctionne sur tous les appareils */
  google_maps: string;
  /** OpenStreetMap — alternative libre, sans tracking */
  openstreetmap: string;
  /** URI geo: — ouvre l'app carte native sur mobile (non cliquable dans un navigateur desktop) */
  geo: string;
}

export interface GeocodingResolveResult {
  lat: number;
  lon: number;
  display_name: string;
  urls: MapUrls;
}

/** Résultat Photon enrichi pour place_identity. */
export interface PhotonPlaceMatch {
  lat: number;
  lon: number;
  name: string | null;
  display_name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  countrycode: string | null;
  osm_key: string | null;
  osm_value: string | null;
  osm_type: string | null;
  osm_id: number | null;
  type: string | null;
}

export interface GeocodingResolveWithIdentityResult extends GeocodingResolveResult {
  place_match: PhotonPlaceMatch;
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface GeocodingBias {
  countryCode?: string;
  bounds?: GeoBounds;
  destinationLabel?: string;
}

export interface GeocodingError {
  lieu: string;
  error: string;
}

export class GeocodingService {
  private readonly BASE_URL = 'https://photon.komoot.io/api/';
  private readonly RATE_LIMIT_MS = 300; // délai poli entre requêtes

  /**
   * Géolocalise un lieu unique via Photon.
   * @param nomLieu  Requête de recherche (peut inclure destination et pays)
   * @param _pays    Ignoré — le pays est inclus directement dans nomLieu
   */
  async geocodePlace(nomLieu: string, _pays: string): Promise<GeocodingResult | null> {
    const match = await this.geocodePhotonMatch(nomLieu);
    if (!match) return null;
    return {
      lat:          match.lat,
      lon:          match.lon,
      display_name: match.display_name,
      place_id:     match.osm_id ?? 0,
      importance:   1,
    };
  }

  /**
   * Géolocalise via Photon et retourne les propriétés OSM complètes.
   */
  async geocodePhotonMatch(nomLieu: string, bias?: GeocodingBias): Promise<PhotonPlaceMatch | null> {
    try {
      const params = new URLSearchParams({
        q:     nomLieu,
        limit: bias ? '8' : '1',
        lang:  'fr',
      });
      const url = `${this.BASE_URL}?${params.toString()}`;

      console.log(`🌍 Géolocalisation Photon: "${nomLieu}"`);

      const response = await fetch(url);

      if (!response.ok) {
        console.error(`❌ Erreur HTTP ${response.status} pour "${nomLieu}"`);
        return null;
      }

      const data: any = await response.json();
      const features: any[] = data?.features ?? [];

      if (features.length === 0) {
        console.warn(`⚠️ Aucun résultat Photon pour "${nomLieu}"`);
        return null;
      }

      const candidates = features
        .map((feature) => this.featureToPhotonMatch(feature, nomLieu))
        .filter((match): match is PhotonPlaceMatch => match !== null);

      if (candidates.length === 0) {
        console.error(`❌ Coordonnées invalides pour "${nomLieu}"`);
        return null;
      }

      const match = this.pickBestMatch(candidates, bias);
      if (!match) {
        const label = bias?.destinationLabel ? ` (${bias.destinationLabel})` : '';
        console.warn(`⚠️ Aucun résultat Photon dans la zone attendue${label} pour "${nomLieu}"`);
        return null;
      }

      console.log(`✅ Coordonnées trouvées: ${match.lat}, ${match.lon} (${match.display_name})`);

      return match;
    } catch (error: any) {
      console.error(`❌ Erreur géolocalisation "${nomLieu}":`, error.message);
      return null;
    }
  }

  private featureToPhotonMatch(feature: any, fallbackName: string): PhotonPlaceMatch | null {
    const [lon, lat] = feature.geometry?.coordinates ?? [];

    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
      return null;
    }

    const props = feature.properties ?? {};
    const displayName = [props.name, props.city, props.country]
      .filter(Boolean)
      .join(', ') || fallbackName;

    return {
      lat,
      lon,
      name:         props.name ?? null,
      display_name: displayName,
      city:         props.city ?? null,
      state:        props.state ?? null,
      country:      props.country ?? null,
      countrycode:  props.countrycode ?? null,
      osm_key:      props.osm_key ?? null,
      osm_value:    props.osm_value ?? null,
      osm_type:     props.osm_type ?? null,
      osm_id:       typeof props.osm_id === 'number' ? props.osm_id : null,
      type:         props.type ?? null,
    };
  }

  private pickBestMatch(
    candidates: PhotonPlaceMatch[],
    bias?: GeocodingBias
  ): PhotonPlaceMatch | null {
    if (!bias) return candidates[0] ?? null;

    const scored = candidates
      .map((match, index) => {
        let score = 100 - index;
        if (bias.countryCode && match.countrycode?.toUpperCase() === bias.countryCode.toUpperCase()) score += 80;
        if (bias.bounds && this.isInsideBounds(match, bias.bounds)) score += 160;
        return { match, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.match ?? null;
    if (!best) return null;

    if (bias.bounds && !this.isInsideBounds(best, bias.bounds)) return null;
    if (bias.countryCode && best.countrycode && best.countrycode.toUpperCase() !== bias.countryCode.toUpperCase()) {
      return null;
    }

    return best;
  }

  private isInsideBounds(match: PhotonPlaceMatch, bounds: GeoBounds): boolean {
    return (
      match.lat >= bounds.minLat &&
      match.lat <= bounds.maxLat &&
      match.lon >= bounds.minLon &&
      match.lon <= bounds.maxLon
    );
  }

  /**
   * Géolocalise plusieurs lieux avec délai poli entre requêtes.
   */
  async geocodePlaces(
    lieux: Array<{ nom: string; pays: string }>
  ): Promise<Map<string, GeocodingResult>> {
    const results = new Map<string, GeocodingResult>();
    const errors: GeocodingError[] = [];

    console.log(`🌍 Géolocalisation de ${lieux.length} lieu(x)...`);

    for (let i = 0; i < lieux.length; i++) {
      const lieu = lieux[i];
      try {
        const query = lieu.pays ? `${lieu.nom}, ${lieu.pays}` : lieu.nom;
        const result = await this.geocodePlace(query, '');
        if (result) {
          results.set(lieu.nom, result);
        } else {
          errors.push({ lieu: lieu.nom, error: 'Aucun résultat trouvé' });
        }
      } catch (error: any) {
        errors.push({ lieu: lieu.nom, error: error.message });
      }
      if (i < lieux.length - 1) await this.sleep(this.RATE_LIMIT_MS);
    }

    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} lieu(x) non géolocalisé(s):`, errors.map(e => e.lieu).join(', '));
    }
    console.log(`✅ ${results.size}/${lieux.length} lieu(x) géolocalisé(s)`);
    return results;
  }

  /**
   * Géolocalise un lieu et retourne ses coordonnées + URLs cartographiques.
   * Point d'entrée principal pour les routes API et les field services.
   *
   * @param query   Requête enrichie (ex: "Cathédrale de Santa Cruz, Tenerife, Spain")
   * @param country Pays optionnel — ajouté seulement s'il n'est pas déjà dans la query
   */
  async resolve(query: string, country?: string): Promise<GeocodingResolveResult | null> {
    const alreadyHasCountry = country && query.toLowerCase().includes(country.toLowerCase());
    const searchQuery = (country && !alreadyHasCountry) ? `${query}, ${country}` : query;

    const match = await this.geocodePhotonMatch(searchQuery);
    if (!match) return null;
    return {
      lat:          match.lat,
      lon:          match.lon,
      display_name: match.display_name,
      urls:         this.buildMapUrls(match.lat, match.lon, match.display_name),
    };
  }

  /**
   * Géolocalise et retourne le match Photon brut (pour enrichissement place_identity).
   */
  async resolveWithPlaceMatch(
    query: string,
    country?: string,
    bias?: GeocodingBias
  ): Promise<GeocodingResolveWithIdentityResult | null> {
    const alreadyHasCountry = country && query.toLowerCase().includes(country.toLowerCase());
    const searchQuery = (country && !alreadyHasCountry) ? `${query}, ${country}` : query;

    const match = await this.geocodePhotonMatch(searchQuery, bias);
    if (!match) return null;

    return {
      lat:          match.lat,
      lon:          match.lon,
      display_name: match.display_name,
      urls:         this.buildMapUrls(match.lat, match.lon, match.display_name),
      place_match:  match,
    };
  }

  /**
   * Construit les URLs cartographiques à partir de coordonnées GPS.
   *
   * Formats disponibles :
   *  - google_maps    : https://maps.google.com/?q=lat,lon  (référence universelle web)
   *  - openstreetmap  : https://www.openstreetmap.org/?mlat=...  (libre, sans tracking)
   *  - geo            : geo:lat,lon  (ouvre l'app carte native sur mobile)
   *
   * Pour un lien dans un guide print/PDF destiné au web, google_maps est recommandé.
   * Pour un QR code universel, geo: est le plus interopérable sur smartphone.
   */
  buildMapUrls(lat: number, lon: number, label?: string): MapUrls {
    const coords = `${lat},${lon}`;
    const encodedLabel = label ? encodeURIComponent(label) : coords;
    return {
      google_maps:   `https://maps.google.com/?q=${coords}`,
      openstreetmap: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=17&layers=M`,
      geo:           `geo:${coords}?q=${coords}(${encodedLabel})`,
    };
  }

  /**
   * Utilitaire : attendre X millisecondes
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extraire le pays depuis le nom de la destination
   * Exemple: "Tenerife" → "Spain", "Marrakech" → "Morocco"
   */
  getCountryFromDestination(destination: string): string {
    const destinationCountryMap: Record<string, string> = {
      // Canaries
      'tenerife': 'Spain',
      'gran canaria': 'Spain',
      'lanzarote': 'Spain',
      'fuerteventura': 'Spain',
      'la palma': 'Spain',
      'la gomera': 'Spain',
      'el hierro': 'Spain',
      
      // Maroc
      'marrakech': 'Morocco',
      'marrakesh': 'Morocco',
      'essaouira': 'Morocco',
      'agadir': 'Morocco',
      'fès': 'Morocco',
      'fez': 'Morocco',
      'tanger': 'Morocco',
      'tangier': 'Morocco',
      'casablanca': 'Morocco',
      'rabat': 'Morocco',
      'chefchaouen': 'Morocco',
      
      // Portugal
      'lisbonne': 'Portugal',
      'lisbon': 'Portugal',
      'porto': 'Portugal',
      'algarve': 'Portugal',
      'madère': 'Portugal',
      'madeira': 'Portugal',
      'açores': 'Portugal',
      'azores': 'Portugal',
    };

    const normalized = destination.toLowerCase().trim();
    
    // Recherche exacte
    if (destinationCountryMap[normalized]) {
      return destinationCountryMap[normalized];
    }

    // Recherche partielle
    for (const [key, country] of Object.entries(destinationCountryMap)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return country;
      }
    }

    // Défaut : essayer avec le nom brut
    return destination;
  }

  getBiasFromDestination(destination: string): GeocodingBias | undefined {
    const key = destination.toLowerCase().trim();
    if (key.includes('tenerife')) {
      return {
        countryCode: 'ES',
        destinationLabel: 'Tenerife',
        bounds: {
          minLat: 27.90,
          maxLat: 28.65,
          minLon: -16.95,
          maxLon: -16.05,
        },
      };
    }
    return undefined;
  }
}
