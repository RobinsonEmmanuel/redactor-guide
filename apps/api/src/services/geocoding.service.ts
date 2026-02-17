/**
 * Service de géolocalisation via Nominatim (OpenStreetMap)
 * 
 * Permet de récupérer les coordonnées GPS d'un lieu à partir de son nom
 */

export interface GeocodingResult {
  lat: number;
  lon: number;
  display_name: string;
  place_id: number;
  importance: number;
}

export interface GeocodingError {
  lieu: string;
  error: string;
}

export class GeocodingService {
  private readonly BASE_URL = 'https://nominatim.openstreetmap.org/search';
  private readonly USER_AGENT = 'RegionLovers-Recensement/1.0';
  private readonly RATE_LIMIT_MS = 1000; // 1 requête/seconde

  /**
   * Géolocalise un lieu unique
   */
  async geocodePlace(nomLieu: string, pays: string): Promise<GeocodingResult | null> {
    try {
      const query = `${nomLieu}, ${pays}`;
      const url = `${this.BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

      console.log(`🌍 Géolocalisation: "${query}"`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.USER_AGENT,
        },
      });

      if (!response.ok) {
        console.error(`❌ Erreur HTTP ${response.status} pour "${query}"`);
        return null;
      }

      const data: any = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        if (isNaN(lat) || isNaN(lon)) {
          console.error(`❌ Coordonnées invalides pour "${query}"`);
          return null;
        }

        console.log(`✅ Coordonnées trouvées: ${lat}, ${lon}`);

        return {
          lat,
          lon,
          display_name: result.display_name || query,
          place_id: result.place_id || 0,
          importance: result.importance || 0,
        };
      }

      console.warn(`⚠️ Aucun résultat pour "${query}"`);
      return null;
    } catch (error: any) {
      console.error(`❌ Erreur géolocalisation "${nomLieu}":`, error.message);
      return null;
    }
  }

  /**
   * Géolocalise plusieurs lieux avec rate limiting
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
        const result = await this.geocodePlace(lieu.nom, lieu.pays);
        
        if (result) {
          results.set(lieu.nom, result);
        } else {
          errors.push({
            lieu: lieu.nom,
            error: 'Aucun résultat trouvé',
          });
        }
      } catch (error: any) {
        errors.push({
          lieu: lieu.nom,
          error: error.message,
        });
      }

      // Rate limiting : attendre 1 seconde entre chaque requête (sauf pour la dernière)
      if (i < lieux.length - 1) {
        await this.sleep(this.RATE_LIMIT_MS);
      }
    }

    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} lieu(x) non géolocalisé(s):`, errors.map(e => e.lieu).join(', '));
    }

    console.log(`✅ ${results.size}/${lieux.length} lieu(x) géolocalisé(s)`);

    return results;
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
