import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
  CreateFieldServiceSchema,
  UpdateFieldServiceSchema,
} from '@redactor-guide/core-model';
import { REGISTERED_SERVICES } from '../services/field-service-runner.service.js';

export async function fieldServicesRoutes(fastify: FastifyInstance) {
  /**
   * GET /field-services
   * Liste tous les services actifs (ou tous si ?all=true).
   */
  fastify.get<{ Querystring: { all?: string } }>('/field-services', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const showAll = request.query.all === 'true';

      const filter = showAll ? {} : { active: true };
      const services = await db
        .collection('field_services')
        .find(filter)
        .sort({ label: 1 })
        .toArray();

      // Enrichir chaque service avec son statut d'implémentation (handler présent ?)
      const enriched = services.map((s) => ({
        ...s,
        implemented: !!REGISTERED_SERVICES[s.service_id],
      }));

      return reply.send(enriched);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des services' });
    }
  });

  /**
   * GET /field-services/:id
   * Récupère un service par son ObjectId MongoDB.
   */
  fastify.get<{ Params: { id: string } }>('/field-services/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const service = await db.collection('field_services').findOne({ _id: new ObjectId(id) });
      if (!service) {
        return reply.status(404).send({ error: 'Service non trouvé' });
      }

      return reply.send({
        ...service,
        implemented: !!REGISTERED_SERVICES[service.service_id],
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération du service' });
    }
  });

  /**
   * POST /field-services
   * Crée un nouveau service dans le registre.
   */
  fastify.post<{ Body: unknown }>('/field-services', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const body = CreateFieldServiceSchema.parse(request.body);

      // Vérifier l'unicité du service_id
      const existing = await db
        .collection('field_services')
        .findOne({ service_id: body.service_id });
      if (existing) {
        return reply.status(409).send({
          error: `Un service avec l'identifiant "${body.service_id}" existe déjà`,
        });
      }

      const now = new Date().toISOString();
      const doc = { ...body, created_at: now, updated_at: now };
      const result = await db.collection('field_services').insertOne(doc);

      const created = await db
        .collection('field_services')
        .findOne({ _id: result.insertedId });

      return reply.status(201).send({
        ...created,
        implemented: !!REGISTERED_SERVICES[body.service_id],
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création du service' });
    }
  });

  /**
   * PUT /field-services/:id
   * Met à jour un service.
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>(
    '/field-services/:id',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { id } = request.params;

        if (!ObjectId.isValid(id)) {
          return reply.status(400).send({ error: 'ID invalide' });
        }

        const body = UpdateFieldServiceSchema.parse(request.body);

        // Si service_id change, vérifier l'unicité
        if (body.service_id) {
          const existing = await db.collection('field_services').findOne({
            service_id: body.service_id,
            _id: { $ne: new ObjectId(id) },
          });
          if (existing) {
            return reply.status(409).send({
              error: `Un service avec l'identifiant "${body.service_id}" existe déjà`,
            });
          }
        }

        const now = new Date().toISOString();
        const result = await db.collection('field_services').findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { ...body, updated_at: now } },
          { returnDocument: 'after' }
        );

        if (!result) {
          return reply.status(404).send({ error: 'Service non trouvé' });
        }

        return reply.send({
          ...result,
          implemented: !!REGISTERED_SERVICES[(result as any).service_id],
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la mise à jour du service' });
      }
    }
  );

  /**
   * DELETE /field-services/:id
   * Supprime un service du registre.
   * Attention : les templates qui référencent ce service_id ne seront pas modifiés automatiquement.
   */
  fastify.delete<{ Params: { id: string } }>('/field-services/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const result = await db
        .collection('field_services')
        .deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Service non trouvé' });
      }

      return reply.status(204).send();
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la suppression du service' });
    }
  });
}
