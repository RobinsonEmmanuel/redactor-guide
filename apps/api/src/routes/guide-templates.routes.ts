import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ObjectId } from 'mongodb';
import {
  CreateGuideTemplateSchema,
  UpdateGuideTemplateSchema,
} from '@redactor-guide/core-model/schemas/guide-template.schema';

interface GuideTemplateIdParam {
  id: string;
}

export default async function guideTemplatesRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const db = fastify.mongo.db!;
  const guideTemplatesCollection = db.collection('guide_templates');

  /**
   * GET /guide-templates
   * Liste tous les templates de guides
   */
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const templates = await guideTemplatesCollection
        .find({})
        .sort({ is_default: -1, name: 1 })
        .toArray();

      return reply.status(200).send({
        templates,
        count: templates.length,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Erreur lors de la récupération des templates de guides',
      });
    }
  });

  /**
   * GET /guide-templates/:id
   * Récupère un template de guide par son ID
   */
  fastify.get(
    '/:id',
    async (
      request: FastifyRequest<{ Params: GuideTemplateIdParam }>,
      reply: FastifyReply
    ) => {
      try {
        const { id } = request.params;

        if (!ObjectId.isValid(id)) {
          return reply.status(400).send({ error: 'ID invalide' });
        }

        const template = await guideTemplatesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!template) {
          return reply.status(404).send({
            error: 'Template de guide non trouvé',
          });
        }

        return reply.status(200).send(template);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Erreur lors de la récupération du template',
        });
      }
    }
  );

  /**
   * POST /guide-templates
   * Crée un nouveau template de guide
   */
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Valider les données
      const validationResult = CreateGuideTemplateSchema.safeParse(request.body);

      if (!validationResult.success) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: validationResult.error.errors,
        });
      }

      const templateData = validationResult.data;

      // Vérifier que le slug est unique
      const existingTemplate = await guideTemplatesCollection.findOne({
        slug: templateData.slug,
      });

      if (existingTemplate) {
        return reply.status(409).send({
          error: 'Un template avec ce slug existe déjà',
        });
      }

      // Si is_default est true, retirer le flag des autres templates
      if (templateData.is_default) {
        await guideTemplatesCollection.updateMany(
          { is_default: true },
          { $set: { is_default: false, updated_at: new Date().toISOString() } }
        );
      }

      // Créer le template
      const now = new Date().toISOString();
      const newTemplate = {
        ...templateData,
        created_at: now,
        updated_at: now,
      };

      const result = await guideTemplatesCollection.insertOne(newTemplate);

      return reply.status(201).send({
        message: 'Template de guide créé avec succès',
        template_id: result.insertedId.toString(),
        template: {
          ...newTemplate,
          _id: result.insertedId,
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Erreur lors de la création du template',
      });
    }
  });

  /**
   * PATCH /guide-templates/:id
   * Met à jour un template de guide
   */
  fastify.patch(
    '/:id',
    async (
      request: FastifyRequest<{ Params: GuideTemplateIdParam }>,
      reply: FastifyReply
    ) => {
      try {
        const { id } = request.params;

        if (!ObjectId.isValid(id)) {
          return reply.status(400).send({ error: 'ID invalide' });
        }

        // Valider les données
        const validationResult = UpdateGuideTemplateSchema.safeParse(request.body);

        if (!validationResult.success) {
          return reply.status(400).send({
            error: 'Données invalides',
            details: validationResult.error.errors,
          });
        }

        const updateData = validationResult.data;

        // Si on change le slug, vérifier qu'il est unique
        if (updateData.slug) {
          const existingTemplate = await guideTemplatesCollection.findOne({
            slug: updateData.slug,
            _id: { $ne: new ObjectId(id) },
          });

          if (existingTemplate) {
            return reply.status(409).send({
              error: 'Un template avec ce slug existe déjà',
            });
          }
        }

        // Si is_default est true, retirer le flag des autres templates
        if (updateData.is_default) {
          await guideTemplatesCollection.updateMany(
            { _id: { $ne: new ObjectId(id) }, is_default: true },
            { $set: { is_default: false, updated_at: new Date().toISOString() } }
          );
        }

        // Mettre à jour le template
        const result = await guideTemplatesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updateData,
              updated_at: new Date().toISOString(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return reply.status(404).send({
            error: 'Template de guide non trouvé',
          });
        }

        return reply.status(200).send({
          message: 'Template de guide mis à jour avec succès',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Erreur lors de la mise à jour du template',
        });
      }
    }
  );

  /**
   * DELETE /guide-templates/:id
   * Supprime un template de guide
   */
  fastify.delete(
    '/:id',
    async (
      request: FastifyRequest<{ Params: GuideTemplateIdParam }>,
      reply: FastifyReply
    ) => {
      try {
        const { id } = request.params;

        if (!ObjectId.isValid(id)) {
          return reply.status(400).send({ error: 'ID invalide' });
        }

        // Vérifier qu'aucun guide n'utilise ce template
        const guidesUsingTemplate = await db.collection('guides').countDocuments({
          guide_template_id: id,
        });

        if (guidesUsingTemplate > 0) {
          return reply.status(409).send({
            error: `Impossible de supprimer ce template : ${guidesUsingTemplate} guide(s) l'utilisent`,
          });
        }

        const result = await guideTemplatesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return reply.status(404).send({
            error: 'Template de guide non trouvé',
          });
        }

        return reply.status(200).send({
          message: 'Template de guide supprimé avec succès',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Erreur lors de la suppression du template',
        });
      }
    }
  );
}
