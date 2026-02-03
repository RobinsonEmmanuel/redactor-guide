import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
  CreatePromptSchema,
  UpdatePromptSchema,
  PromptResolutionSchema,
} from '@redactor-guide/core-model';

export async function promptsRoutes(fastify: FastifyInstance) {
  /**
   * GET /prompts
   * Liste tous les prompts avec filtres optionnels
   */
  fastify.get('/prompts', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { intent, page_type, actif, langue_source } = request.query as {
        intent?: string;
        page_type?: string;
        actif?: string;
        langue_source?: string;
      };

      const filter: any = {};
      if (intent) filter.intent = intent;
      if (page_type) filter.page_type = page_type;
      if (actif !== undefined) filter.actif = actif === 'true';
      if (langue_source) filter.langue_source = langue_source;

      const prompts = await db
        .collection('prompts')
        .find(filter)
        .sort({ intent: 1, page_type: 1, date_mise_a_jour: -1 })
        .toArray();

      return prompts;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des prompts' });
    }
  });

  /**
   * GET /prompts/:id
   * Récupère un prompt par son ID
   */
  fastify.get<{ Params: { id: string } }>('/prompts/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const prompt = await db.collection('prompts').findOne({ _id: new ObjectId(id) });

      if (!prompt) {
        return reply.status(404).send({ error: 'Prompt non trouvé' });
      }

      return prompt;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération du prompt' });
    }
  });

  /**
   * POST /prompts
   * Crée un nouveau prompt
   */
  fastify.post<{ Body: unknown }>('/prompts', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const body = CreatePromptSchema.parse(request.body);

      // Vérifier l'unicité (intent + page_type + langue_source) pour les prompts actifs
      if (body.actif !== false) {
        const existing = await db.collection('prompts').findOne({
          intent: body.intent,
          page_type: body.page_type || null,
          langue_source: body.langue_source,
          actif: true,
          prompt_id: { $ne: body.prompt_id },
        });

        if (existing) {
          return reply.status(400).send({
            error: 'Un prompt actif existe déjà pour cette combinaison (intent + page_type + langue)',
          });
        }
      }

      const now = new Date().toISOString();
      const prompt = {
        ...body,
        created_at: now,
        date_mise_a_jour: now,
      };

      const result = await db.collection('prompts').insertOne(prompt);
      const created = await db.collection('prompts').findOne({ _id: result.insertedId });

      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création du prompt' });
    }
  });

  /**
   * PUT /prompts/:id
   * Met à jour un prompt
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>('/prompts/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;
      const body = UpdatePromptSchema.parse(request.body);

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      // Vérifier l'unicité si on modifie intent/page_type/langue_source/actif
      if (body.intent || body.page_type !== undefined || body.langue_source || body.actif !== undefined) {
        const current = await db.collection('prompts').findOne({ _id: new ObjectId(id) });
        if (!current) {
          return reply.status(404).send({ error: 'Prompt non trouvé' });
        }

        const newIntent = body.intent || current.intent;
        const newPageType = body.page_type !== undefined ? body.page_type : current.page_type;
        const newLangue = body.langue_source || current.langue_source;
        const newActif = body.actif !== undefined ? body.actif : current.actif;

        if (newActif) {
          const existing = await db.collection('prompts').findOne({
            _id: { $ne: new ObjectId(id) },
            intent: newIntent,
            page_type: newPageType || null,
            langue_source: newLangue,
            actif: true,
          });

          if (existing) {
            return reply.status(400).send({
              error: 'Un prompt actif existe déjà pour cette combinaison',
            });
          }
        }
      }

      const now = new Date().toISOString();

      const result = await db.collection('prompts').findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { ...body, date_mise_a_jour: now } },
        { returnDocument: 'after' }
      );

      if (!result) {
        return reply.status(404).send({ error: 'Prompt non trouvé' });
      }

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la mise à jour' });
    }
  });

  /**
   * DELETE /prompts/:id
   * Supprime un prompt
   */
  fastify.delete<{ Params: { id: string } }>('/prompts/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const result = await db.collection('prompts').deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Prompt non trouvé' });
      }

      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la suppression' });
    }
  });

  /**
   * POST /prompts/:id/duplicate
   * Duplique un prompt
   */
  fastify.post<{ Params: { id: string } }>('/prompts/:id/duplicate', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const original = await db.collection('prompts').findOne({ _id: new ObjectId(id) });

      if (!original) {
        return reply.status(404).send({ error: 'Prompt non trouvé' });
      }

      const now = new Date().toISOString();
      const { _id, created_at, date_mise_a_jour, ...originalData } = original;

      const duplicate = {
        ...originalData,
        prompt_id: `${originalData.prompt_id}_copie_${Date.now()}`,
        prompt_nom: `${originalData.prompt_nom} (Copie)`,
        actif: false, // Toujours désactivé par défaut
        version: '1.0.0',
        created_at: now,
        date_mise_a_jour: now,
      };

      const result = await db.collection('prompts').insertOne(duplicate);
      const created = await db.collection('prompts').findOne({ _id: result.insertedId });

      return reply.status(201).send(created);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la duplication' });
    }
  });

  /**
   * POST /prompts/resolve
   * Résout un prompt selon les critères (avec logique de fallback)
   */
  fastify.post<{ Body: unknown }>('/prompts/resolve', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const criteria = PromptResolutionSchema.parse(request.body);

      // Stratégie 1: intent + page_type + langue
      if (criteria.page_type) {
        const prompt = await db.collection('prompts').findOne({
          intent: criteria.intent,
          page_type: criteria.page_type,
          langue_source: criteria.langue,
          actif: true,
        });

        if (prompt) {
          return { prompt, resolution: 'exact' };
        }
      }

      // Stratégie 2: intent + langue (sans page_type spécifique)
      const promptGeneral = await db.collection('prompts').findOne({
        intent: criteria.intent,
        page_type: null,
        langue_source: criteria.langue,
        actif: true,
      });

      if (promptGeneral) {
        return { prompt: promptGeneral, resolution: 'general' };
      }

      // Stratégie 3: intent + langue_source par défaut (fr)
      if (criteria.langue !== 'fr') {
        const promptDefault = await db.collection('prompts').findOne({
          intent: criteria.intent,
          page_type: criteria.page_type || null,
          langue_source: 'fr',
          actif: true,
        });

        if (promptDefault) {
          return { prompt: promptDefault, resolution: 'fallback_fr' };
        }
      }

      // Erreur: aucun prompt trouvé
      return reply.status(404).send({
        error: 'Aucun prompt trouvé',
        criteria,
        message: `Aucun prompt actif ne correspond à l'intent "${criteria.intent}" pour les critères spécifiés`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la résolution du prompt' });
    }
  });
}
