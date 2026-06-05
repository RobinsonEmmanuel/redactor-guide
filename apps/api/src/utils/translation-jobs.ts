import { Db, ObjectId } from 'mongodb';
import { COLLECTIONS } from '../config/collections.js';

/** Durée sans progression avant de considérer un job comme bloqué */
export const TRANSLATION_JOB_STALE_MS = 10 * 60 * 1000;

export interface TranslationJobDoc {
  _id?: ObjectId;
  status?: string;
  updated_at?: Date | string | null;
  created_at?: Date | string | null;
  progress?: { done?: number; total?: number } | null;
}

export function isTranslationJobStale(job: TranslationJobDoc | null | undefined): boolean {
  if (!job || job.status !== 'processing') return false;
  const ref = job.updated_at ?? job.created_at;
  if (!ref) return true;
  const ts = new Date(ref).getTime();
  return Number.isFinite(ts) && Date.now() - ts > TRANSLATION_JOB_STALE_MS;
}

export async function failTranslationJob(
  db: Db,
  jobId: ObjectId,
  error: string
): Promise<void> {
  await db.collection(COLLECTIONS.guide_translation_jobs).updateOne(
    { _id: jobId },
    { $set: { status: 'failed', error, updated_at: new Date() } }
  );
}

/** Marque en échec les jobs restés en processing après crash/OOM/redémarrage */
export async function recoverStaleTranslationJobs(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - TRANSLATION_JOB_STALE_MS);
  const result = await db.collection(COLLECTIONS.guide_translation_jobs).updateMany(
    {
      status: 'processing',
      $or: [
        { updated_at: { $lt: cutoff } },
        { updated_at: { $exists: false }, created_at: { $lt: cutoff } },
        { updated_at: null, created_at: { $lt: cutoff } },
      ],
    },
    {
      $set: {
        status: 'failed',
        error: 'Job interrompu — aucune progression récente (redémarrage serveur ou opération concurrente)',
        updated_at: new Date(),
      },
    }
  );
  return result.modifiedCount;
}
