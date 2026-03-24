/**
 * Service de matching entre POIs (détectés dans les articles WordPress)
 * et place_instances Region Lovers (contenus dans des clusters)
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
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.90;
  private readonly AUTO_MATCH_THRESHOLD = 0.60;
  private readonly MIN_SUGGESTION_THRESHOLD = 0.30;

  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) matrix[i] = [i];
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[len1][len2];
  }

  calculateSimilarity(str1: string, str2: string): number {
    const norm1 = this.normalizeString(str1);
    const norm2 = this.normalizeString(str2);

    if (norm1 === norm2) return 1.0;

    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const shorterLen = Math.min(norm1.length, norm2.length);
      const longerLen = Math.max(norm1.length, norm2.length);
      return 0.85 + (shorterLen / longerLen) * 0.10;
    }

    const distance = this.levenshteinDistance(norm1, norm2);
    const maxLen = Math.max(norm1.length, norm2.length);
    if (maxLen === 0) return 0;
    return Math.max(0, 1 - distance / maxLen);
  }

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

  private getConfidenceLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= this.HIGH_CONFIDENCE_THRESHOLD) return 'high';
    if (score >= 0.75) return 'medium';
    return 'low';
  }

  autoAssignPOIs(pois: POI[], placeInstances: PlaceInstance[]): ClusterAssignment {
    const assignment: ClusterAssignment = { unassigned: [], clusters: {} };

    const uniqueClusterIds = [...new Set(placeInstances.map(pi => pi.cluster_id))];
    for (const clusterId of uniqueClusterIds) {
      assignment.clusters[clusterId] = [];
    }

    let autoMatchedCount = 0;

    for (const poi of pois) {
      const bestMatch = this.findBestMatch(poi, placeInstances);

      if (bestMatch && bestMatch.score >= this.AUTO_MATCH_THRESHOLD) {
        const clusterId = bestMatch.place_instance.cluster_id;
        assignment.clusters[clusterId].push({
          poi,
          current_cluster_id: clusterId,
          place_instance_id: bestMatch.place_instance.place_instance_id,
          suggested_match: bestMatch,
          matched_automatically: true,
        });
        autoMatchedCount++;
      } else {
        assignment.unassigned.push({
          poi,
          current_cluster_id: 'unassigned',
          suggested_match: bestMatch || undefined,
          matched_automatically: false,
        });
      }
    }

    console.log(`📊 Résultat auto-matching: ${autoMatchedCount}/${pois.length} POI(s) auto-affecté(s)`);
    return assignment;
  }

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
        if (item.matched_automatically) autoMatched++;
        else manualMatched++;
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
