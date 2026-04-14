import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import OpenAI from 'openai';
import { COLLECTIONS } from '../config/collections.js';
import { env } from '../config/env.js';

// ─── Normalisation des noms pour le matching ─────────────────────────────────
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── Traduction batch ES→FR via OpenAI ───────────────────────────────────────
// Traduit un tableau de noms en une seule requête et retourne un Map nom → traduction.
// Si la clé OPENAI_API_KEY est absente, retourne un Map vide (dégradé silencieux).
async function translateNamesToFrench(
  names: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!names.length || !env.OPENAI_API_KEY) return result;

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const prompt = `Tu es expert en tourisme et noms de lieux hispanophones.
Traduis chaque nom ci-dessous de l'espagnol vers le français.
Règles :
- Pour les noms propres géographiques sans traduction courante (ex: Masca, Garachico), garde le nom original.
- Pour les noms communs traduits habituellement (Iglesia → Église, Playa → Plage, Mirador → Belvédère, etc.), traduis.
- Certains noms sont déjà en français : garde-les identiques.
- Réponds UNIQUEMENT avec un objet JSON valide : {"nom_original": "traduction", ...}

Noms à traduire :
${JSON.stringify(names)}`;

    const resp = await client.chat.completions.create({
      model:           'gpt-4o-mini',
      messages:        [{ role: 'user', content: prompt }],
      max_tokens:      1000,
      temperature:     0.1,
      response_format: { type: 'json_object' },
    });

    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed: Record<string, string> = JSON.parse(raw);
    for (const [orig, trans] of Object.entries(parsed)) {
      if (typeof trans === 'string' && trans.trim()) {
        result.set(orig, trans.trim());
      }
    }
  } catch (err) {
    console.error('[import-geojson] Erreur traduction AI:', err);
  }
  return result;
}

// ─── Types partagés ──────────────────────────────────────────────────────────

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: Record<string, any>;
  id?: string;
}

export interface MatchEntry {
  page_id:          string;
  page_titre:       string;
  /** Nom dans le fichier GeoJSON (peut être vernaculaire) */
  geojson_name:     string;
  /** Nom traduit utilisé pour le match (= geojson_name si match direct) */
  translated_name:  string | null;
  /** true si le match a nécessité une traduction AI */
  is_translated:    boolean;
  current_coords:   { lat: number; lon: number } | null;
  new_coords:       { lat: number; lon: number };
  status:           'update' | 'identical';
}

export interface PreviewResult {
  matches:           MatchEntry[];
  unmatched_geojson: Array<{ name: string; translated_name: string | null; coords: { lat: number; lon: number } }>;
  unmatched_pages:   Array<{ page_id: string; titre: string }>;
  stats: {
    total_features:     number;
    matched:            number;
    matched_direct:     number;
    matched_translated: number;
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
   *
   * Matching en 2 passes :
   *   1. Matching direct par nom normalisé
   *   2. Pour les non-matchés, traduction ES→FR via GPT-4o-mini puis second matching
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

      // 1. Chemin de fer
      const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé pour ce guide' });
      }
      const cheminDeFerId = cheminDeFer._id.toString();

      // 2. Pages POI du chemin de fer
      const pages = await db.collection(COLLECTIONS.pages)
        .find({
          chemin_de_fer_id: cheminDeFerId,
          $or: [{ type_de_page: 'poi' }, { 'metadata.page_type': 'poi' }],
        })
        .toArray();

      // 3. Index pages par nom normalisé (dedupliqué : premier gagne)
      const pageIndex = new Map<string, typeof pages[number]>();
      for (const p of pages) {
        const key = normalizeName(p.titre as string ?? '');
        if (key && !pageIndex.has(key)) pageIndex.set(key, p);
      }
      const matchedPageIds = new Set<string>();

      // 4. Features valides avec Point
      const validFeatures = features.filter(
        f => f.geometry?.type === 'Point' &&
             Array.isArray(f.geometry.coordinates) &&
             f.geometry.coordinates.length === 2 &&
             f.properties?.name
      );

      const matches:          MatchEntry[] = [];
      const stillUnmatched:   { feature: GeoJsonFeature; name: string; coords: { lat: number; lon: number } }[] = [];

