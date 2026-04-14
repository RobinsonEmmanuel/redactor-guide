import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../config/collections.js';

// ─── Normalisation des noms pour le matching ─────────────────────────────────
// Minuscules + suppression des accents + caractères non-alphanumériques → espace
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: Record<string, any>;
  id?: string;
}

export interface MatchEntry {
  page_id:        string;
  page_titre:     string;
  geojson_name:   string;
  /** null = pas de coordonnées actuelles en base */
  current_coords: { lat: number; lon: number } | null;
  new_coords:     { lat: number; lon: number };
  /** update = valeurs différentes, identical = déjà correct */
  status:         'update' | 'identical';
}

export interface PreviewResult {
  matches:           MatchEntry[];
  unmatched_geojson: Array<{ name: string; coords: { lat: number; lon: number } }>;
  unmatched_pages:   Array<{ page_id: string; titre: string }>;
  stats: {
    total_features:     number;
    matched:            number;
    to_update:          number;
    identical:          number;
    unmatched_geojson:  number;
    unmatched_pages:    number;
  };
}

export async function importGeoJsonRoutes(fastify: FastifyInstance) {
  /**
   * POST /guides/:guideId/import/geojson/preview
   * Analyse un tableau de features GeoJSON et compare avec les pages POI en base.
   * Retourne : matches (avec statut update/identical), non-matchés côté GeoJSON, non-matchés côté pages.
   *
   * Body: { features: GeoJsonFeature[] }
   */
  fastify.post<{
    Params: { guideId: string };
    Body:   { features: GeoJsonFeature[] };
  }>(
    '/guides/:guideId/import/geojson/preview',
    async (request, reply) => {
      const { guideId } = request.params;
      const { features } = request.body;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }
      if (!Array.isArray(features) || features.length === 0) {
        return reply.status(400).send({ error: 'Le corps doit contenir un tableau "features" non vide' });
      }

      // 1. Chemin de fer → chemin_de_fer_id
      const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé pour ce guide' });
      }
      const cheminDeFerId = cheminDeFer._id.toString();

      // 2. Charger toutes les pages POI du chemin de fer
      const pages = await db.collection(COLLECTIONS.pages)
        .find({
          chemin_de_fer_id: cheminDeFerId,
          $or: [{ type_de_page: 'poi' }, { 'metadata.page_type': 'poi' }],
        })
        .toArray();

      // 3. Index pages par nom normalisé
      // En cas de doublons de pages on garde le premier
      const pageIndex = new Map<string, typeof pages[number]>();
      for (const p of pages) {
        const key = normalizeName(p.titre as string ?? '');
        if (key && !pageIndex.has(key)) pageIndex.set(key, p);
      }
      const matchedPageIds = new Set<string>();

      // 4. Filtrer les features avec une géométrie Point valide
      const validFeatures = features.filter(
        f => f.geometry?.type === 'Point' &&
             Array.isArray(f.geometry.coordinates) &&
             f.geometry.coordinates.length === 2
      );

      const matches:           MatchEntry[] = [];
      const unmatchedGeoJson:  PreviewResult['unmatched_geojson'] = [];

      for (const feature of validFeatures) {
        const rawName = feature.properties?.name as string | undefined;
        if (!rawName) continue;

        // GeoJSON : [longitude, latitude]
        const [lon, lat] = feature.geometry!.coordinates as [number, number];
        const newCoords = { lat, lon };
        const key = normalizeName(rawName);
        const page = pageIndex.get(key);

        if (!page) {
          unmatchedGeoJson.push({ name: rawName, coords: newCoords });
          continue;
        }

        // Doublon GeoJSON (même page déjà matchée) → on ignore le second
        const pageIdStr = (page._id as ObjectId).toString();
        if (matchedPageIds.has(pageIdStr)) continue;
        matchedPageIds.add(pageIdStr);

        const currentCoords = (page as any).coordinates as { lat: number; lon: number } | undefined ?? null;
        const identical =
          currentCoords !== null &&
          Math.abs(currentCoords.lat - lat) < 1e-6 &&
          Math.abs(currentCoords.lon - lon) < 1e-6;

        matches.push({
          page_id:        pageIdStr,
          page_titre:     page.titre as string,
          geojson_name:   rawName,
          current_coords: currentCoords,
          new_coords:     newCoords,
          status:         identical ? 'identical' : 'update',
        });
      }

      // 5. Pages non matchées
      const unmatchedPages: PreviewResult['unmatched_pages'] = pages
        .filter(p => !matchedPageIds.has((p._id as ObjectId).toString()))
        .map(p => ({ page_id: (p._id as ObjectId).toString(), titre: p.titre as string }));

      const toUpdate = matches.filter(m => m.status === 'update').length;

      const result: PreviewResult = {
        matches,
        unmatched_geojson: unmatchedGeoJson,
        unmatched_pages:   unmatchedPages,
        stats: {
          total_features:    validFeatures.length,
          matched:           matches.length,
          to_update:         toUpdate,
          identical:         matches.length - toUpdate,
          unmatched_geojson: unmatchedGeoJson.length,
          unmatched_pages:   unmatchedPages.length,
        },
      };

      return reply.send(result);
    }
  );

  /**
   * POST /guides/:guideId/import/geojson/apply
   * Applique les mises à jour de coordonnées GPS sur les pages sélectionnées.
   *
   * Body: { updates: Array<{ pageId: string; lat: number; lon: number }> }
   */
  fastify.post<{
    Params: { guideId: string };
    Body:   { updates: Array<{ pageId: string; lat: number; lon: number }> };
  }>(
    '/guides/:guideId/import/geojson/apply',
    async (request, reply) => {
      const { guideId } = request.params;
      const { updates } = request.body;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }
      if (!Array.isArray(updates) || updates.length === 0) {
        return reply.status(400).send({ error: 'Le corps doit contenir un tableau "updates" non vide' });
      }

      let updatedCount = 0;
      const errors: string[] = [];

      for (const { pageId, lat, lon } of updates) {
        if (!ObjectId.isValid(pageId) || typeof lat !== 'number' || typeof lon !== 'number') {
          errors.push(`Entrée invalide : ${pageId}`);
          continue;
        }
        try {
          const result = await db.collection(COLLECTIONS.pages).updateOne(
            { _id: new ObjectId(pageId) },
            { $set: { coordinates: { lat, lon }, updated_at: new Date() } }
          );
          if (result.modifiedCount > 0) updatedCount++;
        } catch (err: any) {
          errors.push(`Erreur pour ${pageId} : ${err.message}`);
        }
      }

      return reply.send({
        updated:   updatedCount,
        attempted: updates.length,
        errors:    errors.length > 0 ? errors : undefined,
      });
    }
  );
}
