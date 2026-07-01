import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { GeocodingService } from '../services/geocoding.service.js';
import {
  geocodeMissingPoiPages,
  geocodeMissingPoisInSelection,
  getPoiGeocodeQualityReport,
  listPoisMissingCoordinates,
  regeocodePoiPage,
} from '../services/poi-geocoding.service.js';

const geocodingService = new GeocodingService();

const ResolveBodySchema = z.object({
  /** Nom du lieu à géolocaliser */
  query: z.string().min(1),
  /** Pays optionnel — améliore la précision Photon */
  country: z.string().optional(),
  /**
   * Destination du guide (ex: "Tenerife") — utilisée pour déduire le pays
   * si `country` n'est pas fourni explicitement.
   */
  destination: z.string().optional(),
});

export async function geocodingRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/geocoding/resolve
   *
   * Géolocalise un lieu via Photon et retourne ses coordonnées GPS
   * ainsi que les URLs cartographiques (Google Maps, OpenStreetMap, geo:).
   *
   * Usage type : champ lien "Voir sur la carte" dans un template POI.
   * Le frontend peut appeler cet endpoint pour pré-remplir l'URL du lien.
   */
  fastify.post('/geocoding/resolve', async (request, reply) => {
    const body = ResolveBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Paramètres invalides', details: body.error.flatten() });
    }

    const { query, country, destination } = body.data;

    // Résoudre le pays : explicite > déduit depuis la destination > absent
    const resolvedCountry =
      country ??
      (destination ? geocodingService.getCountryFromDestination(destination) : undefined);

    const result = await geocodingService.resolve(query, resolvedCountry);

    if (!result) {
      return reply.status(404).send({
        error: 'Lieu introuvable',
        query,
        country: resolvedCountry ?? null,
      });
    }

    return reply.send(result);
  });

  /**
   * GET /api/v1/geocoding/resolve?query=...&country=...
   *
   * Même fonctionnalité que le POST, accessible via URL (utile pour les tests).
   */
  fastify.get('/geocoding/resolve', async (request, reply) => {
    const { query, country, destination } = request.query as Record<string, string>;

    if (!query) {
      return reply.status(400).send({ error: 'Paramètre "query" requis' });
    }

    const resolvedCountry =
      country ??
      (destination ? geocodingService.getCountryFromDestination(destination) : undefined);

    const result = await geocodingService.resolve(query, resolvedCountry);

    if (!result) {
      return reply.status(404).send({ error: 'Lieu introuvable', query });
    }

    return reply.send(result);
  });

  /**
   * GET /guides/:guideId/poi-geocode-status
   * Liste les POIs sans coordonnées GPS (alertes export).
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/poi-geocode-status',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'guideId invalide' });
      }

      try {
        const missing = await listPoisMissingCoordinates(db, guideId);
        return reply.send({ missing, count: missing.length });
      } catch (error: any) {
        if (
          error.message === 'Guide non trouvé' ||
          error.message === 'Chemin de fer non trouvé pour ce guide'
        ) {
          return reply.status(404).send({ error: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la lecture des POIs' });
      }
    }
  );

  /**
   * GET /guides/:guideId/poi-geocode-quality
   * Rapport complet : coordonnées OK, manquantes, hors destination, sans GPS.
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/poi-geocode-quality',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'guideId invalide' });
      }

      try {
        const report = await getPoiGeocodeQualityReport(db, guideId, geocodingService);
        return reply.send(report);
      } catch (error: any) {
        if (
          error.message === 'Guide non trouvé' ||
          error.message === 'Chemin de fer non trouvé pour ce guide'
        ) {
          return reply.status(404).send({ error: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors du contrôle qualité GPS' });
      }
    }
  );

  /**
   * POST /guides/:guideId/poi-geocode-quality/:pageId/regeocode
   * Relance Photon pour un POI précis et remplace ses coordonnées si un résultat
   * est trouvé dans le périmètre de destination.
   */
  fastify.post<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/poi-geocode-quality/:pageId/regeocode',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId, pageId } = request.params;

      if (!ObjectId.isValid(guideId) || !ObjectId.isValid(pageId)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      try {
        const result = await regeocodePoiPage(db, guideId, pageId, geocodingService);
        return reply.send(result);
      } catch (error: any) {
        if (
          error.message === 'Guide non trouvé' ||
          error.message === 'Chemin de fer non trouvé pour ce guide' ||
          error.message === 'Page POI non trouvée'
        ) {
          return reply.status(404).send({ error: error.message });
        }
        if (
          error.message === 'Nom du lieu introuvable' ||
          error.message?.startsWith('Aucun résultat Photon')
        ) {
          return reply.status(422).send({ error: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la relance Photon' });
      }
    }
  );

  /**
   * POST /guides/:guideId/geocode-missing-pois
   *
   * Géocode via Photon les POIs sans coordonnées GPS et persiste le résultat
   * dans pages.coordinates (source unique pour l'export GeoJSON).
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/geocode-missing-pois',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'guideId invalide' });
      }

      try {
        const result = await geocodeMissingPoiPages(db, guideId, geocodingService);
        return reply.send(result);
      } catch (error: any) {
        if (
          error.message === 'Guide non trouvé' ||
          error.message === 'Chemin de fer non trouvé pour ce guide'
        ) {
          return reply.status(404).send({ error: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors du géocodage des POIs' });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/geocode-missing
   *
   * Géocode via Photon les POIs de pois_selection sans coordonnées (étape 3, avant
   * la création des "pages"). Les POIs déjà auto-affectés à un cluster ont déjà leurs
   * coordonnées copiées depuis Region Lovers lors du matching — seuls les POIs restés
   * "non affectés" nécessitent réellement un géocodage ici.
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/geocode-missing',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'guideId invalide' });
      }

      try {
        const result = await geocodeMissingPoisInSelection(db, guideId, geocodingService);
        return reply.send(result);
      } catch (error: any) {
        if (error.message === 'Guide non trouvé' || error.message === 'Aucun POI sélectionné pour ce guide') {
          return reply.status(404).send({ error: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors du géocodage des POIs' });
      }
    }
  );
}
