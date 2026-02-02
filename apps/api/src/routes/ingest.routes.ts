import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';

const IngestBodySchema = z.object({
  siteId: z.string().min(1, 'siteId requis'),
  destinationIds: z.array(z.string()).default([]),
  siteUrl: z.string().url(),
  jwtToken: z.string().min(1, 'jwtToken requis'),
});

const INGEST_JOBS = 'ingest_jobs';

export async function ingestRoutes(fastify: FastifyInstance) {
  const db = fastify.container.db;

  /**
   * POST /ingest
   * Lance l'ingestion en synchrone (petits volumes / dev).
   * En production avec gros volumes, préférer POST /ingest/enqueue.
   */
  fastify.post('/ingest', async (request, reply) => {
    try {
      const body = IngestBodySchema.parse(request.body);
      const wpService = fastify.container.getWordPressIngestionService();

      const result = await wpService.ingestArticlesToRaw(
        body.siteId,
        body.destinationIds,
        body.siteUrl,
        body.jwtToken
      );

      return reply.status(200).send({
        success: true,
        count: result.count,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors,
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erreur ingestion',
      });
    }
  });

  /**
   * POST /ingest/enqueue
   * Enregistre un job en base et publie vers QStash ; QStash appellera POST /ingest/run.
   * Renvoie 202 + jobId. Si QStash n’est pas configuré, renvoie 503.
   */
  fastify.post('/ingest/enqueue', async (request, reply) => {
    const token = env.QSTASH_TOKEN;
    const workerUrl = env.INGEST_WORKER_URL && env.INGEST_WORKER_URL.trim() ? env.INGEST_WORKER_URL.trim() : undefined;
    if (!token || !workerUrl) {
      return reply.status(503).send({
        error: 'Queue non disponible',
        message: 'QSTASH_TOKEN et INGEST_WORKER_URL doivent être configurés pour utiliser la file d’attente.',
      });
    }
    try {
      const body = IngestBodySchema.parse(request.body);
      const jobId = randomUUID();
      const now = new Date();
      await db.collection(INGEST_JOBS).insertOne({
        jobId,
        siteId: body.siteId,
        destinationIds: body.destinationIds,
        siteUrl: body.siteUrl,
        jwtToken: body.jwtToken,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });

      const runUrl = workerUrl.replace(/\/$/, '') + '/api/v1/ingest/run';
      const res = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(runUrl)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Upstash-Retries': '3',
        },
        body: JSON.stringify({
          jobId,
          siteId: body.siteId,
          destinationIds: body.destinationIds,
          siteUrl: body.siteUrl,
          jwtToken: body.jwtToken,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        fastify.log.warn({ status: res.status, body: errText }, 'QStash publish failed');
        await db.collection(INGEST_JOBS).updateOne(
          { jobId },
          { $set: { status: 'failed', error: `QStash: ${res.status} ${errText}`, updatedAt: new Date() } }
        );
        return reply.status(502).send({
          error: 'Échec de l’envoi vers la file d’attente',
          message: errText || res.statusText,
        });
      }

      return reply.status(202).send({ jobId, status: 'queued' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors,
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erreur enqueue',
      });
    }
  });

  /**
   * GET /ingest/status/:jobId
   * Retourne le statut d’un job (queued | processing | completed | failed).
   */
  fastify.get<{ Params: { jobId: string } }>('/ingest/status/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const job = await db.collection(INGEST_JOBS).findOne({ jobId });
    if (!job) {
      return reply.status(404).send({ error: 'Job introuvable' });
    }
    const out: { status: string; result?: { count: number; errors?: string[] }; error?: string } = {
      status: job.status as string,
    };
    if (job.result) out.result = job.result as { count: number; errors?: string[] };
    if (job.error) out.error = job.error as string;
    return reply.send(out);
  });

  /**
   * POST /ingest/run
   * Appelé par QStash avec le payload du job. Exécute l’ingestion et met à jour le statut.
   */
  fastify.post('/ingest/run', async (request, reply) => {
    try {
      const body = IngestBodySchema.extend({ jobId: z.string().uuid() }).parse(request.body as object);
      const { jobId, ...ingestPayload } = body;

      const updated = await db.collection(INGEST_JOBS).findOneAndUpdate(
        { jobId, status: 'queued' },
        { $set: { status: 'processing', updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!updated) {
        const existing = await db.collection(INGEST_JOBS).findOne({ jobId });
        if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
          return reply.status(200).send({ ok: true, status: existing.status });
        }
        return reply.status(404).send({ error: 'Job introuvable ou déjà en cours' });
      }

      const wpService = fastify.container.getWordPressIngestionService();
      const result = await wpService.ingestArticlesToRaw(
        ingestPayload.siteId,
        ingestPayload.destinationIds,
        ingestPayload.siteUrl,
        ingestPayload.jwtToken
      );

      await db.collection(INGEST_JOBS).updateOne(
        { jobId },
        {
          $set: {
            status: 'completed',
            result: { count: result.count, errors: result.errors.length > 0 ? result.errors : undefined },
            updatedAt: new Date(),
          },
        }
      );
      return reply.status(200).send({ ok: true, count: result.count });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      const errMessage = error instanceof Error ? error.message : 'Erreur ingestion';
      const jobId = typeof (request.body as any)?.jobId === 'string' ? (request.body as any).jobId : null;
      if (jobId) {
        await db.collection(INGEST_JOBS).updateOne(
          { jobId },
          { $set: { status: 'failed', error: errMessage, updatedAt: new Date() } }
        );
      }
      return reply.status(500).send({ error: errMessage });
    }
  });
}
