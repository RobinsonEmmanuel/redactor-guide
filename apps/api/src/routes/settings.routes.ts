/**
 * settings.routes.ts
 * GET /settings  — lire les paramètres globaux de l'application
 * PUT /settings  — mettre à jour les paramètres globaux
 *
 * Un seul document MongoDB avec _id = "global" dans la collection "settings".
 * Créé automatiquement avec des valeurs par défaut au premier GET s'il n'existe pas.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COLLECTIONS } from '../config/collections.js';

export const DEFAULT_SETTINGS = {
  /**
   * Ratio appliqué à max_chars lors de la génération française.
   * Protège contre l'expansion typique des traductions (DE +30%, ES +15%...).
   * Valeur recommandée : 0.75 (couvre l'allemand, le plus expansif).
   */
  generation_budget_ratio: 0.75,

  /**
   * Nombre de retries pour la boucle de re-traduction quand un champ dépasse max_chars.
   * Passe 1 : traduction standard avec consigne de condensation
   * Passe 2 : traduction avec pression explicite + longueur actuelle communiquée
   * Passe 3 : traduction minimaliste ultra-condensée
   */
  translation_retry_max: 3,

  /**
   * Si true, les dépassements non résolus après tous les retries sont marqués
   * OVERFLOW_MANUEL dans la page et remontés dans le module d'alerte.
   */
  translation_overflow_alert: true,
};

export type AppSettings = typeof DEFAULT_SETTINGS;

const UpdateSettingsSchema = z.object({
  generation_budget_ratio:    z.number().min(0.1).max(1).optional(),
  translation_retry_max:      z.number().int().min(1).max(5).optional(),
  translation_overflow_alert: z.boolean().optional(),
});

export async function settingsRoutes(fastify: FastifyInstance) {
  /**
   * GET /settings
   * Retourne les paramètres globaux (crée le document par défaut s'il n'existe pas).
   */
  fastify.get('/settings', async (_request, reply) => {
    try {
      const db = _request.server.container.db;
      let doc: any = await db.collection(COLLECTIONS.settings).findOne({ _id: 'global' } as any);

      if (!doc) {
        // Initialisation au premier appel
        await db.collection(COLLECTIONS.settings).insertOne({
          ...DEFAULT_SETTINGS,
          created_at: new Date(),
          updated_at: new Date(),
        } as any);
        doc = { _id: 'global', ...DEFAULT_SETTINGS };
      }

      const { _id, created_at, updated_at, ...settings } = doc as any;
      return reply.send(settings);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /settings
   * Met à jour les paramètres globaux (merge partiel).
   */
  fastify.put<{ Body: unknown }>('/settings', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const body = UpdateSettingsSchema.parse(request.body);

      await db.collection(COLLECTIONS.settings).updateOne(
        { _id: 'global' } as any,
        {
          $set: { ...body, updated_at: new Date() },
          $setOnInsert: { ...DEFAULT_SETTINGS, created_at: new Date() },
        } as any,
        { upsert: true }
      );

      const doc = await db.collection(COLLECTIONS.settings).findOne({ _id: 'global' } as any);
      const { _id, created_at, updated_at, ...settings } = doc as any;
      return reply.send(settings);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Paramètres invalides', details: err.errors });
      }
      return reply.status(500).send({ error: err.message });
    }
  });
}
