import { randomUUID, createDecipheriv, createCipheriv, randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { COLLECTIONS } from '../config/collections.js';
import { getArticlesDatabase } from '../config/database.js';
import { extractImageUrls, normalizeImageUrl, htmlToMarkdown } from '@redactor-guide/ingestion-wp';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';
import type { Db } from 'mongodb';

// Nouveau format : jwtToken et siteUrl sont optionnels — résolus depuis site_connections + sites
const IngestBodySchema = z.object({
  siteId:         z.string().min(1, 'siteId requis'),
  destinationIds: z.array(z.string()).default([]),
  siteUrl:        z.string().url().optional(),
  jwtToken:       z.string().optional(), // déprécié, ignoré si credentials en base
  languages:      z.array(z.string()).default(['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt', 'nl']),
  analyzeImages:  z.boolean().default(false),
});

const SyncTranslationsBodySchema = z.object({
  siteId:    z.string().min(1, 'siteId requis'),
  siteUrl:   z.string().url().optional(),
  jwtToken:  z.string().optional(),
  languages: z.array(z.string()).min(1, 'Au moins une langue cible requise'),
});

/**
 * Résout les credentials WordPress depuis site_connections.
 * Retourne { siteUrl, authHeader } prêts à l'emploi.
 */
async function resolveCredentials(
  db: Db,
  siteId: string,
  fallbackSiteUrl?: string,
  fallbackJwt?: string
): Promise<{ siteUrl: string; authHeader: string }> {
  // 1. Récupérer l'URL du site
  let siteUrl = fallbackSiteUrl;
  if (!siteUrl) {
    const site = await db.collection(COLLECTIONS.sites).findOne(
      { $or: [{ _id: siteId as unknown as import('mongodb').ObjectId }, { slug: siteId }] }
    );
    if (!site?.url) throw new Error(`Site introuvable pour siteId="${siteId}"`);
    siteUrl = (site.url as string).replace(/\/$/, '');
  }

  // 2. Chercher les credentials stockés
  const conn = await db.collection(COLLECTIONS.site_connections).findOne(
    { $or: [{ site_id: siteId }, { siteId }] },
    { sort: { updated_at: -1 } }
  );

  if (conn?.username && (conn.appPasswordEncrypted || conn.app_password_enc)) {
    const enc = (conn.appPasswordEncrypted ?? conn.app_password_enc) as string;
    const appPassword = decryptAppPassword(enc);
    const b64 = Buffer.from(`${conn.username}:${appPassword}`).toString('base64');
    return { siteUrl, authHeader: `Basic ${b64}` };
  }

  // 3. Fallback JWT (ancien format)
  if (fallbackJwt) return { siteUrl, authHeader: `Bearer ${fallbackJwt}` };

  throw new Error(`Aucun credentials trouvé pour siteId="${siteId}". Connectez le site d'abord.`);
}

/**
 * Déchiffrement AES-256-GCM des App Passwords WordPress.
 * Le secret est dans WP_CREDENTIALS_SECRET (même clé que le service de production).
 */
function decryptAppPassword(encrypted: string): string {
  const secret = process.env.WP_CREDENTIALS_SECRET;
  if (!secret) {
    // Si pas de clé de déchiffrement, on suppose que c'est stocké en clair (dev)
    return encrypted;
  }
  try {
    const buf = Buffer.from(encrypted, 'base64');
    const iv  = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const key = Buffer.from(secret, 'hex').subarray(0, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    // En dev, la clé peut être absente — retourner en clair
    return encrypted;
  }
}

/** État de la progression de l'ingestion en cours (singleton in-memory). */
type JobStatus = 'idle' | 'fetching' | 'processing' | 'translations' | 'done' | 'error';
const currentJob: {
  status: JobStatus;
  step: string;
  processed: number;
  total: number;
  startedAt: number;
  error?: string;
} = { status: 'idle', step: '', processed: 0, total: 0, startedAt: 0 };

export async function ingestRoutes(fastify: FastifyInstance) {
  const db = fastify.mongo.db!;
  // articles_raw vit dans service-redaction (même logique que apps/api)
  const articlesDb = getArticlesDatabase();
  const wpService = new WordPressIngestionService(articlesDb);

  /**
   * GET /ingest/progress
   * Retourne la progression de l'ingestion en cours.
   */
  fastify.get('/ingest/progress', async (_request, reply) => {
    return reply.status(200).send({ ...currentJob });
  });

  /**
   * POST /ingest
   * Lance l'ingestion en synchrone (petits volumes / dev).
   */
  fastify.post('/ingest', async (request, reply) => {
    try {
      const body = IngestBodySchema.parse(request.body);
      const { siteUrl, authHeader } = await resolveCredentials(db, body.siteId, body.siteUrl, body.jwtToken);

      let analysisPrompt: string | undefined;
      if (body.analyzeImages) {
        const promptDoc = await db.collection(COLLECTIONS.prompts).findOne({
          intent: 'analyse_image',
          actif: true,
        });
        if (!promptDoc) {
          return reply.status(400).send({
            error: 'Prompt analyse_image introuvable',
            message: 'Veuillez créer un prompt avec intent "analyse_image" et actif=true',
          });
        }
        analysisPrompt = promptDoc.texte_prompt as string;
      }

      // Initialiser la progression
      Object.assign(currentJob, {
        status: 'fetching',
        step: 'Récupération des articles depuis WordPress…',
        processed: 0,
        total: 0,
        startedAt: Date.now(),
        error: undefined,
      });

      const result = await wpService.ingestArticlesToRaw(
        body.siteId,
        body.destinationIds,
        siteUrl,
        authHeader,
        body.languages,
        analysisPrompt,
        body.analyzeImages,
        (processed, total, step) => {
          currentJob.processed = processed;
          currentJob.total     = total;
          currentJob.status    = step === 'fetched' ? 'fetching' : 'processing';
          currentJob.step      = step === 'fetched'
            ? `${total} articles récupérés, traitement en cours…`
            : `Traitement de l'article ${processed} / ${total}`;
        }
      );

      Object.assign(currentJob, { status: 'done', step: `${result.count} articles traités.` });

      return reply.status(200).send({
        success: true,
        count: result.count,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      Object.assign(currentJob, {
        status: 'error',
        step: 'Erreur lors de l\'ingestion',
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erreur ingestion',
      });
    }
  });

  /**
   * POST /ingest/enqueue
   * Enregistre un job et publie vers QStash.
   */
  fastify.post('/ingest/enqueue', async (request, reply) => {
    const token = env.QSTASH_TOKEN;
    const workerUrl = env.INGEST_WORKER_URL?.trim() || undefined;
    if (!token || !workerUrl) {
      return reply.status(503).send({
        error: 'Queue non disponible',
        message: 'QSTASH_TOKEN et INGEST_WORKER_URL doivent être configurés.',
      });
    }
    try {
      const body = IngestBodySchema.parse(request.body);
      // Résolution anticipée pour valider les credentials avant d'enqueuer
      const { siteUrl, authHeader } = await resolveCredentials(db, body.siteId, body.siteUrl, body.jwtToken);
      const jobId = randomUUID();
      const now = new Date();
      await db.collection(COLLECTIONS.ingest_jobs).insertOne({
        jobId,
        siteId:         body.siteId,
        destinationIds: body.destinationIds,
        siteUrl,
        languages:      body.languages,
        analyzeImages:  body.analyzeImages,
        status:         'queued',
        createdAt:      now,
        updatedAt:      now,
      });

      const runUrl = workerUrl.replace(/\/$/, '') + '/api/v1/ingest/run';
      const res = await fetch(`https://qstash.upstash.io/v2/publish/${runUrl}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Upstash-Retries': '3',
        },
        body: JSON.stringify({
          jobId,
          siteId:         body.siteId,
          destinationIds: body.destinationIds,
          siteUrl,
          authHeader,
          languages:      body.languages,
          analyzeImages:  body.analyzeImages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        await db.collection(COLLECTIONS.ingest_jobs).updateOne(
          { jobId },
          { $set: { status: 'failed', error: `QStash: ${res.status} ${errText}`, updatedAt: new Date() } }
        );
        return reply.status(502).send({ error: 'Échec envoi file d\'attente', message: errText || res.statusText });
      }

      return reply.status(202).send({ jobId, status: 'queued' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Erreur enqueue' });
    }
  });

  /**
   * GET /ingest/status/:jobId
   */
  fastify.get<{ Params: { jobId: string } }>('/ingest/status/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const job = await db.collection(COLLECTIONS.ingest_jobs).findOne({ jobId });
    if (!job) return reply.status(404).send({ error: 'Job introuvable' });
    const out: Record<string, unknown> = { status: job.status };
    if (job.result) out.result = job.result;
    if (job.error) out.error = job.error;
    return reply.send(out);
  });

  /**
   * POST /ingest/sync-translations
   */
  fastify.post('/ingest/sync-translations', async (request, reply) => {
    try {
      const body = SyncTranslationsBodySchema.parse(request.body);
      const { siteUrl, authHeader } = await resolveCredentials(db, body.siteId, body.siteUrl, body.jwtToken);
      const result = await wpService.syncTranslationUrls(
        body.siteId,
        siteUrl,
        authHeader,
        body.languages
      );
      return reply.status(200).send({
        success: true,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Erreur sync-translations' });
    }
  });

  /**
   * POST /ingest/single-url
   * Ingère un article WordPress unique depuis son URL publique.
   */
  fastify.post('/ingest/single-url', async (request, reply) => {
    try {
      const body = z.object({
        siteId:         z.string().min(1),
        siteUrl:        z.string().url().optional(),
        jwtToken:       z.string().optional(),
        articleUrl:     z.string().url(),
        destinationIds: z.array(z.string()).default([]),
      }).parse(request.body);
      const { siteUrl: resolvedSiteUrl, authHeader } = await resolveCredentials(db, body.siteId, body.siteUrl, body.jwtToken);

      const urlParsed = new URL(body.articleUrl);
      const slug = urlParsed.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
      if (!slug) {
        return reply.status(400).send({ error: `Impossible d'extraire le slug depuis : ${body.articleUrl}` });
      }

      const wpApiUrl = `${resolvedSiteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&lang=fr&per_page=1`;
      const wpRes = await fetch(wpApiUrl, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(20_000),
      });

      if (!wpRes.ok) {
        return reply.status(502).send({ error: `WordPress API: ${wpRes.status} pour le slug "${slug}"` });
      }

      const posts = await wpRes.json() as any[];
      if (posts.length === 0) {
        return reply.status(404).send({
          error: `Article introuvable dans WordPress pour le slug "${slug}". Vérifiez que l'article est publié.`,
        });
      }

      const post = posts[0];
      const htmlContent: string = post.content?.rendered ?? '';

      const rawImageUrls = extractImageUrls(htmlContent);
      const seenNormalized = new Map<string, string>();
      const imageUrls: string[] = [];
      for (const url of rawImageUrls) {
        const n = normalizeImageUrl(url);
        if (!seenNormalized.has(n)) { seenNormalized.set(n, url); imageUrls.push(url); }
      }

      const urlsByLang: Record<string, string> = { fr: post.link };
      const LOCALE_MAP: Record<string, string> = {
        pt_PT: 'pt-pt', pt_BR: 'pt-br',
        fr: 'fr', en: 'en', it: 'it', es: 'es',
        de: 'de', da: 'da', sv: 'sv', nl: 'nl',
      };
      for (const t of (post.wpml_translations ?? []) as any[]) {
        if (!t.href) continue;
        const prefix = (t.locale as string).split('_')[0].toLowerCase();
        const lang = LOCALE_MAP[t.locale as string] ?? LOCALE_MAP[prefix] ?? null;
        if (lang && lang !== 'fr') urlsByLang[lang] = t.href as string;
      }

      let categoryNames: string[] = [];
      if ((post.categories as number[] | undefined)?.length) {
        try {
          const catRes = await fetch(
            `${resolvedSiteUrl}/wp-json/wp/v2/categories?include=${(post.categories as number[]).join(',')}&per_page=100`,
            { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000) }
          );
          if (catRes.ok) {
            const cats = await catRes.json() as any[];
            categoryNames = cats.map((c: any) => c.name as string).filter(Boolean);
          }
        } catch { /* non bloquant */ }
      }

      const articleDoc = {
        site_id:         body.siteId,
        destination_ids: body.destinationIds,
        slug:            post.slug as string,
        wp_id:           post.id as number,
        title:           (post.title?.rendered ?? '') as string,
        html_brut:       htmlContent,
        markdown:        htmlToMarkdown(htmlContent),
        categories:      categoryNames,
        tags:            [] as string[],
        urls_by_lang:    urlsByLang,
        images:          imageUrls,
        updated_at:      new Date((post.modified || post.date) as string),
      };

      const result = await db.collection(COLLECTIONS.articles_raw).updateOne(
        { 'urls_by_lang.fr': articleDoc.urls_by_lang.fr },
        { $set: articleDoc },
        { upsert: true }
      );

      const wasInserted = result.upsertedCount > 0;
      const wasUpdated  = result.modifiedCount > 0;

      // Résolution des URLs de traduction via redirects WPML
      const TRANSLATION_LANGS = ['it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];
      const wpId = post.id as number;
      const frUrl = articleDoc.urls_by_lang.fr;

      const translationSets = await Promise.allSettled(
        TRANSLATION_LANGS.map(async (lang) => {
          try {
            const langApiUrl = `${resolvedSiteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&lang=${lang}&per_page=1&_fields=id,link`;
            const langRes = await fetch(langApiUrl, {
              headers: { Authorization: authHeader },
              signal: AbortSignal.timeout(8_000),
            });
            if (langRes.ok) {
              const langPosts = await langRes.json() as any[];
              if (langPosts.length > 0 && langPosts[0].link && !langPosts[0].link.includes('?p=')) {
                return { lang, url: langPosts[0].link as string };
              }
            }
          } catch { /* essai suivant */ }

          try {
            const redirectUrl = `${resolvedSiteUrl}/?p=${wpId}&lang=${lang}`;
            const resp = await fetch(redirectUrl, { redirect: 'follow', signal: AbortSignal.timeout(6_000) });
            const finalUrl = resp.url;
            if (resp.status < 400 && finalUrl && !finalUrl.includes('?p=') && finalUrl !== frUrl) {
              return { lang, url: finalUrl };
            }
          } catch { /* ignore */ }

          return null;
        })
      );

      const resolvedLangs: Record<string, string> = {};
      for (const res of translationSets) {
        if (res.status === 'fulfilled' && res.value) {
          resolvedLangs[res.value.lang] = res.value.url;
        }
      }

      if (Object.keys(resolvedLangs).length > 0) {
        const setFields: Record<string, string> = {};
        for (const [lang, url] of Object.entries(resolvedLangs)) {
          setFields[`urls_by_lang.${lang}`] = url;
          urlsByLang[lang] = url;
        }
        await db.collection(COLLECTIONS.articles_raw).updateOne(
          { 'urls_by_lang.fr': frUrl },
          { $set: setFields }
        );
      }

      return reply.status(200).send({
        success:     true,
        title:       articleDoc.title,
        slug:        articleDoc.slug,
        inserted:    wasInserted,
        updated:     wasUpdated,
        imagesCount: imageUrls.length,
        langs:       Object.keys(urlsByLang),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Erreur ingestion article' });
    }
  });

  /**
   * POST /ingest/run
   * Appelé par QStash. Pas de vérification X-Api-Key (signée par QStash).
   */
  fastify.post('/ingest/run', async (request, reply) => {
    try {
      const body = IngestBodySchema.extend({
        jobId:      z.string().uuid(),
        authHeader: z.string().optional(), // passé par enqueue, prioritaire sur jwtToken
      }).parse(request.body as object);
      const { jobId, authHeader: bodyAuthHeader, ...ingestPayload } = body;

      const updated = await db.collection(COLLECTIONS.ingest_jobs).findOneAndUpdate(
        { jobId, status: 'queued' },
        { $set: { status: 'processing', updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!updated) {
        const existing = await db.collection(COLLECTIONS.ingest_jobs).findOne({ jobId });
        if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
          return reply.status(200).send({ ok: true, status: existing.status });
        }
        return reply.status(404).send({ error: 'Job introuvable ou déjà en cours' });
      }

      // authHeader peut venir du payload QStash ou être résolu depuis les credentials
      const effectiveAuth = bodyAuthHeader
        ?? (await resolveCredentials(db, ingestPayload.siteId, ingestPayload.siteUrl, ingestPayload.jwtToken)).authHeader;
      const effectiveSiteUrl = ingestPayload.siteUrl
        ?? (await resolveCredentials(db, ingestPayload.siteId)).siteUrl;

      const result = await wpService.ingestArticlesToRaw(
        ingestPayload.siteId,
        ingestPayload.destinationIds,
        effectiveSiteUrl,
        effectiveAuth,
        ingestPayload.languages
      );

      await db.collection(COLLECTIONS.ingest_jobs).updateOne(
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
        await db.collection(COLLECTIONS.ingest_jobs).updateOne(
          { jobId },
          { $set: { status: 'failed', error: errMessage, updatedAt: new Date() } }
        );
      }
      return reply.status(500).send({ error: errMessage });
    }
  });

  // ── Gestion des connexions WordPress (credentials) ─────────────────────────

  function encryptAppPassword(plain: string): string {
    const secret = process.env.WP_CREDENTIALS_SECRET;
    if (!secret) return plain; // dev : stockage en clair si pas de clé
    const iv = randomBytes(12);
    const key = Buffer.from(secret, 'hex').subarray(0, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  /**
   * GET /user/sites
   * Liste les sites avec leur statut de connexion.
   */
  fastify.get('/user/sites', async (_request, reply) => {
    try {
      const sites = await db.collection(COLLECTIONS.sites).find({}).toArray();
      const connections = await db.collection(COLLECTIONS.site_connections).find({}).toArray();

      const connMap = new Map<string, any>();
      for (const c of connections) {
        connMap.set(String(c.site_id), c);
        connMap.set(String(c.siteId), c);
      }

      const result = sites.map((s: any) => {
        const conn = connMap.get(String(s._id)) ?? connMap.get(String(s.slug));
        return {
          _id:         String(s._id),
          slug:        s.slug,
          name:        s.name ?? s.slug,
          url:         s.url,
          hasPassword: Boolean(conn?.appPasswordEncrypted ?? conn?.appPassword),
          username:    conn?.username ?? null,
        };
      });

      return reply.status(200).send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /user/sites/:siteId/connect
   * Stocke ou met à jour les credentials WordPress chiffrés.
   */
  fastify.post('/user/sites/:siteId/connect', async (request, reply) => {
    try {
      const { siteId } = request.params as { siteId: string };
      const body = z.object({
        username:    z.string().min(1, 'username requis'),
        appPassword: z.string().min(1, 'appPassword requis'),
        siteUrl:     z.string().url().optional(),
      }).parse(request.body);

      const encrypted = encryptAppPassword(body.appPassword);
      const now = new Date();

      // Upsert dans site_connections
      await db.collection(COLLECTIONS.site_connections).updateOne(
        { $or: [{ site_id: siteId }, { siteId }] },
        {
          $set: {
            site_id:              siteId,
            username:             body.username,
            appPasswordEncrypted: encrypted,
            updated_at:           now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );

      // Mettre à jour l'URL du site si fournie
      if (body.siteUrl) {
        await db.collection(COLLECTIONS.sites).updateOne(
          { $or: [{ _id: siteId as unknown as import('mongodb').ObjectId }, { slug: siteId }] },
          { $set: { url: body.siteUrl, updated_at: now } }
        );
      }

      // Récupérer le nom du site pour la réponse
      const site = await db.collection(COLLECTIONS.sites).findOne(
        { $or: [{ _id: siteId as unknown as import('mongodb').ObjectId }, { slug: siteId }] }
      );

      return reply.status(200).send({
        success: true,
        site: { name: (site?.name as string) ?? siteId, slug: siteId },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Données invalides', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /ingest/dedup
   * Supprime les doublons dans articles_raw.
   * Garde le document le plus complet (avec html_brut non vide) par URL française.
   * En cas d'égalité, garde le plus récent (updated_at).
   */
  fastify.post('/ingest/dedup', async (_request, reply) => {
    try {
      const col = articlesDb.collection('articles_raw');

      // Trouver tous les groupes de doublons par URL française
      // (couvrir les deux formats : urls_by_lang.fr et wp_source.post_url)
      const pipeline = [
        {
          $addFields: {
            _frUrl: {
              $ifNull: ['$urls_by_lang.fr', '$wp_source.post_url'],
            },
          },
        },
        {
          $match: { _frUrl: { $ne: null, $ne: '' } },
        },
        {
          $group: {
            _id: '$_frUrl',
            count: { $sum: 1 },
            docs: {
              $push: {
                _id: '$_id',
                hasHtml: { $cond: [{ $and: [{ $ne: ['$html_brut', null] }, { $ne: ['$html_brut', ''] }] }, 1, 0] },
                updatedAt: { $ifNull: ['$updated_at', new Date(0)] },
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ];

      const groups = await col.aggregate(pipeline).toArray();

      let totalDeleted = 0;
      const idsToDelete: import('mongodb').ObjectId[] = [];

      for (const group of groups) {
        const docs: Array<{ _id: import('mongodb').ObjectId; hasHtml: number; updatedAt: Date }> = group.docs;

        // Trier : html_brut en premier, puis updated_at desc
        docs.sort((a, b) => {
          if (b.hasHtml !== a.hasHtml) return b.hasHtml - a.hasHtml;
          const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
          const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
          return tb - ta;
        });

        // Garder le premier, supprimer le reste
        for (let i = 1; i < docs.length; i++) {
          idsToDelete.push(docs[i]._id);
        }
      }

      if (idsToDelete.length > 0) {
        const deleteResult = await col.deleteMany({ _id: { $in: idsToDelete } });
        totalDeleted = deleteResult.deletedCount;
      }

      return reply.status(200).send({
        success: true,
        duplicateGroups: groups.length,
        deleted: totalDeleted,
        message: `${totalDeleted} doublon(s) supprimé(s) sur ${groups.length} groupe(s) détectés.`,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });
}
