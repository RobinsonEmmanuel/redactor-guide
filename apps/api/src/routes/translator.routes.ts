import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { env } from '../config/env';
import { COLLECTIONS } from '../config/collections.js';

export default async function translatorRoutes(fastify: FastifyInstance) {
  /**
   * POST /translator/translate
   * Lance la traduction d'un JSON (via worker)
   */
  fastify.post('/translator/translate', async (request, reply) => {
    const db = request.server.container.db;
    const { jsonData } = request.body as { jsonData: any };

    if (!jsonData) {
      return reply.code(400).send({ error: 'JSON data manquant' });
    }

    try {
      // Créer un job de traduction
      const job = await db.collection(COLLECTIONS.translation_jobs).insertOne({
        status: 'pending',
        input_json: jsonData,
        output_json: null,
        stats: null,
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const jobId = job.insertedId.toString();

      // Lancer le worker via QStash
      const qstashToken = env.QSTASH_TOKEN;
      const workerUrl = env.INGEST_WORKER_URL || 'https://redactor-guide-production.up.railway.app';
      
      if (!qstashToken) {
        return reply.code(500).send({ error: 'QStash non configuré' });
      }

      const fullWorkerUrl = `${workerUrl}/api/v1/workers/translate-json`;
      
      console.log(`📤 [QStash] Envoi job traduction ${jobId}`);

      const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${fullWorkerUrl}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Retries': '2',
        },
        body: JSON.stringify({ jobId }),
      });

      if (!qstashRes.ok) {
        const errorText = await qstashRes.text();
        console.error('❌ [QStash] Erreur:', errorText);
        throw new Error(`QStash error: ${errorText}`);
      }

      console.log('✅ [QStash] Job envoyé');

      return reply.send({
        success: true,
        jobId,
        message: 'Traduction lancée en arrière-plan',
      });
    } catch (error: any) {
      console.error('❌ Erreur lancement traduction:', error);
      return reply.code(500).send({
        error: 'Erreur lors du lancement de la traduction',
        details: error.message,
      });
    }
  });

  /**
   * GET /translator/status/:jobId
   * Vérifie le statut d'un job de traduction
   */
  fastify.get<{ Params: { jobId: string } }>(
    '/translator/status/:jobId',
    async (request, reply) => {
      const { jobId } = request.params;
      const db = request.server.container.db;

      if (!ObjectId.isValid(jobId)) {
        return reply.code(400).send({ error: 'Job ID invalide' });
      }

      const job = await db.collection(COLLECTIONS.translation_jobs).findOne({
        _id: new ObjectId(jobId),
      });

      if (!job) {
        return reply.code(404).send({ error: 'Job non trouvé' });
      }

      return reply.send({
        jobId,
        status: job.status,
        stats: job.stats,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
      });
    }
  );

  /**
   * GET /translator/result/:jobId
   * Récupère le JSON traduit
   */
  fastify.get<{ Params: { jobId: string } }>(
    '/translator/result/:jobId',
    async (request, reply) => {
      const { jobId } = request.params;
      const db = request.server.container.db;

      if (!ObjectId.isValid(jobId)) {
        return reply.code(400).send({ error: 'Job ID invalide' });
      }

      const job = await db.collection(COLLECTIONS.translation_jobs).findOne({
        _id: new ObjectId(jobId),
      });

      if (!job) {
        return reply.code(404).send({ error: 'Job non trouvé' });
      }

      if (job.status !== 'completed') {
        return reply.code(400).send({
          error: `Job pas encore terminé (status: ${job.status})`,
        });
      }

      return reply.send({
        jobId,
        translatedJson: job.output_json,
        stats: job.stats,
      });
    }
  );
}
