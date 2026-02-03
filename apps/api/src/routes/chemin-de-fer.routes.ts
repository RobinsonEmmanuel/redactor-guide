import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
  UpdateCheminDeFerSchema,
  CreatePageSchema,
  UpdatePageSchema,
  CreateSectionSchema,
} from '@redactor-guide/core-model';

export async function cheminDeFerRoutes(fastify: FastifyInstance) {
  /**
   * GET /guides/:guideId/chemin-de-fer
   * Récupère le chemin de fer d'un guide avec ses pages
   */
  fastify.get<{ Params: { guideId: string } }>('/guides/:guideId/chemin-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });

      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

      // Récupérer les pages du chemin de fer
      const pages = await db
        .collection('pages')
        .find({ chemin_de_fer_id: cheminDeFerId })
        .sort({ ordre: 1 })
        .toArray();

      // Récupérer les sections
      const sections = await db
        .collection('sections')
        .find({ chemin_de_fer_id: cheminDeFerId })
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
   * PUT /guides/:guideId/chemin-de-fer
   * Met à jour le chemin de fer d'un guide
   */
  fastify.put<{ Params: { guideId: string }; Body: unknown }>('/guides/:guideId/chemin-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      const body = UpdateCheminDeFerSchema.parse(request.body);
      const now = new Date().toISOString();

      const result = await db.collection('chemins_de_fer').findOneAndUpdate(
        { guide_id: guideId },
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
   * POST /guides/:guideId/chemin-de-fer/pages
   * Ajoute une page au chemin de fer
   */
  fastify.post<{ Params: { guideId: string }; Body: unknown }>('/guides/:guideId/chemin-de-fer/pages', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;
      const body = CreatePageSchema.parse(request.body);

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      // Récupérer le chemin de fer
      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

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
        chemin_de_fer_id: cheminDeFerId,
        template_name: template.name,
        created_at: now,
        updated_at: now,
      };

      const result = await db.collection('pages').insertOne(page);
      const created = await db.collection('pages').findOne({ _id: result.insertedId });

      // Mettre à jour le compteur de pages
      await db.collection('chemins_de_fer').updateOne(
        { _id: cheminDeFer._id },
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
   * PUT /guides/:guideId/chemin-de-fer/pages/:pageId
   * Met à jour une page
   */
  fastify.put<{ Params: { guideId: string; pageId: string }; Body: unknown }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId',
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
   * DELETE /guides/:guideId/chemin-de-fer/pages/:pageId
   * Supprime une page
   */
  fastify.delete<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { guideId, pageId } = request.params;

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
          { guide_id: guideId },
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
   * PUT /guides/:guideId/chemin-de-fer/pages/reorder
   * Réorganise les pages (drag-and-drop)
   */
  fastify.put<{ Params: { guideId: string }; Body: { pages: Array<{ _id: string; ordre: number }> } }>(
    '/guides/:guideId/chemin-de-fer/pages/reorder',
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
   * POST /guides/:guideId/chemin-de-fer/sections
   * Ajoute une section
   */
  fastify.post<{ Params: { guideId: string }; Body: unknown }>(
    '/guides/:guideId/chemin-de-fer/sections',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { guideId } = request.params;
        const body = CreateSectionSchema.parse(request.body);

        // Récupérer le chemin de fer
        const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
        if (!cheminDeFer) {
          return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
        }

        const now = new Date().toISOString();
        const section = {
          ...body,
          chemin_de_fer_id: cheminDeFer._id.toString(),
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

  /**
   * GET /guides/:guideId/chemin-de-fer/pages/:pageId/content
   * Récupère le contenu rédactionnel d'une page
   */
  fastify.get<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/content',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const page = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });

        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send({ content: page.content || {} });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la récupération du contenu' });
      }
    }
  );

  /**
   * PUT /guides/:guideId/chemin-de-fer/pages/:pageId/content
   * Met à jour le contenu rédactionnel d'une page
   */
  fastify.put<{ Params: { guideId: string; pageId: string }; Body: { content: Record<string, any> } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/content',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;
        const { content } = request.body;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const now = new Date().toISOString();

        const result = await db.collection('pages').findOneAndUpdate(
          { _id: new ObjectId(pageId) },
          {
            $set: {
              content,
              updated_at: now,
            },
          },
          { returnDocument: 'after' }
        );

        if (!result) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send({ success: true, content: result.content });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la sauvegarde du contenu' });
      }
    }
  );

  /**
   * POST /guides/:guideId/chemin-de-fer/generate-sommaire
   * Lancer la génération automatique du sommaire via IA
   */
  fastify.post('/guides/:guideId/chemin-de-fer/generate-sommaire', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const db = request.server.container.db;

    // Vérifier que le guide existe
    const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
    if (!guide) {
      return reply.code(404).send({ error: 'Guide non trouvé' });
    }

    // Vérifier qu'il y a des articles
    const articlesCount = await db.collection('articles_raw').countDocuments({ guide_id: guideId });
    if (articlesCount === 0) {
      return reply.code(400).send({ error: 'Aucun article WordPress récupéré pour ce guide' });
    }

    // Vérifier qu'une destination est définie
    if (!guide.destination) {
      return reply.code(400).send({ error: 'Aucune destination définie pour ce guide' });
    }

    try {
      // Import dynamique des services
      const { OpenAIService } = await import('../services/openai.service');
      const { SommaireGeneratorService } = await import('../services/sommaire-generator.service');

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return reply.code(500).send({ error: 'OPENAI_API_KEY non configurée' });
      }

      const openaiService = new OpenAIService({
        apiKey: openaiApiKey,
        model: 'gpt-5-mini-2025-08-07',
        reasoningEffort: 'medium', // Raisonnement modéré pour équilibre qualité/coût
      });

      const sommaireGenerator = new SommaireGeneratorService({
        db,
        openaiService,
      });

      // Générer le sommaire (asynchrone)
      const proposal = await sommaireGenerator.generateSommaire(guideId);

      return {
        success: true,
        proposal,
      };
    } catch (error: any) {
      console.error('Erreur génération sommaire:', error);
      return reply.code(500).send({ error: error.message || 'Erreur lors de la génération' });
    }
  });

  /**
   * GET /guides/:guideId/chemin-de-fer/sommaire-proposal
   * Récupérer la dernière proposition de sommaire générée
   */
  fastify.get('/guides/:guideId/chemin-de-fer/sommaire-proposal', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const db = request.server.container.db;

    const proposal = await db.collection('sommaire_proposals').findOne({ guide_id: guideId });
    
    if (!proposal) {
      return reply.code(404).send({ error: 'Aucune proposition de sommaire trouvée' });
    }

    return { proposal: proposal.proposal, created_at: proposal.created_at, status: proposal.status };
  });
}
