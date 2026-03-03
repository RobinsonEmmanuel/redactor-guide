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
    try {
      const params = new URLSearchParams({
        q:     nomLieu,
        limit: '1',
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

      const feature = features[0];
      // GeoJSON : coordinates = [longitude, latitude]
      const [lon, lat] = feature.geometry?.coordinates ?? [];

      if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
        console.error(`❌ Coordonnées invalides pour "${nomLieu}"`);
        return null;
      }

      const props = feature.properties ?? {};
      const displayName = [props.name, props.city, props.country]
        .filter(Boolean)
        .join(', ') || nomLieu;

      console.log(`✅ Coordonnées trouvées: ${lat}, ${lon} (${displayName})`);

      return {
        lat,
        lon,
        display_name: displayName,
        place_id:   props.osm_id  ?? 0,
        importance: props.extent  ? 1 : 0,
      };
    } catch (error: any) {
      console.error(`❌ Erreur géolocalisation "${nomLieu}":`, error.message);
      return null;
    }
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

    const result = await this.geocodePlace(searchQuery, '');
    if (!result) return null;
    return {
      lat:          result.lat,
      lon:          result.lon,
      display_name: result.display_name,
      urls:         this.buildMapUrls(result.lat, result.lon, result.display_name),
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
}
