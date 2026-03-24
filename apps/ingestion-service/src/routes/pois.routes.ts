import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import { env } from '../config/env.js';
import { COLLECTIONS } from '../config/collections.js';

export async function poisRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;

  // ─── Helpers QStash ───────────────────────────────────────────────────────

  function getWorkerBaseUrl(): string | undefined {
    let url = env.INGEST_WORKER_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.API_URL;
    if (url && !url.startsWith('http')) url = `https://${url}`;
    return url;
  }

  async function enqueueWorker(workerPath: string, payload: object): Promise<{ ok: true } | { error: string }> {
    const qstashToken = env.QSTASH_TOKEN;
    const workerBaseUrl = getWorkerBaseUrl();
    if (!qstashToken || !workerBaseUrl) {
      return { error: 'QStash non configuré (QSTASH_TOKEN ou INGEST_WORKER_URL manquant)' };
    }
    const fullUrl = `${workerBaseUrl}/api/v1${workerPath}`;
    const res = await fetch(`https://qstash.upstash.io/v2/publish/${fullUrl}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Upstash-Retries': '0',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      return { error: `QStash error: ${err}` };
    }
    return { ok: true };
  }

  // ─── Trigger routes (step 3) ───────────────────────────────────────────────

  /**
   * POST /guides/:guideId/pois/generate
   * Déclenche l'extraction des POIs via QStash.
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/generate',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });

        const destination: string = guide.destination ?? guide.destinations?.[0] ?? '';
        const destinationFilter = destination
          ? { categories: { $regex: destination, $options: 'i' } }
          : {};
        const articlesCount = await db.collection(COLLECTIONS.articles_raw).countDocuments(destinationFilter);

        if (articlesCount === 0) {
          return reply.code(400).send({
            error: `Aucun article trouvé pour la destination "${destination}"`,
            message: 'Récupérez d\'abord les articles WordPress',
          });
        }

        const jobId = new ObjectId();
        await db.collection(COLLECTIONS.pois_generation_jobs).insertOne({
          _id: jobId,
          guide_id: guideId,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        });

        const result = await enqueueWorker('/workers/generate-pois', {
          guideId,
          jobId: jobId.toString(),
        });

        if ('error' in result) {
          await db.collection(COLLECTIONS.pois_generation_jobs).deleteOne({ _id: jobId });
          return reply.code(503).send({ error: result.error });
        }

        return reply.send({
          success: true,
          jobId: jobId.toString(),
          message: 'Génération des POIs lancée en arrière-plan',
        });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois/latest-job
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/latest-job',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const job = await db.collection(COLLECTIONS.pois_generation_jobs).findOne(
          {
            guide_id: guideId,
            status: { $in: ['extraction_complete', 'deduplicating', 'dedup_complete'] },
          },
          { sort: { created_at: -1 } }
        );
        if (!job) return reply.send({ job: null });
        return reply.send({
          job: {
            jobId: job._id.toString(),
            status: job.status,
            raw_count: job.raw_count || job.preview_pois?.length || 0,
            preview_pois: job.preview_pois || [],
            preview_batches: job.preview_batches || [],
            classification_log: job.classification_log || [],
            mono_count: job.mono_count ?? null,
            multi_count: job.multi_count ?? null,
            excluded_count: job.excluded_count ?? null,
            deduplicated_pois: job.deduplicated_pois || [],
            created_at: job.created_at,
            updated_at: job.updated_at,
          },
        });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois/job-status/:jobId
   */
  fastify.get<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/job-status/:jobId',
    async (request, reply) => {
      const { jobId } = request.params;
      try {
        if (!ObjectId.isValid(jobId)) return reply.code(400).send({ error: 'Job ID invalide' });
        const job = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({ _id: new ObjectId(jobId) });
        if (!job) return reply.code(404).send({ error: 'Job non trouvé' });
        return reply.send({
          status: job.status,
          count: job.count || 0,
          raw_count: job.raw_count || 0,
          progress: job.progress || null,
          preview_pois: job.preview_pois || [],
          preview_batches: job.preview_batches || [],
          classification_log: job.classification_log || [],
          mono_count: job.mono_count ?? null,
          multi_count: job.multi_count ?? null,
          excluded_count: job.excluded_count ?? null,
          deduplicated_pois: job.deduplicated_pois || [],
          error: job.error || null,
          created_at: job.created_at,
          updated_at: job.updated_at,
        });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/jobs/:jobId/deduplicate
   * Déclenche le dédoublonnage via QStash.
   */
  fastify.post<{ Params: { guideId: string; jobId: string } }>(
    '/guides/:guideId/pois/jobs/:jobId/deduplicate',
    async (request, reply) => {
      const { guideId, jobId } = request.params;
      try {
        if (!ObjectId.isValid(jobId)) return reply.code(400).send({ error: 'Job ID invalide' });
        const job = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({ _id: new ObjectId(jobId) });
        if (!job) return reply.code(404).send({ error: 'Job non trouvé' });
        const rawPois: any[] = job.preview_pois || [];
        if (rawPois.length === 0) return reply.code(400).send({ error: 'Aucun POI extrait à dédoublonner' });

        await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'deduplicating', updated_at: new Date() } }
        );

        const result = await enqueueWorker('/workers/deduplicate-pois', { guideId, jobId });

        if ('error' in result) {
          await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
            { _id: new ObjectId(jobId) },
            { $set: { status: 'extraction_complete', updated_at: new Date() } }
          );
          return reply.code(503).send({ error: result.error });
        }

        return reply.send({ success: true, message: 'Dédoublonnage lancé en arrière-plan' });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // ─── Worker routes (called by QStash — no API key required) ───────────────

  /**
   * POST /workers/generate-pois
   * Worker asynchrone : extrait les POIs depuis les articles WordPress.
   */
  fastify.post('/workers/generate-pois', async (request, reply) => {
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    try {
      console.log(`🚀 [WORKER] Génération POIs par batch pour guide ${guideId}`);

      const existingProcessing = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({
        guide_id: guideId,
        status: 'processing',
        _id: { $ne: new ObjectId(jobId) },
        updated_at: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      });
      if (existingProcessing) {
        await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'failed', error: 'Doublon : un job est déjà en cours', updated_at: new Date() } }
        );
        return reply.send({ success: false, reason: 'duplicate' });
      }

      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'processing', updated_at: new Date() } }
      );

      const openaiApiKey = env.OPENAI_API_KEY;
      if (!openaiApiKey) throw new Error('OPENAI_API_KEY non configurée');

      const { OpenAIService } = await import('../services/openai.service.js');
      const openaiService = new OpenAIService({ apiKey: openaiApiKey, model: 'gpt-5-mini', reasoningEffort: 'low' });

      const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      if (!guide) throw new Error('Guide non trouvé');

      const destination: string = guide.destination;
      if (!destination) throw new Error('Aucune destination définie pour ce guide');

      const destinationFilter = { categories: { $regex: destination, $options: 'i' } };
      const articles = await db
        .collection(COLLECTIONS.articles_raw)
        .find(destinationFilter)
        .project({ title: 1, slug: 1, markdown: 1, url: 1 })
        .toArray();

      if (articles.length === 0) {
        throw new Error(`Aucun article WordPress trouvé pour la destination "${destination}"`);
      }

      const PROMPT_ID_EXTRACTION = env.PROMPT_ID_POI_EXTRACTION ?? 'prompt_1770544848350_9j5m305ukj';
      const PROMPT_ID_DEDUP      = env.PROMPT_ID_POI_DEDUP      ?? 'deduplication_POI_24022026';

      const promptExtractionDoc = await db.collection(COLLECTIONS.prompts).findOne({ prompt_id: PROMPT_ID_EXTRACTION });
      if (!promptExtractionDoc) throw new Error(`Prompt d'extraction POI non trouvé (id: ${PROMPT_ID_EXTRACTION})`);

      function extractHeadings(markdown: string): string[] {
        return markdown
          .split('\n')
          .filter(line => /^#{2,3}\s/.test(line))
          .map(line => line.replace(/^#{2,3}\s+/, '').trim())
          .filter(h => h.length > 2);
      }

      const articleTitlesList = (articles as any[]).map((a: any, i: number) => `${i}. ${a.title}`).join('\n');

      const classificationSystemPrompt = `Tu es un expert en contenu touristique. Classifie chaque article dans l'une de ces 3 catégories :

- "mono" : l'article est entièrement consacré à UN SEUL lieu touristique précis et localisable. Le nom du lieu principal est dans le titre.
- "multi" : l'article présente ou liste PLUSIEURS lieux touristiques distincts
- "exclude" : l'article ne génère pas de POI pertinent pour un guide touristique. Exemples : hôtels/hébergements, transport, météo, guides pratiques généraux.

Pour les articles "mono", indique également le poi_name : le nom propre du lieu, sans les suffixes descriptifs.

Retourne STRICTEMENT un objet JSON valide, sans texte additionnel :
{ "classifications": [{ "index": 0, "type": "mono|multi|exclude", "poi_name": "string ou null", "reason": "explication courte" }] }`;

      let aiClassifications: Array<{ index: number; type: 'mono' | 'multi' | 'exclude'; poi_name: string | null; reason: string }> = [];

      try {
        const classifResult = await openaiService.generateJSON(
          `${classificationSystemPrompt}\n\nArticles à classifier :\n${articleTitlesList}`,
          8000
        );
        aiClassifications = (classifResult as any).classifications || [];
      } catch {
        aiClassifications = (articles as any[]).map((_: any, i: number) => ({
          index: i, type: 'multi' as const, poi_name: null, reason: 'fallback',
        }));
      }

      const monoArticles: any[] = [];
      const multiArticles: any[] = [];
      const excludedArticles: any[] = [];
      const classificationLog: any[] = [];

      for (let i = 0; i < (articles as any[]).length; i++) {
        const article = (articles as any[])[i];
        const classif = aiClassifications.find(c => c.index === i) || { type: 'multi', poi_name: null, reason: 'non classifié' };
        const headings = classif.type === 'multi' ? extractHeadings(article.markdown || '') : [];
        classificationLog.push({ title: article.title, url: article.url || article.slug, type: classif.type, reason: classif.reason, poiName: classif.poi_name || undefined, headingCount: headings.length || undefined });
        if (classif.type === 'mono') {
          monoArticles.push({ ...article, _poi_name: classif.poi_name || article.title, _classification: classif });
        } else if (classif.type === 'multi') {
          multiArticles.push({ ...article, _headings: headings, _classification: classif });
        } else {
          excludedArticles.push({ ...article, _classification: classif });
        }
      }

      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { classification_log: classificationLog, mono_count: monoArticles.length, multi_count: multiArticles.length, excluded_count: excludedArticles.length, updated_at: new Date() } }
      );

      const allRawPois: any[] = [];
      const previewBatches: any[] = [];

      for (const article of monoArticles) {
        const poiName = article._poi_name || article.title;
        allRawPois.push({
          poi_id: poiName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
          nom: poiName,
          type: 'site_naturel',
          article_source: article.title,
          url_source: article.url || article.slug,
          mentions: 'principale',
          raison_selection: `Article dédié : "${article.title}"`,
          autres_articles_mentions: [],
          _extraction_mode: 'mono',
        });
      }

      if (monoArticles.length > 0) {
        previewBatches.push({ batch_num: 0, total_batches: 0, label: `${monoArticles.length} articles mono-POI`, articles: monoArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug })), pois: allRawPois.filter(p => p._extraction_mode === 'mono'), is_mono_batch: true });
        await db.collection(COLLECTIONS.pois_generation_jobs).updateOne({ _id: new ObjectId(jobId) }, { $set: { preview_pois: [...allRawPois], preview_batches: [...previewBatches], updated_at: new Date() } });
      }

      function normalizePoisFromResult(result: any): any[] | null {
        if (!result || typeof result !== 'object') return null;
        if (Array.isArray(result.pois)) return result.pois;
        if (Array.isArray(result)) return result;
        if (Array.isArray(result.articles)) {
          const flat: any[] = [];
          for (const art of result.articles) {
            const subPois = art.pois || art.lieux || art.points_of_interest;
            if (Array.isArray(subPois)) subPois.forEach((p: any) => flat.push({ ...p, article_source: p.article_source || art.title || art.slug || '', url_source: p.url_source || art.url || art.slug || '' }));
          }
          return flat.length > 0 ? flat : [];
        }
        const values = Object.values(result);
        if (values.length > 0 && values.every(v => Array.isArray(v))) {
          const flat: any[] = [];
          for (const [slug, pois] of Object.entries(result)) {
            (pois as any[]).forEach((p: any) => flat.push({ ...p, article_source: p.article_source || slug, url_source: p.url_source || slug }));
          }
          return flat.length > 0 ? flat : [];
        }
        return null;
      }

      const BATCH_SIZE = 5;
      const total = multiArticles.length;
      const totalBatches = Math.ceil(total / BATCH_SIZE);

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchNum = batchIdx + 1;

        const currentJob = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({ _id: new ObjectId(jobId) });
        if (!currentJob || currentJob.status === 'cancelled') {
          return reply.send({ success: false, reason: 'cancelled' });
        }

        const batchArticles = multiArticles.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE) as any[];
        await db.collection(COLLECTIONS.pois_generation_jobs).updateOne({ _id: new ObjectId(jobId) }, { $set: { status: 'processing', progress: `Batch ${batchNum}/${totalBatches}`, updated_at: new Date() } });

        const validArticles = batchArticles.filter((a: any) => (a.markdown || '').trim());
        if (validArticles.length === 0) continue;

        const articleByTitle: Record<string, any> = {};
        const articleByUrl: Record<string, any> = {};
        for (const a of validArticles) {
          articleByTitle[a.title.toLowerCase()] = a;
          if (a.url) articleByUrl[a.url] = a;
          if (a.slug) articleByUrl[a.slug] = a;
        }

        const GENERIC = /^(introduction|présentation|conseils|conseil|pratique|infos?|FAQ|résumé|conclusion|en bref|contact|accès|horaire|tarif|prix|comment|pourquoi|où|quand|notre avis|notre sélection|pour aller plus loin|autres|suite)/i;
        const h2h3PerArticle = validArticles.map((a: any, idx: number) => {
          const headings = extractHeadings(a.markdown || '');
          const poiCandidates = headings.filter(h => !GENERIC.test(h.trim()) && h.trim().length > 3);
          return `Article ${idx + 1}: "${a.title}" (URL: ${a.url || a.slug})\nTitres H2/H3 candidats POI:\n${poiCandidates.map(h => `  • ${h}`).join('\n') || '  (aucun titre POI identifié)'}`;
        }).join('\n\n');

        const extractionPrompt = `Tu es un expert en sélection touristique pour des guides de voyage.

Destination : ${destination}

Pour chaque article ci-dessous, extrais UNIQUEMENT les lieux touristiques réels (POI) à partir des titres H2/H3.

Règles :
- Un POI est un lieu précis et localisable : musée, site naturel, plage, village, monument, panorama, jardin, etc.
- IGNORER les sections génériques et hébergements/restaurants
- article_source = titre de l'article source
- url_source = URL de l'article source

Articles :
${h2h3PerArticle}

Retourne STRICTEMENT un JSON valide sans texte additionnel :
{ "pois": [ { "poi_id": "slug_unique", "nom": "Nom du POI", "type": "musée|site_culturel|village|ville|plage|site_naturel|panorama|quartier|autre", "article_source": "titre", "url_source": "url", "mentions": "principale", "raison_selection": "max 120 car.", "autres_articles_mentions": [] } ] }`;

        let batchSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (attempt > 1) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
            const result = await openaiService.generateJSON(extractionPrompt, 24000);
            const rawList = normalizePoisFromResult(result);

            const poisList = rawList === null ? null : rawList.map((p: any) => ({
              poi_id: p.poi_id || p.id || p.slug || (p.nom || p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              nom: p.nom || p.name || p.titre || p.label || '',
              type: p.type || p.category || p.categorie || 'autre',
              article_source: p.article_source || p.source || '',
              url_source: p.url_source || p.url || '',
              mentions: p.mentions || 'principale',
              raison_selection: p.raison_selection || p.reason || '',
              autres_articles_mentions: p.autres_articles_mentions || [],
            })).filter((p: any) => p.nom);

            if (poisList === null) throw new Error(`Format JSON non reconnu`);

            if (poisList.length === 0) {
              previewBatches.push({ batch_num: batchNum, total_batches: totalBatches, label: `Batch ${batchNum}/${totalBatches}`, articles: validArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug })), pois: [] });
              batchSuccess = true;
              break;
            }

            const enriched = poisList.map((poi: any) => {
              const isBatchTitle = !poi.article_source || poi.article_source.startsWith('Batch ') || poi.article_source.startsWith('Lot de ');
              if (isBatchTitle || !poi.url_source) {
                const matchByUrl = poi.url_source && articleByUrl[poi.url_source];
                const matchByTitle = poi.article_source && validArticles.find((a: any) => a.title.toLowerCase().includes(poi.article_source.toLowerCase().substring(0, 20)));
                const fallback = matchByUrl || matchByTitle || validArticles[0];
                return { ...poi, article_source: isBatchTitle ? fallback.title : poi.article_source, url_source: poi.url_source && !isBatchTitle ? poi.url_source : (fallback.url || fallback.slug) };
              }
              return poi;
            });
            const enrichedWithMode = enriched.map((p: any) => ({ ...p, _extraction_mode: 'multi' }));
            allRawPois.push(...enrichedWithMode);

            previewBatches.push({ batch_num: batchNum, total_batches: totalBatches, label: `Batch ${batchNum}/${totalBatches}`, articles: validArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug, headings: extractHeadings(a.markdown || '') })), pois: enrichedWithMode });
            await db.collection(COLLECTIONS.pois_generation_jobs).updateOne({ _id: new ObjectId(jobId) }, { $set: { preview_pois: allRawPois, preview_batches: previewBatches, updated_at: new Date() } });
            batchSuccess = true;
            break;
          } catch (batchError: any) {
            if (attempt === 3) console.error(`  ⛔ Batch ${batchNum} abandonné: ${batchError.message}`);
          }
        }

        if (!batchSuccess) console.warn(`  ⚠️ Batch ${batchNum} ignoré`);
      }

      if (allRawPois.length === 0) throw new Error('Aucun POI extrait depuis les articles');

      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'extraction_complete', raw_count: allRawPois.length, preview_pois: allRawPois, progress: null, updated_at: new Date() } }
      );

      return reply.send({ success: true, raw_count: allRawPois.length, articles_processed: total, status: 'extraction_complete' });

    } catch (error: any) {
      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'failed', error: error.message, progress: null, updated_at: new Date() } }
      ).catch(() => {});
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /workers/deduplicate-pois
   * Worker asynchrone : dédoublonne les POIs extraits.
   */
  fastify.post('/workers/deduplicate-pois', async (request, reply) => {
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    function normalizeName(s: string): string {
      return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function levenshtein(a: string, b: string): number {
      const m = a.length, n = b.length;
      const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
      return d[m][n];
    }

    function isArticleDedicatedToPoi(articleSource: string, poiNom: string): boolean {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const slugWords = norm(articleSource.replace(/-/g, ' '));
      const keywords = norm(poiNom).split(' ').filter((w: string) => w.length >= 4);
      if (keywords.length === 0) return false;
      const matchCount = keywords.filter((kw: string) => slugWords.includes(kw)).length;
      return matchCount >= Math.ceil(keywords.length * 0.6);
    }

    function deduplicateAlgorithmically(pois: any[]): { pois: any[]; groups: string[][] } {
      const norms = pois.map(p => normalizeName(p.nom));
      const n = pois.length;
      const parent = Array.from({ length: n }, (_, i) => i);

      function find(i: number): number { if (parent[i] !== i) parent[i] = find(parent[i]); return parent[i]; }
      function union(i: number, j: number) { parent[find(i)] = find(j); }

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const ni = norms[i], nj = norms[j];
          if (ni === nj) { union(i, j); continue; }
          const maxLen = Math.max(ni.length, nj.length);
          const threshold = maxLen <= 10 ? 1 : 2;
          if (levenshtein(ni, nj) <= threshold) { union(i, j); continue; }
          const firstWordI = ni.split(' ').find((w: string) => w.length >= 4) ?? '';
          const firstWordJ = nj.split(' ').find((w: string) => w.length >= 4) ?? '';
          if (firstWordI && firstWordI === firstWordJ && (ni.includes(nj) || nj.includes(ni))) union(i, j);
        }
      }

      const groups: Map<number, number[]> = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(i);
      }

      const fusedPois: any[] = [];
      const fusionGroups: string[][] = [];

      for (const members of groups.values()) {
        let repIdx = members[0];
        for (const idx of members) {
          if (pois[idx].article_source && isArticleDedicatedToPoi(pois[idx].article_source, pois[idx].nom)) { repIdx = idx; break; }
        }
        if (repIdx === members[0]) {
          const sorted = [...members].sort((a, b) => pois[a].nom.length - pois[b].nom.length);
          repIdx = sorted[0];
        }
        const rep = pois[repIdx];
        const allMentions = new Set<string>([...(rep.autres_articles_mentions || [])]);
        for (const idx of members) {
          if (idx === repIdx) continue;
          const dup = pois[idx];
          if (dup.article_source && dup.article_source !== rep.article_source) allMentions.add(dup.article_source);
          if (dup.url_source && dup.url_source !== rep.url_source) allMentions.add(dup.url_source);
          (dup.autres_articles_mentions || []).forEach((m: string) => allMentions.add(m));
        }
        if (rep.article_source) allMentions.delete(rep.article_source);
        if (rep.url_source) allMentions.delete(rep.url_source);
        fusedPois.push({ ...rep, autres_articles_mentions: Array.from(allMentions) });
        if (members.length > 1) fusionGroups.push(members.map((idx: number) => pois[idx].nom));
      }

      return { pois: fusedPois, groups: fusionGroups };
    }

    try {
      const job = await db.collection(COLLECTIONS.pois_generation_jobs).findOne({ _id: new ObjectId(jobId) });
      if (!job) throw new Error(`Job ${jobId} introuvable`);

      const rawPois: any[] = job.preview_pois || [];
      if (rawPois.length === 0) throw new Error('Aucun POI à dédoublonner');

      const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      const destination: string = guide?.destination ?? '';

      const { pois: afterAlgo, groups: algoGroups } = deduplicateAlgorithmically(rawPois);
      const removedAlgo = rawPois.length - afterAlgo.length;
      if (algoGroups.length > 0) algoGroups.slice(0, 20).forEach(g => console.log(`  ↳ fusionné : ${g.join(' | ')}`));

      const openaiApiKey = env.OPENAI_API_KEY;
      if (!openaiApiKey) throw new Error('OPENAI_API_KEY non configurée');

      const { OpenAIService } = await import('../services/openai.service.js');
      const openaiService = new OpenAIService({ apiKey: openaiApiKey, model: 'gpt-5-mini', reasoningEffort: 'medium' });

      const compactList = afterAlgo.map((p: any, i: number) => `${i}|${p.nom} (${p.type})`).join('\n');
      const dedupGroupsPrompt = `Tu es un expert en consolidation de données touristiques.
Destination : ${destination}
Voici ${afterAlgo.length} POIs numérotés (format: numéro|nom (type)) :

${compactList}

MISSION : Identifie UNIQUEMENT les groupes de doublons.

FUSIONNER si : noms en langues différentes, variantes orthographiques, même lieu avec/sans article.
NE PAS FUSIONNER : deux lieux distincts, en cas de doute.

Retourne UNIQUEMENT ce JSON (sans markdown) :
{ "groupes": [ { "indices": [3, 17], "garder": 3, "raison": "même lieu" } ] }

Si aucun doublon : retourne { "groupes": [] }`;

      const groupsResult = await openaiService.generateJSON(dedupGroupsPrompt, 4000);
      let dedupPois: any[] = [...afterAlgo];

      if (groupsResult.groupes && Array.isArray(groupsResult.groupes) && groupsResult.groupes.length > 0) {
        const toRemove = new Set<number>();
        for (const group of groupsResult.groupes) {
          const indices: number[] = group.indices ?? [];
          const keepIdx: number = group.garder ?? indices[0];
          if (!Number.isInteger(keepIdx) || keepIdx < 0 || keepIdx >= afterAlgo.length) continue;
          const keeper = afterAlgo[keepIdx];
          const allMentions = new Set<string>(keeper.autres_articles_mentions || []);
          for (const idx of indices) {
            if (idx === keepIdx || !Number.isInteger(idx) || idx < 0 || idx >= afterAlgo.length) continue;
            const dup = afterAlgo[idx];
            if (dup.article_source && dup.article_source !== keeper.article_source) allMentions.add(dup.article_source);
            (dup.autres_articles_mentions || []).forEach((m: string) => allMentions.add(m));
            toRemove.add(idx);
          }
          dedupPois[keepIdx] = { ...keeper, autres_articles_mentions: Array.from(allMentions).filter(m => m !== keeper.article_source), alias_names: indices.filter(i => i !== keepIdx && Number.isInteger(i) && i >= 0 && i < afterAlgo.length).map(i => afterAlgo[i].nom), dedup_confidence: group.raison ? 'certain' : 'probable' };
        }
        dedupPois = dedupPois.filter((_: any, i: number) => !toRemove.has(i));
      }

      const removedLLM = afterAlgo.length - dedupPois.length;
      const totalRemoved = rawPois.length - dedupPois.length;

      // Phase 3 : sélection du meilleur article par comptage d'occurrences
      const guideLangForDedup = guide?.language || 'fr';
      const articleCache: Record<string, any> = {};
      const getArticle = async (slugOrSource: string): Promise<any | null> => {
        if (articleCache[slugOrSource] !== undefined) return articleCache[slugOrSource];
        const art = await db.collection(COLLECTIONS.articles_raw).findOne({ $or: [{ slug: slugOrSource }, { title: slugOrSource }] }, { projection: { slug: 1, title: 1, markdown: 1, urls_by_lang: 1 } });
        articleCache[slugOrSource] = art ?? null;
        return articleCache[slugOrSource];
      };

      const normalizeText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const countOccurrences = (text: string, term: string): number => {
        if (!text || !term) return 0;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = text.match(new RegExp(escaped, 'gi'));
        return matches ? matches.length : 0;
      };

      let bestUrlUpdated = 0;
      for (let i = 0; i < dedupPois.length; i++) {
        const poi = dedupPois[i];
        const mentions: string[] = poi.autres_articles_mentions || [];
        if (mentions.length === 0) continue;
        const poiNom = normalizeText(poi.nom || '');
        const candidates = [poi.article_source, ...mentions].filter(Boolean) as string[];
        let bestSource = poi.article_source, bestUrl = poi.url_source || null, bestCount = -1;
        for (const candidate of candidates) {
          const art = await getArticle(candidate);
          if (!art) continue;
          const artUrl = art.urls_by_lang?.[guideLangForDedup] ?? art.urls_by_lang?.['fr'] ?? null;
          if (!artUrl) continue;
          const count = countOccurrences(normalizeText(art.markdown || art.title || ''), poiNom);
          if (count > bestCount) { bestCount = count; bestSource = candidate; bestUrl = artUrl; }
        }
        if (bestSource !== poi.article_source && bestUrl) {
          const newMentions = new Set<string>(mentions);
          if (poi.article_source) newMentions.add(poi.article_source);
          newMentions.delete(bestSource);
          dedupPois[i] = { ...poi, article_source: bestSource, url_source: bestUrl, autres_articles_mentions: Array.from(newMentions) };
          bestUrlUpdated++;
        }
      }

      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'dedup_complete', deduplicated_pois: dedupPois, dedup_count: dedupPois.length, dedup_algo_removed: removedAlgo, dedup_llm_removed: removedLLM, updated_at: new Date() } }
      );

      return reply.send({ success: true, dedup_count: dedupPois.length, removed: totalRemoved, removed_algo: removedAlgo, removed_llm: removedLLM });

    } catch (error: any) {
      await db.collection(COLLECTIONS.pois_generation_jobs).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'extraction_complete', error_dedup: error.message, updated_at: new Date() } }
      ).catch(() => {});
      return reply.status(500).send({ error: error.message });
    }
  });
}
