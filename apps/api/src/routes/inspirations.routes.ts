import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';

/**
 * Normalise les lieux_associes d'une liste d'inspirations
 * pour que tous les poi_id soient alignés sur pois_selection.
 *
 * Les inspirations générées par l'IA utilisent des poi_id issus du
 * sommaire_proposals (format slug : "playa-tejita") qui peuvent différer
 * des poi_id de pois_selection (référentiel stable de l'application).
 * Cette fonction assure l'alignement via une résolution en 3 niveaux :
 *  1. poi_id direct dans pois_selection → inchangé
 *  2. poi_id présent dans sommaire_proposals → résolution par nom dans pois_selection
 *  3. Inconnu des deux référentiels → conservé tel quel (données inconnues)
 */
async function normalizeLieuxAssocies(
  db: Db,
  guideId: string,
  inspirations: any[]
): Promise<any[]> {
  const poisDoc    = await db.collection('pois_selection').findOne({ guide_id: guideId });
  const allPois: any[] = poisDoc?.pois ?? [];

  if (allPois.length === 0) return inspirations; // pois_selection vide → rien à normaliser

  const validIds   = new Set(allPois.map((p: any) => p.poi_id));
  const poisByNom: Record<string, string> = {}; // nom.lower → poi_id
  for (const p of allPois) {
    if (p.nom) poisByNom[p.nom.toLowerCase().trim()] = p.poi_id;
  }

  // Fallback : sommaire_proposals contient les IDs AI avec leur nom lisible
  const sommaireDoc = await db.collection('sommaire_proposals').findOne({ guide_id: guideId });
  const sommairePoisMap: Record<string, string> = {}; // old_poi_id → nom
  for (const sp of (sommaireDoc?.proposal?.pois ?? [])) {
    if (sp.poi_id && sp.nom) sommairePoisMap[sp.poi_id] = sp.nom;
  }

  return inspirations.map((insp: any) => {
    const rawIds: string[] = insp.lieux_associes ?? [];
    const normalized: string[] = [];

    for (const id of rawIds) {
      if (validIds.has(id)) {
        // ID déjà valide dans pois_selection
        normalized.push(id);
        continue;
      }
      // Tentative de résolution via le nom dans sommaire_proposals
      const nom = sommairePoisMap[id];
      if (nom) {
        const newId = poisByNom[nom.toLowerCase().trim()];
        if (newId) {
          console.log(`🔄 [inspirations] lieux_associes: "${id}" → "${newId}" (via nom "${nom}")`);
          normalized.push(newId);
          continue;
        }
        // Nom connu mais pas dans pois_selection (POI non confirmé en étape 2)
        console.warn(`⚠️ [inspirations] POI "${id}" (nom: "${nom}") absent de pois_selection, conservé`);
      } else {
        console.warn(`⚠️ [inspirations] POI "${id}" inconnu des deux référentiels, conservé`);
      }
      normalized.push(id);
    }

    // Dédoublonnage (deux vieux IDs peuvent pointer vers le même pois_selection ID)
    const deduped = [...new Set(normalized)];
    return { ...insp, lieux_associes: deduped };
  });
}

export default async function inspirationsRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;

  /**
   * GET /guides/:guideId/inspirations
   * Récupère les inspirations avec leurs POIs assignés
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/inspirations',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const inspirationsDoc = await db.collection('inspirations').findOne({ guide_id: guideId });

        if (!inspirationsDoc) {
          return reply.send({ inspirations: [] });
        }

        return reply.send({
          inspirations: inspirationsDoc.inspirations || [],
        });
      } catch (error: any) {
        console.error('❌ [Inspirations] Erreur récupération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la récupération',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /guides/:guideId/inspirations
   * Sauvegarde/met à jour les inspirations et leurs POIs assignés
   */
  fastify.post<{
    Params: { guideId: string };
    Body: { inspirations: any[] };
  }>(
    '/guides/:guideId/inspirations',
    async (request, reply) => {
      const { guideId } = request.params;
      const { inspirations } = request.body;

      try {
        console.log(`💾 [Inspirations] Sauvegarde ${inspirations.length} inspiration(s) pour guide ${guideId}`);

        // Aligner tous les lieux_associes sur les poi_id de pois_selection
        const normalizedInspirations = await normalizeLieuxAssocies(db, guideId, inspirations);

        await db.collection('inspirations').updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              inspirations: normalizedInspirations,
              updated_at: new Date(),
            },
            $setOnInsert: {
              created_at: new Date(),
            },
          },
          { upsert: true }
        );

        console.log('✅ [Inspirations] Sauvegarde réussie');

        return reply.send({
          success: true,
          inspirations: normalizedInspirations,
        });
      } catch (error: any) {
        console.error('❌ [Inspirations] Erreur sauvegarde:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la sauvegarde',
          details: error.message,
        });
      }
    }
  );
}
