import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';

export default async function inspirationsRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;

  /**
   * GET /guides/:guideId/inspirations
   * Récupère les inspirations avec leurs POIs assignés
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/inspirations',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const inspirationsDoc = await db.collection('inspirations').findOne({ guide_id: guideId });

        if (!inspirationsDoc) {
          return reply.send({ inspirations: [] });
        }

        return reply.send({
          inspirations: inspirationsDoc.inspirations || [],
        });
      } catch (error: any) {
        console.error('❌ [Inspirations] Erreur récupération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la récupération',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /guides/:guideId/inspirations
   * Sauvegarde/met à jour les inspirations et leurs POIs assignés
   */
  fastify.post<{
    Params: { guideId: string };
    Body: { inspirations: any[] };
  }>(
    '/guides/:guideId/inspirations',
    async (request, reply) => {
      const { guideId } = request.params;
      const { inspirations } = request.body;

      try {
        console.log(`💾 [Inspirations] Sauvegarde ${inspirations.length} inspiration(s) pour guide ${guideId}`);

        await db.collection('inspirations').updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              inspirations,
              updated_at: new Date(),
            },
            $setOnInsert: {
              created_at: new Date(),
            },
          },
          { upsert: true }
        );

        console.log('✅ [Inspirations] Sauvegarde réussie');

        return reply.send({
          success: true,
          inspirations,
        });
      } catch (error: any) {
        console.error('❌ [Inspirations] Erreur sauvegarde:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la sauvegarde',
          details: error.message,
        });
      }
    }
  );
}
