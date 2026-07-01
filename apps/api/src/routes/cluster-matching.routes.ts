import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { COLLECTIONS } from '../config/collections.js';
import { GeocodingService, haversineDistanceKm } from '../services/geocoding.service.js';
import { buildSelectionPoiGeocodingQuery, getGuideDestination } from '../services/poi-geocoding.service.js';

const geocodingService = new GeocodingService();

/** Distance max pour valider qu'un match par nom (confiance < high) pointe bien vers le même lieu. */
const GEO_VALIDATION_MAX_KM = 3;
/** Distance max pour affecter un POI non matché par nom à la place instance la plus proche. */
const GEO_FALLBACK_MAX_KM = 15;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Routes de matching clusters.
 *
 * Proxy léger vers apps/poi-service.
 * Si POI_SERVICE_URL n'est pas configuré, répond 503.
 */
export default async function clusterMatchingRoutes(fastify: FastifyInstance) {
  const serviceUrl = env.POI_SERVICE_URL;
  const apiKey = env.POI_SERVICE_API_KEY;

  async function sendLocalMatchingIfAvailable(request: any, reply: any): Promise<boolean> {
    const guideId = request.params?.guideId;
    if (!guideId) return false;

    const db = request.server.container.db;
    const localMatching = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
    if (!localMatching) return false;

    const hasAssignment = Boolean(localMatching.assignment || localMatching.clusters || localMatching.unassigned);
    const hasClusters = Array.isArray(localMatching.clusters_metadata) && localMatching.clusters_metadata.length > 0;
    if (!hasAssignment && !hasClusters) return false;

    const assignment = localMatching.assignment || {
      clusters: localMatching.clusters || {},
      unassigned: localMatching.unassigned || [],
    };
    const clustersMetadata = [...(localMatching.clusters_metadata || [])];
    const knownClusterIds = new Set(clustersMetadata.map((cluster: any) => cluster.cluster_id));
    for (const [clusterId, items] of Object.entries(assignment.clusters || {})) {
      if (knownClusterIds.has(clusterId)) continue;
      const clusterPois = Array.isArray(items) ? items : [];
      const firstPoi = clusterPois[0]?.poi || clusterPois[0] || {};
      clustersMetadata.push({
        cluster_id: clusterId,
        cluster_name: firstPoi.cluster_name || clusterId,
        place_count: clusterPois.length,
      });
    }

    return reply.send({
      assignment,
      stats: localMatching.stats || null,
      clusters_metadata: clustersMetadata,
      created_at: localMatching.created_at || null,
      updated_at: localMatching.updated_at || null,
    }), true;
  }

  const guideParam = '/guides/:guideId';

  /**
   * POST /guides/:guideId/matching
   * guides/pois_selection vivent dans notre base, pas dans celle du poi-service : on les lit ici
   * et on les envoie dans le body au poi-service (qui fait le calcul + l'appel Region Lovers),
   * puis on persiste le résultat localement — le poi-service ne touche pas notre base.
   */
  fastify.post(`${guideParam}/matching`, async (request: any, reply: any) => {
    const guideId = request.params.guideId;
    if (!serviceUrl) {
      return reply.status(503).send({ error: 'POI service non disponible', message: 'POI_SERVICE_URL doit être configuré.' });
    }
    try {
      const db = request.server.container.db;
      if (!ObjectId.isValid(guideId)) return reply.code(400).send({ error: 'Guide ID invalide' });

      const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });
      if (!guide.destination_rl_id) return reply.code(400).send({ error: 'destination_rl_id manquant' });

      const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
      if (!poisSelection?.pois?.length) return reply.code(400).send({ error: 'Aucun POI sélectionné' });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-Api-Key'] = apiKey;
      if (request.headers?.cookie) headers['Cookie'] = request.headers.cookie;
      if (request.headers?.authorization) headers['Authorization'] = request.headers.authorization;

      const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/v1/guides/${guideId}/matching`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ guide_destination_rl_id: guide.destination_rl_id, pois: poisSelection.pois }),
      });
      const data: any = await res.json().catch(() => ({ error: 'Réponse non-JSON du microservice' }));
      if (!res.ok) return reply.status(res.status).send(data);

      let updatedPois: any[] = Array.isArray(data.updated_pois) ? data.updated_pois : [];
      const placeInstances: any[] = Array.isArray(data.place_instances) ? data.place_instances : [];

      if (updatedPois.length > 0) {
        const destination = getGuideDestination(guide);
        const country = destination ? geocodingService.getCountryFromDestination(destination) : undefined;
        const geoBias = destination ? geocodingService.getBiasFromDestination(destination) : undefined;

        // ── Passe 1 : valide les matchs par nom de confiance < high via géocodage Photon ──
        // Un match "low"/"medium" peut être une coïncidence de texte (ex: "Quais du Rhône" vs
        // "Camping du Pylône" à 47%) — on géocode le POI et on vérifie qu'il est bien proche de
        // la place instance matchée. Sinon, on le repasse "non affecté" en gardant les coordonnées
        // Photon fraîchement obtenues, réutilisables par la passe 2.
        const toValidate = updatedPois.filter(p => p.matched_automatically && p.confidence !== 'high');
        for (let i = 0; i < toValidate.length; i++) {
          const poi = toValidate[i];
          try {
            const query = buildSelectionPoiGeocodingQuery(poi, guide).trim();
            const resolved = query ? await geocodingService.resolveWithPlaceMatch(query, country, geoBias) : null;
            if (resolved && poi.coordinates) {
              const distanceKm = haversineDistanceKm(resolved, poi.coordinates);
              if (distanceKm > GEO_VALIDATION_MAX_KM) {
                fastify.log.info({ poi_id: poi.poi_id, nom: poi.nom, distanceKm, score: poi.score }, '[MATCHING] Match invalidé par géo-validation');
                poi.cluster_id = null;
                poi.cluster_name = null;
                poi.matched_automatically = false;
                poi.confidence = null;
                poi.score = null;
                poi.place_instance_id = null;
                poi.coordinates = { lat: resolved.lat, lon: resolved.lon, display_name: resolved.display_name };
              }
            }
          } catch (err: any) {
            fastify.log.warn({ err: err.message, poi_id: poi.poi_id }, '[MATCHING] Erreur géo-validation POI');
          }
          if (i < toValidate.length - 1) await sleep(300);
        }

        // ── Passe 2 : affecte au cluster le plus proche les POIs non matchés par nom mais déjà
        // géolocalisés (via le bouton "3. Géolocaliser" ou rétrogradés à la passe 1) ──
        const placeInstancesWithCoords = placeInstances.filter(pi => pi.coordinates);
        for (const poi of updatedPois) {
          if (poi.cluster_id || !poi.coordinates) continue;

          let nearest: any = null;
          let nearestDistanceKm = Infinity;
          for (const pi of placeInstancesWithCoords) {
            const distanceKm = haversineDistanceKm(poi.coordinates, pi.coordinates);
            if (distanceKm < nearestDistanceKm) {
              nearestDistanceKm = distanceKm;
              nearest = pi;
            }
          }

          if (nearest && nearestDistanceKm <= GEO_FALLBACK_MAX_KM) {
            poi.cluster_id = nearest.cluster_id;
            poi.cluster_name = nearest.cluster_name;
            poi.place_instance_id = nearest.place_instance_id;
            poi.matched_automatically = true;
            poi.confidence = 'geo';
            poi.score = null;
            fastify.log.info({ poi_id: poi.poi_id, nom: poi.nom, cluster_name: nearest.cluster_name, distanceKm: nearestDistanceKm }, '[MATCHING] Affecté par proximité géo');
          }
        }
      }

      // Stats recalculées après ajustements géo (data.stats ne reflète que la passe par nom).
      const finalStats = {
        total_pois: updatedPois.length,
        assigned: updatedPois.filter(p => p.cluster_id).length,
        unassigned: updatedPois.filter(p => !p.cluster_id).length,
        auto_matched: updatedPois.filter(p => p.matched_automatically).length,
        manual_matched: 0,
        by_cluster: updatedPois.filter(p => p.cluster_id).reduce((acc: Record<string, number>, p: any) => {
          acc[p.cluster_id] = (acc[p.cluster_id] || 0) + 1;
          return acc;
        }, {}),
      };

      const now = new Date();
      await db.collection(COLLECTIONS.cluster_assignments).updateOne(
        { guide_id: guideId },
        { $set: { guide_id: guideId, assignment: data.assignment, stats: finalStats, clusters_metadata: data.clusters_metadata, matched_at: now, updated_at: now } },
        { upsert: true }
      );
      if (updatedPois.length > 0) {
        await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: updatedPois, updated_at: now } });
      }

      return reply.send({ assignment: data.assignment, stats: finalStats, clusters_metadata: data.clusters_metadata });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Erreur matching');
      return reply.status(502).send({ error: 'Erreur de communication avec le POI service', details: error.message });
    }
  });

  /**
   * GET /guides/:guideId/matching
   * cluster_assignments vit dans notre base — pas de repli vers le poi-service (sa copie locale
   * est structurellement vide/obsolète). Absence de matching = état initial, pas une erreur.
   */
  fastify.get(`${guideParam}/matching`, async (req, reply) => {
    if (await sendLocalMatchingIfAvailable(req, reply)) return;
    return reply.send({
      assignment: { clusters: {}, unassigned: [] },
      stats: null,
      clusters_metadata: [],
      created_at: null,
      updated_at: null,
    });
  });

  /**
   * POST /guides/:guideId/clusters
   * Crée un cluster manuel. cluster_assignments vit dans notre base — géré ici en local,
   * pas de proxy vers le poi-service (qui n'a pas accès à cette donnée).
   */
  fastify.post(`${guideParam}/clusters`, async (request: any, reply: any) => {
    const guideId = request.params.guideId;
    const { cluster_name } = (request.body || {}) as { cluster_name?: string };
    if (!cluster_name?.trim()) return reply.code(400).send({ error: 'Le nom du cluster est requis' });

    try {
      const db = request.server.container.db;
      const clusterId = `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const newCluster = { cluster_id: clusterId, cluster_name: cluster_name.trim(), place_count: 0, is_manual: true, created_at: new Date() };

      const existingAssignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
      if (existingAssignment) {
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $push: { clusters_metadata: newCluster } as any, $set: { updated_at: new Date() } }
        );
      } else {
        await db.collection(COLLECTIONS.cluster_assignments).insertOne({
          guide_id: guideId,
          clusters_metadata: [newCluster],
          assignment: { clusters: {}, unassigned: [] },
          stats: { total_pois: 0, assigned: 0, unassigned: 0, auto_matched: 0, manual_matched: 0, by_cluster: {} },
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      return reply.send({ success: true, cluster: newCluster });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Erreur création cluster manuel');
      return reply.code(500).send({ error: error.message });
    }
  });
}
