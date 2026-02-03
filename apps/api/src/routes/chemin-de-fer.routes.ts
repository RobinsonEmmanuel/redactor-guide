import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
  CreateCheminDeFerSchema,
  UpdateCheminDeFerSchema,
  CreatePageSchema,
  UpdatePageSchema,
  CreateSectionSchema,
} from '@redactor-guide/core-model';

export async function cheminDeFerRoutes(fastify: FastifyInstance) {
  /**
   * GET /chemins-de-fer
   * Liste tous les chemins de fer
   */
  fastify.get('/chemins-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const cheminsDeFer = await db
        .collection('chemins_de_fer')
        .find({})
        .sort({ created_at: -1 })
        .toArray();

      return reply.send(cheminsDeFer);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des chemins de fer' });
    }
  });

  /**
   * GET /chemins-de-fer/:id
   * Récupère un chemin de fer avec ses pages
   */
  fastify.get<{ Params: { id: string } }>('/chemins-de-fer/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ _id: new ObjectId(id) });

      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      // Récupérer les pages du chemin de fer
      const pages = await db
        .collection('pages')
        .find({ chemin_de_fer_id: id })
        .sort({ ordre: 1 })
        .toArray();

      // Récupérer les sections
      const sections = await db
        .collection('sections')
        .find({ chemin_de_fer_id: id })
        .sort({ ordre: 1 })
        .toArray();

      return reply.send({
        ...cheminDeFer,
        pages,
        sections,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération du chemin de fer' });
    }
  });

  /**
   * POST /chemins-de-fer
   * Crée un nouveau chemin de fer
   */
  fastify.post<{ Body: unknown }>('/chemins-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const body = CreateCheminDeFerSchema.parse(request.body);

      const now = new Date().toISOString();
      const cheminDeFer = {
        ...body,
        nombre_pages: 0,
        created_at: now,
        updated_at: now,
      };

      const result = await db.collection('chemins_de_fer').insertOne(cheminDeFer);
      const created = await db.collection('chemins_de_fer').findOne({ _id: result.insertedId });

      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création du chemin de fer' });
    }
  });

  /**
   * PUT /chemins-de-fer/:id
   * Met à jour un chemin de fer
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>('/chemins-de-fer/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      const body = UpdateCheminDeFerSchema.parse(request.body);
      const now = new Date().toISOString();

      const result = await db.collection('chemins_de_fer').findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { ...body, updated_at: now } },
        { returnDocument: 'after' }
      );

      if (!result) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la mise à jour' });
    }
  });

  /**
   * DELETE /chemins-de-fer/:id
   * Supprime un chemin de fer et toutes ses pages
   */
  fastify.delete<{ Params: { id: string } }>('/chemins-de-fer/:id', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;

      if (!ObjectId.isValid(id)) {
        return reply.status(400).send({ error: 'ID invalide' });
      }

      // Supprimer les pages associées
      await db.collection('pages').deleteMany({ chemin_de_fer_id: id });
      
      // Supprimer les sections associées
      await db.collection('sections').deleteMany({ chemin_de_fer_id: id });

      // Supprimer le chemin de fer
      const result = await db.collection('chemins_de_fer').deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      return reply.status(204).send();
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la suppression' });
    }
  });

  /**
   * POST /chemins-de-fer/:id/pages
   * Ajoute une page au chemin de fer
   */
  fastify.post<{ Params: { id: string }; Body: unknown }>('/chemins-de-fer/:id/pages', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { id } = request.params;
      const body = CreatePageSchema.parse(request.body);

      // Vérifier que le template existe
      if (!ObjectId.isValid(body.template_id)) {
        return reply.status(400).send({ error: 'Template ID invalide' });
      }

      const template = await db.collection('templates').findOne({ _id: new ObjectId(body.template_id) });
      if (!template) {
        return reply.status(404).send({ error: 'Template non trouvé' });
      }

      const now = new Date().toISOString();
      const page = {
        ...body,
        chemin_de_fer_id: id,
        template_name: template.name,
        created_at: now,
        updated_at: now,
      };

      const result = await db.collection('pages').insertOne(page);
      const created = await db.collection('pages').findOne({ _id: result.insertedId });

      // Mettre à jour le compteur de pages
      await db.collection('chemins_de_fer').updateOne(
        { _id: new ObjectId(id) },
        { $inc: { nombre_pages: 1 }, $set: { updated_at: now } }
      );

      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création de la page' });
    }
  });

  /**
   * PUT /chemins-de-fer/:id/pages/:pageId
   * Met à jour une page
   */
  fastify.put<{ Params: { id: string; pageId: string }; Body: unknown }>(
    '/chemins-de-fer/:id/pages/:pageId',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const body = UpdatePageSchema.parse(request.body);
        const now = new Date().toISOString();

        const result = await db.collection('pages').findOneAndUpdate(
          { _id: new ObjectId(pageId) },
          { $set: { ...body, updated_at: now } },
          { returnDocument: 'after' }
        );

        if (!result) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la mise à jour' });
      }
    }
  );

  /**
   * DELETE /chemins-de-fer/:id/pages/:pageId
   * Supprime une page
   */
  fastify.delete<{ Params: { id: string; pageId: string } }>(
    '/chemins-de-fer/:id/pages/:pageId',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { id, pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const result = await db.collection('pages').deleteOne({ _id: new ObjectId(pageId) });

        if (result.deletedCount === 0) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Mettre à jour le compteur
        const now = new Date().toISOString();
        await db.collection('chemins_de_fer').updateOne(
          { _id: new ObjectId(id) },
          { $inc: { nombre_pages: -1 }, $set: { updated_at: now } }
        );

        return reply.status(204).send();
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la suppression' });
      }
    }
  );

  /**
   * PUT /chemins-de-fer/:id/pages/reorder
   * Réorganise les pages (drag-and-drop)
   */
  fastify.put<{ Params: { id: string }; Body: { pages: Array<{ _id: string; ordre: number }> } }>(
    '/chemins-de-fer/:id/pages/reorder',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pages } = request.body;

        if (!Array.isArray(pages)) {
          return reply.status(400).send({ error: 'Format invalide' });
        }

        const now = new Date().toISOString();
        const bulkOps = pages.map((page) => ({
          updateOne: {
            filter: { _id: new ObjectId(page._id) },
            update: { $set: { ordre: page.ordre, updated_at: now } },
          },
        }));

        await db.collection('pages').bulkWrite(bulkOps);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la réorganisation' });
      }
    }
  );

  /**
   * POST /chemins-de-fer/:id/sections
   * Ajoute une section
   */
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/chemins-de-fer/:id/sections',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { id } = request.params;
        const body = CreateSectionSchema.parse(request.body);

        const now = new Date().toISOString();
        const section = {
          ...body,
          chemin_de_fer_id: id,
          created_at: now,
          updated_at: now,
        };

        const result = await db.collection('sections').insertOne(section);
        const created = await db.collection('sections').findOne({ _id: result.insertedId });

        return reply.status(201).send(created);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la création de la section' });
      }
    }
  );
}
