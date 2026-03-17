import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import path from 'path';
import os from 'os';
import fs from 'fs';
import archiver from 'archiver';
import { ExportService } from '../services/export.service.js';
import { normalizeGuideExportV2, type NormalizerOptions } from '../services/normalize-export.service.js';
import { buildGuideStoryboard, resolveImagesForGuide, type StoryboardInputGuide, type GuideExportJson } from '@redactor-guide/exporters';

export async function exportRoutes(fastify: FastifyInstance) {
  const exportService = new ExportService();

  /**
   * GET /guides/:guideId/export
   * Génère le JSON d'export layout-ready pour InDesign
   * Query params:
   *   - lang: code langue (fr, en, de...) — défaut: fr
   *   - download: "true" pour forcer le téléchargement (Content-Disposition: attachment)
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: {
      lang?: string;
      download?: string;
      normalize?: string;
      drop_null_pictos?: string;
    };
  }>(
    '/guides/:guideId/export',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr', download, normalize, drop_null_pictos } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      try {
        const rawExport = await exportService.buildGuideExport(guideId, db, { language: lang });

        // Normalisation optionnelle (activée par défaut — passer ?normalize=false pour le JSON brut)
        const shouldNormalize = normalize !== 'false';
        const normalizerOptions: NormalizerOptions = {
          dropNullPictos: drop_null_pictos !== 'false',
        };
        const exportData = shouldNormalize
          ? normalizeGuideExportV2(rawExport as unknown as Record<string, unknown>, normalizerOptions)
          : rawExport;

        const dest = rawExport.meta.destination.toLowerCase().replace(/\s+/g, '_');
        const suffix = shouldNormalize ? '_normalized' : '_raw';
        const filename = `guide_${dest}_${rawExport.meta.year}_${lang}${suffix}.json`;

        if (download === 'true') {
          reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        }
        reply.header('Content-Type', 'application/json; charset=utf-8');

        return reply.send(exportData);
      } catch (error: any) {
        if (error.message === 'Guide non trouvé') {
          return reply.status(404).send({ error: 'Guide non trouvé' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la génération de l\'export' });
      }
    }
  );

  /**
   * GET /guides/:guideId/export/storyboard
   * Retourne le storyboard séquentiel complet prêt pour le renderer InDesign.
   * Pipeline : buildGuideExport → normalizeGuideExportV2 → buildGuideStoryboard
   * Query params:
   *   - lang: code langue (fr, en, de...) — défaut: fr
   *   - download: "true" pour forcer le téléchargement
   *   - drop_null_pictos: "false" pour conserver les pictos inactifs
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { lang?: string; download?: string; drop_null_pictos?: string };
  }>(
    '/guides/:guideId/export/storyboard',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr', download, drop_null_pictos } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      try {
        // ── 1. Export brut ──────────────────────────────────────────────────
        const rawExport = await exportService.buildGuideExport(guideId, db, { language: lang });

        // ── 2. Normalisation ────────────────────────────────────────────────
        const normalizerOptions: NormalizerOptions = {
          dropNullPictos: drop_null_pictos !== 'false',
        };
        const normalized = normalizeGuideExportV2(
          rawExport as unknown as Record<string, unknown>,
          normalizerOptions
        );

        // ── 3. Storyboard ───────────────────────────────────────────────────
        const storyboard = buildGuideStoryboard(normalized as unknown as StoryboardInputGuide);

        const dest     = rawExport.meta.destination.toLowerCase().replace(/\s+/g, '_');
        const filename = `storyboard_${dest}_${rawExport.meta.year}_${lang}.json`;

        if (download === 'true') {
          reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        }
        reply.header('Content-Type', 'application/json; charset=utf-8');

        return reply.send(storyboard);
      } catch (error: any) {
        if (error.message === 'Guide non trouvé') {
          return reply.status(404).send({ error: 'Guide non trouvé' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la génération du storyboard' });
      }
    }
  );

  /**
   * GET /guides/:guideId/export/zip
   * Génère un ZIP complet : JSON normalisé + toutes les images téléchargées.
   *
   * Structure du ZIP :
   *   guide_{destination}_{year}_{lang}.json
   *   images/
   *     poi/
   *       p001_poi_poi_image_1.jpg
   *       ...
   *     cluster/
   *       ...
   *
   * Query params:
   *   - lang             : code langue (défaut: fr)
   *   - drop_null_pictos : "false" pour conserver les pictos inactifs
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { lang?: string; drop_null_pictos?: string };
  }>(
    '/guides/:guideId/export/zip',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr', drop_null_pictos } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      // Répertoire temporaire unique par requête
      const tempDir = path.join(os.tmpdir(), `guide_zip_${guideId}_${Date.now()}`);

      try {
        // ── 1. Export brut ────────────────────────────────────────────────
        const rawExport = await exportService.buildGuideExport(guideId, db, { language: lang });

        // ── 2. Normalisation V2 ───────────────────────────────────────────
        const normOptions: NormalizerOptions = { dropNullPictos: drop_null_pictos !== 'false' };
        const normalized = normalizeGuideExportV2(
          rawExport as unknown as Record<string, unknown>,
          normOptions
        );

        // ── 3. Télécharger les images dans tempDir ────────────────────────
        // resolveImagesForGuide mute le JSON en remplissant le champ "local"
        const { guideJson: enriched, stats: imgStats } = await resolveImagesForGuide(
          normalized as unknown as GuideExportJson,
          tempDir,
          { concurrency: 5, skipExisting: false, logger: fastify.log as any }
        );

        fastify.log.info(
          `📸 Images : ${imgStats.downloaded} téléchargées, ${imgStats.failed} échec(s)`
        );

        // ── 4. Construire le nom des fichiers ─────────────────────────────
        const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const dest     = slugify(rawExport.meta.destination || rawExport.meta.guide_name || 'guide');
        const now      = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');          // YYYYMMDD
        const timePart = now.toISOString().slice(11, 16).replace(':', '');          // HHmm
        const jsonName = `guide_${dest}_${lang}_${datePart}_${timePart}.json`;
        const zipName  = `guide_${dest}_${lang}_${datePart}_${timePart}.zip`;

        // ── 5. Streamer le ZIP directement vers le client ─────────────────
        // reply.raw bypasse @fastify/cors → on injecte les headers CORS manuellement.
        const requestOrigin = request.headers.origin ?? '';
        const allowedOriginsPatterns: Array<string | RegExp> = [
          'http://localhost:3001',
          'http://localhost:3000',
          /^https:\/\/.*\.vercel\.app$/,
        ];
        const originAllowed = allowedOriginsPatterns.some(p =>
          typeof p === 'string' ? p === requestOrigin : p.test(requestOrigin)
        );
        if (originAllowed) {
          reply.raw.setHeader('Access-Control-Allow-Origin', requestOrigin);
          reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
          reply.raw.setHeader('Vary', 'Origin');
        }

        reply.raw.setHeader('Content-Type', 'application/zip');
        reply.raw.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 6 } });

        // Nettoyage après fermeture du stream
        reply.raw.on('finish', () => {
          fs.rmSync(tempDir, { recursive: true, force: true });
        });

        archive.on('error', (err) => {
          fastify.log.error(err, 'Erreur archiver ZIP');
          if (!reply.raw.headersSent) {
            reply.raw.destroy(err);
          }
        });

        archive.pipe(reply.raw);

        // JSON enrichi (avec champs "local" remplis)
        archive.append(JSON.stringify(enriched, null, 2), { name: jsonName });

        // CSV de redirections au format WP Engine bulk import :
        // source (chemin seul),destination (URL complète) — sans en-tête, une règle par ligne
        if (rawExport.redirectPairs && rawExport.redirectPairs.length > 0) {
          const csvLines: string[] = [];
          for (const pair of rawExport.redirectPairs) {
            const srcPath = (() => { try { return new URL(pair.normalized).pathname; } catch { return pair.normalized; } })();
            csvLines.push(`${srcPath},${pair.destination}`);
          }
          const csvName = `redirections_${dest}_${rawExport.meta.year}_${lang}.csv`;
          archive.append(csvLines.join('\n'), { name: csvName });
          fastify.log.info(`📋 Redirections WPEngine : ${rawExport.redirectPairs.length} règle(s) → ${csvName}`);
        }

        // Dossier images (preserve la structure images/poi/, images/cluster/…)
        const imagesDir = path.join(tempDir, 'images');
        if (fs.existsSync(imagesDir)) {
          archive.directory(imagesDir, 'images');
        }

        await archive.finalize();

        // Fastify ne doit pas gérer la réponse — on a streamé via reply.raw
        return reply;

      } catch (error: any) {
        // Nettoyage en cas d'erreur
        fs.rmSync(tempDir, { recursive: true, force: true });

        if (error.message === 'Guide non trouvé') {
          return reply.status(404).send({ error: 'Guide non trouvé' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la génération du ZIP' });
      }
    }
  );

  /**
   * GET /guides/:guideId/export/redirections.csv
   * Génère et télécharge uniquement le CSV de redirections (URL normalisée → URL destination).
   * Utile pour configurer les règles de redirection côté hébergeur sans télécharger le ZIP complet.
   *
   * Query params:
   *   - lang : code langue (défaut: fr)
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { lang?: string };
  }>(
    '/guides/:guideId/export/redirections.csv',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr' } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      try {
        const rawExport = await exportService.buildGuideExport(guideId, db, { language: lang });

        const dest    = rawExport.meta.destination.toLowerCase().replace(/\s+/g, '_');
        const csvName = `redirections_${dest}_${rawExport.meta.year}_${lang}.csv`;

        // Format WP Engine bulk import : chemin source,URL destination — sans en-tête
        const csvLines: string[] = [];
        for (const pair of rawExport.redirectPairs) {
          const srcPath = (() => { try { return new URL(pair.normalized).pathname; } catch { return pair.normalized; } })();
          csvLines.push(`${srcPath},${pair.destination}`);
        }
        const csvContent = csvLines.join('\n');

        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${csvName}"`);
        return reply.send(csvContent);
      } catch (error: any) {
        if (error.message === 'Guide non trouvé') {
          return reply.status(404).send({ error: 'Guide non trouvé' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la génération du CSV de redirections' });
      }
    }
  );

  /**
   * GET /guides/:guideId/export/preview
   * Retourne uniquement les métadonnées et statistiques de l'export (sans le contenu complet)
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { lang?: string };
  }>(
    '/guides/:guideId/export/preview',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr' } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      try {
        const exportData = await exportService.buildGuideExport(guideId, db, { language: lang });

        // Retourner uniquement meta + résumé par template (sans le contenu)
        const summary = exportData.pages.reduce<Record<string, number>>((acc, page) => {
          acc[page.template] = (acc[page.template] || 0) + 1;
          return acc;
        }, {});

        return reply.send({
          meta: exportData.meta,
          summary_by_template: summary,
          languages_available: ['fr', 'en', 'de', 'it', 'es', 'pt-pt', 'nl', 'da', 'sv'],
        });
      } catch (error: any) {
        if (error.message === 'Guide non trouvé') {
          return reply.status(404).send({ error: 'Guide non trouvé' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors du chargement de l\'aperçu' });
      }
    }
  );
}