      // ── Passe 1 : matching direct ──────────────────────────────────────────
      for (const feature of validFeatures) {
        const rawName = feature.properties.name as string;
        const [lon, lat] = feature.geometry!.coordinates as [number, number];
        const newCoords  = { lat, lon };
        const key        = normalizeName(rawName);
        const page       = pageIndex.get(key);

        if (!page) {
          stillUnmatched.push({ feature, name: rawName, coords: newCoords });
          continue;
        }

        const pageIdStr = (page._id as ObjectId).toString();
        if (matchedPageIds.has(pageIdStr)) continue; // doublon GeoJSON
        matchedPageIds.add(pageIdStr);

        const currentCoords = (page as any).coordinates as { lat: number; lon: number } | undefined ?? null;
        const identical =
          currentCoords !== null &&
          Math.abs(currentCoords.lat - lat) < 1e-6 &&
          Math.abs(currentCoords.lon - lon) < 1e-6;

        matches.push({
          page_id:         pageIdStr,
          page_titre:      page.titre as string,
          geojson_name:    rawName,
          translated_name: null,
          is_translated:   false,
          current_coords:  currentCoords,
          new_coords:      newCoords,
          status:          identical ? 'identical' : 'update',
        });
      }

      // ── Passe 2 : traduction AI pour les non-matchés ──────────────────────
      const uniqueUnmatchedNames = [...new Set(stillUnmatched.map(u => u.name))];
      const translations = await translateNamesToFrench(uniqueUnmatchedNames);

      const finalUnmatched: PreviewResult['unmatched_geojson'] = [];

      for (const { name, coords } of stillUnmatched) {
        const translated = translations.get(name) ?? null;
        const matchKey   = translated ? normalizeName(translated) : null;
        const page       = matchKey ? pageIndex.get(matchKey) : undefined;

        if (!page) {
          finalUnmatched.push({ name, translated_name: translated, coords });
          continue;
        }

        const pageIdStr = (page._id as ObjectId).toString();
        if (matchedPageIds.has(pageIdStr)) {
          // Page déjà matchée via un autre feature → signaler comme non-matché
          finalUnmatched.push({ name, translated_name: translated, coords });
          continue;
        }
        matchedPageIds.add(pageIdStr);

        const currentCoords = (page as any).coordinates as { lat: number; lon: number } | undefined ?? null;
        const { lat, lon } = coords;
        const identical =
          currentCoords !== null &&
          Math.abs(currentCoords.lat - lat) < 1e-6 &&
          Math.abs(currentCoords.lon - lon) < 1e-6;

        matches.push({
          page_id:         pageIdStr,
          page_titre:      page.titre as string,
          geojson_name:    name,
          translated_name: translated,
          is_translated:   true,
          current_coords:  currentCoords,
          new_coords:      coords,
          status:          identical ? 'identical' : 'update',
        });
      }

      // Pages sans correspondance GeoJSON
      const unmatchedPages: PreviewResult['unmatched_pages'] = pages
        .filter(p => !matchedPageIds.has((p._id as ObjectId).toString()))
        .map(p => ({ page_id: (p._id as ObjectId).toString(), titre: p.titre as string }));

      const toUpdate          = matches.filter(m => m.status === 'update').length;
      const matchedTranslated = matches.filter(m => m.is_translated).length;

      const result: PreviewResult = {
        matches,
        unmatched_geojson: finalUnmatched,
        unmatched_pages:   unmatchedPages,
        stats: {
          total_features:     validFeatures.length,
          matched:            matches.length,
          matched_direct:     matches.length - matchedTranslated,
          matched_translated: matchedTranslated,
          to_update:          toUpdate,
          identical:          matches.length - toUpdate,
          unmatched_geojson:  finalUnmatched.length,
          unmatched_pages:    unmatchedPages.length,
        },
      };

      return reply.send(result);
    }
  );

  /**
   * POST /guides/:guideId/import/geojson/apply
   * Applique les coordonnées GPS et enregistre le nom vernaculaire si fourni.
   *
   * Body: { updates: Array<{ pageId: string; lat: number; lon: number; nomVernaculaire?: string }> }
   */
  fastify.post<{
    Params: { guideId: string };
    Body:   { updates: Array<{ pageId: string; lat: number; lon: number; nomVernaculaire?: string }> };
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

      for (const { pageId, lat, lon, nomVernaculaire } of updates) {
        if (!ObjectId.isValid(pageId) || typeof lat !== 'number' || typeof lon !== 'number') {
          errors.push(`Entrée invalide : ${pageId}`);
          continue;
        }
        try {
          const $set: Record<string, any> = {
            coordinates: { lat, lon },
            updated_at:  new Date(),
          };
          // Enregistrer le nom vernaculaire dans metadata si fourni et non-vide
          if (nomVernaculaire && nomVernaculaire.trim()) {
            $set['metadata.nom_vernaculaire'] = nomVernaculaire.trim();
          }

          const result = await db.collection(COLLECTIONS.pages).updateOne(
            { _id: new ObjectId(pageId) },
            { $set }
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
