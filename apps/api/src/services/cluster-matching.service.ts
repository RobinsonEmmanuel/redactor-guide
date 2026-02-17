/**
 * Service de matching entre POIs (détectés dans les articles WordPress)
 * et place_instances Region Lovers (contenus dans des clusters)
 * 
 * Utilise un algorithme de similarité de chaînes pour proposer des correspondances
 */

export interface POI {
  poi_id: string;
  nom: string;
  type: string;
  article_source: string;
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}

/**
 * Représente un draft (place_instance) avec son cluster associé
 */
export interface PlaceInstance {
  place_instance_id: string;
  place_name: string;
  place_type: string;
  cluster_id: string;
  cluster_name: string;
}

export interface MatchSuggestion {
  place_instance: PlaceInstance;
  score: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface POIWithMatch {
  poi: POI;
  current_cluster_id: string | 'unassigned';
  place_instance_id?: string;
  suggested_match?: MatchSuggestion;
  matched_automatically: boolean;
}

export interface ClusterAssignment {
  unassigned: POIWithMatch[];
  clusters: Record<string, POIWithMatch[]>;
}

export class ClusterMatchingService {
  // Seuils de confiance
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.90;
  private readonly AUTO_MATCH_THRESHOLD = 0.60;
  private readonly MIN_SUGGESTION_THRESHOLD = 0.30;

  /**
   * Normalise une chaîne pour la comparaison
   */
  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD') // Décompose les caractères accentués
      .replace(/[\u0300-\u036f]/g, '') // Retire les accents
      .replace(/[^a-z0-9\s]/g, '') // Garde uniquement lettres, chiffres et espaces
      .replace(/\s+/g, ' ') // Normalise les espaces multiples
      .trim();
  }

  /**
   * Calcule la distance de Levenshtein entre deux chaînes
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    // Initialiser la matrice
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Remplir la matrice
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // Suppression
          matrix[i][j - 1] + 1, // Insertion
          matrix[i - 1][j - 1] + cost // Substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Calcule le score de similarité entre deux chaînes (0-1)
   */
  calculateSimilarity(str1: string, str2: string): number {
    const norm1 = this.normalizeString(str1);
    const norm2 = this.normalizeString(str2);

    // Cas 1: Match exact
    if (norm1 === norm2) {
      return 1.0;
    }

    // Cas 2: L'un contient l'autre
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const shorterLen = Math.min(norm1.length, norm2.length);
      const longerLen = Math.max(norm1.length, norm2.length);
      return 0.85 + (shorterLen / longerLen) * 0.10; // 0.85 - 0.95
    }

    // Cas 3: Distance de Levenshtein
    const distance = this.levenshteinDistance(norm1, norm2);
    const maxLen = Math.max(norm1.length, norm2.length);
    
    if (maxLen === 0) return 0;
    
    const similarity = 1 - (distance / maxLen);
    
    return Math.max(0, similarity);
  }

  /**
   * Trouve la meilleure place_instance pour un POI donné
   */
  findBestMatch(poi: POI, placeInstances: PlaceInstance[]): MatchSuggestion | null {
    let bestMatch: MatchSuggestion | null = null;
    let bestScore = 0;

    for (const placeInstance of placeInstances) {
      const score = this.calculateSimilarity(poi.nom, placeInstance.place_name);

      if (score > bestScore && score >= this.MIN_SUGGESTION_THRESHOLD) {
        bestScore = score;
        bestMatch = {
          place_instance: placeInstance,
          score,
          confidence: this.getConfidenceLevel(score),
        };
      }
    }

    return bestMatch;
  }

  /**
   * Détermine le niveau de confiance selon le score
   */
  private getConfidenceLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= this.HIGH_CONFIDENCE_THRESHOLD) return 'high';
    if (score >= 0.75) return 'medium';
    return 'low';
  }

  /**
   * Assigne automatiquement les POIs aux clusters via les place_instances
   * 
   * Logique:
   * - Score >= 60% : Affectation automatique au cluster de la place_instance matchée
   * - Score < 60% : Reste dans "Non affectés"
   */
  autoAssignPOIs(pois: POI[], placeInstances: PlaceInstance[]): ClusterAssignment {
    const assignment: ClusterAssignment = {
      unassigned: [],
      clusters: {},
    };

    // Extraire la liste unique des clusters
    const uniqueClusterIds = [...new Set(placeInstances.map(pi => pi.cluster_id))];
    
    // Initialiser les colonnes de clusters
    for (const clusterId of uniqueClusterIds) {
      assignment.clusters[clusterId] = [];
    }

    console.log(`🎯 Auto-matching de ${pois.length} POI(s) avec ${placeInstances.length} place_instance(s) répartis dans ${uniqueClusterIds.length} cluster(s)...`);

    let autoMatchedCount = 0;

    for (const poi of pois) {
      const bestMatch = this.findBestMatch(poi, placeInstances);

      if (bestMatch && bestMatch.score >= this.AUTO_MATCH_THRESHOLD) {
        // Affecter automatiquement au cluster de la place_instance
        const clusterId = bestMatch.place_instance.cluster_id;
        assignment.clusters[clusterId].push({
          poi,
          current_cluster_id: clusterId,
          place_instance_id: bestMatch.place_instance.place_instance_id,
          suggested_match: bestMatch,
          matched_automatically: true,
        });
        autoMatchedCount++;
        console.log(`  ✅ "${poi.nom}" → "${bestMatch.place_instance.place_name}" dans cluster "${bestMatch.place_instance.cluster_name}" (${(bestMatch.score * 100).toFixed(0)}%)`);
      } else {
        // Rester dans "Non affectés"
        assignment.unassigned.push({
          poi,
          current_cluster_id: 'unassigned',
          suggested_match: bestMatch || undefined,
          matched_automatically: false,
        });
        if (bestMatch) {
          console.log(`  ⚠️ "${poi.nom}" → Non affecté (meilleur: "${bestMatch.place_instance.place_name}" ${(bestMatch.score * 100).toFixed(0)}%)`);
        } else {
          console.log(`  ❌ "${poi.nom}" → Non affecté (aucune suggestion)`);
        }
      }
    }

    console.log(`📊 Résultat: ${autoMatchedCount}/${pois.length} POI(s) auto-affecté(s)`);

    return assignment;
  }

  /**
   * Génère des statistiques sur l'affectation
   */
  generateStats(assignment: ClusterAssignment): {
    total_pois: number;
    assigned: number;
    unassigned: number;
    auto_matched: number;
    manual_matched: number;
    by_cluster: Record<string, number>;
  } {
    let totalAssigned = 0;
    let autoMatched = 0;
    let manualMatched = 0;
    const byCluster: Record<string, number> = {};

    for (const [clusterId, pois] of Object.entries(assignment.clusters)) {
      totalAssigned += pois.length;
      byCluster[clusterId] = pois.length;

      for (const item of pois) {
        if (item.matched_automatically) {
          autoMatched++;
        } else {
          manualMatched++;
        }
      }
    }

    return {
      total_pois: totalAssigned + assignment.unassigned.length,
      assigned: totalAssigned,
      unassigned: assignment.unassigned.length,
      auto_matched: autoMatched,
      manual_matched: manualMatched,
      by_cluster: byCluster,
    };
  }
}
