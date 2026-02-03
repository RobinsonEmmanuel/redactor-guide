import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  Template,
} from '@redactor-guide/core-model';
import { ObjectId } from 'mongodb';

export async function templatesRoutes(fastify: FastifyInstance) {
  /**
   * GET /templates
   * Liste tous les templates
   */
  fastify.get('/templates', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const templates = await db
        .collection('templates')
        .find({})
        .sort({ name: 1 })
        .toArray();

      return reply.send(templates);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des templates' });
    }
  });

  /**
   * GET /templates/:id
   * Récupère un template par son ID
   */
  fastify.get<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const template = await db.collection('templates').findOne({ _id: new ObjectId(id) });

      if (!template) {
        return reply.status(404).send({ error: 'Template non trouvé' });
      }

      return reply.send(template);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération du template' });
    }
  });

  /**
   * POST /templates
   * Crée un nouveau template
   */
  fastify.post<{ Body: unknown }>('/templates', async (request, reply) => {
    try {
      const db = request.server.container.db;
      
      // Valider le body
      const body = CreateTemplateSchema.parse(request.body);

      // Vérifier que le nom n'existe pas déjà
      const existing = await db.collection('templates').findOne({ name: body.name });
      if (existing) {
        return reply.status(409).send({ error: `Un template avec le nom "${body.name}" existe déjà` });
      }

      // Valider que tous les champs respectent la convention de nommage
      for (const field of body.fields) {
        if (!field.name.startsWith(`${body.name}_`)) {
          return reply.status(400).send({
            error: `Le champ "${field.name}" ne commence pas par "${body.name}_"`,
          });
        }
      }

      // Créer le template
      const now = new Date().toISOString();
      const template: Omit<Template, '_id'> = {
        ...body,
        created_at: now,
        updated_at: now,
      };

      const result = await db.collection('templates').insertOne(template);

      const created = await db.collection('templates').findOne({ _id: result.insertedId });

      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création du template' });
    }
  });

  /**
   * PUT /templates/:id
   * Met à jour un template
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>('/templates/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      // Valider le body
      const body = UpdateTemplateSchema.parse(request.body);

      // Si le nom change, vérifier qu'il n'existe pas déjà
      if (body.name) {
        const existing = await db.collection('templates').findOne({
          name: body.name,
          _id: { $ne: new ObjectId(id) },
        });
        if (existing) {
          return reply.status(409).send({ error: `Un template avec le nom "${body.name}" existe déjà` });
        }
      }

      // Si les champs sont fournis, valider la convention de nommage
      if (body.fields) {
        const templateName = body.name || (await db.collection('templates').findOne({ _id: new ObjectId(id) }))?.name;
        if (!templateName) {
          return reply.status(404).send({ error: 'Template non trouvé' });
        }

        for (const field of body.fields) {
          if (!field.name.startsWith(`${templateName}_`)) {
            return reply.status(400).send({
              error: `Le champ "${field.name}" ne commence pas par "${templateName}_"`,
            });
          }
        }
      }

      // Mettre à jour
      const now = new Date().toISOString();
      const result = await db.collection('templates').findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { ...body, updated_at: now } },
        { returnDocument: 'after' }
      );

      if (!result) {
        return reply.status(404).send({ error: 'Template non trouvé' });
      }

      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la mise à jour du template' });
    }
  });

  /**
   * DELETE /templates/:id
   * Supprime un template
   */
  fastify.delete<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const result = await db.collection('templates').deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Template non trouvé' });
      }

      return reply.status(204).send();
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la suppression du template' });
    }
  });
}
