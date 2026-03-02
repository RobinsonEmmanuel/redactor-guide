import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GeocodingService } from '../services/geocoding.service.js';

const geocodingService = new GeocodingService();

const ResolveBodySchema = z.object({
  /** Nom du lieu à géolocaliser */
  query: z.string().min(1),
  /** Pays optionnel — améliore la précision de Nominatim */
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
   * Géolocalise un lieu via Nominatim et retourne ses coordonnées GPS
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
}
