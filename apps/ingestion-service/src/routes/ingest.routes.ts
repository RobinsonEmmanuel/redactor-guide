import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { COLLECTIONS } from '../config/collections.js';
import { extractImageUrls, normalizeImageUrl, htmlToMarkdown } from '@redactor-guide/ingestion-wp';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';

const IngestBodySchema = z.object({
  siteId: z.string().min(1, 'siteId requis'),
  destinationIds: z.array(z.string()).default([]),
  siteUrl: z.string().url(),
  jwtToken: z.string().min(1, 'jwtToken requis'),
  languages: z.array(z.string()).default(['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt', 'nl']),
  analyzeImages: z.boolean().default(false),
});

const SyncTranslationsBodySchema = z.object({
  siteId: z.string().min(1, 'siteId requis'),
  siteUrl: z.string().url(),
  jwtToken: z.string().min(1, 'jwtToken requis'),
  languages: z.array(z.string()).min(1, 'Au moins une langue cible requise'),
});

export async function ingestRoutes(fastify: FastifyInstance) {
  const db = fastify.mongo.db!;
  const wpService = new WordPressIngestionService(db);

  /**
   * POST /ingest
   * Lance l'ingestion en synchrone (petits volumes / dev).
   */
  fastify.post('/ingest', async (request, reply) => {
    try {
      const body = IngestBodySchema.parse(request.body);

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

      const result = await wpService.ingestArticlesToRaw(
        body.siteId,
        body.destinationIds,
        body.siteUrl,
        body.jwtToken,
        body.languages,
        analysisPrompt,
        body.analyzeImages
      );

      return reply.status(200).send({
        success: true,
        count: result.count,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
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
      const jobId = randomUUID();
      const now = new Date();
      await db.collection(COLLECTIONS.ingest_jobs).insertOne({
        jobId,
        siteId: body.siteId,
        destinationIds: body.destinationIds,
        siteUrl: body.siteUrl,
        jwtToken: body.jwtToken,
        languages: body.languages,
        analyzeImages: body.analyzeImages,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
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
          siteId: body.siteId,
          destinationIds: body.destinationIds,
          siteUrl: body.siteUrl,
          jwtToken: body.jwtToken,
          languages: body.languages,
          analyzeImages: body.analyzeImages,
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
      const result = await wpService.syncTranslationUrls(
        body.siteId,
        body.siteUrl,
        body.jwtToken,
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
        siteUrl:        z.string().url(),
        jwtToken:       z.string().min(1),
        articleUrl:     z.string().url(),
        destinationIds: z.array(z.string()).default([]),
      }).parse(request.body);

      const urlParsed = new URL(body.articleUrl);
      const slug = urlParsed.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
      if (!slug) {
        return reply.status(400).send({ error: `Impossible d'extraire le slug depuis : ${body.articleUrl}` });
      }

      const wpApiUrl = `${body.siteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&lang=fr&per_page=1`;
      const wpRes = await fetch(wpApiUrl, {
        headers: { Authorization: `Bearer ${body.jwtToken}` },
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
            `${body.siteUrl}/wp-json/wp/v2/categories?include=${(post.categories as number[]).join(',')}&per_page=100`,
            { headers: { Authorization: `Bearer ${body.jwtToken}` }, signal: AbortSignal.timeout(10_000) }
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
            const langApiUrl = `${body.siteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&lang=${lang}&per_page=1&_fields=id,link`;
            const langRes = await fetch(langApiUrl, {
              headers: { Authorization: `Bearer ${body.jwtToken}` },
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
            const redirectUrl = `${body.siteUrl}/?p=${wpId}&lang=${lang}`;
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
      const body = IngestBodySchema.extend({ jobId: z.string().uuid() }).parse(request.body as object);
      const { jobId, ...ingestPayload } = body;

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

      const result = await wpService.ingestArticlesToRaw(
        ingestPayload.siteId,
        ingestPayload.destinationIds,
        ingestPayload.siteUrl,
        ingestPayload.jwtToken,
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
}
