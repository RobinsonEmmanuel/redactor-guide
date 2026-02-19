import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { ExportService } from '../services/export.service.js';
import { normalizeGuideExportV2, type NormalizerOptions } from '../services/normalize-export.service.js';
import { buildGuideStoryboard, type StoryboardInputGuide } from '@redactor-guide/exporters';

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
