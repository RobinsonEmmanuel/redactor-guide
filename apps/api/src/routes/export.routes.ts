import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { ExportService } from '../services/export.service.js';

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
    Querystring: { lang?: string; download?: string };
  }>(
    '/guides/:guideId/export',
    async (request, reply) => {
      const { guideId } = request.params;
      const { lang = 'fr', download } = request.query;
      const db = request.server.container.db;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      try {
        const exportData = await exportService.buildGuideExport(guideId, db, { language: lang });

        const filename = `guide_${exportData.meta.destination.toLowerCase().replace(/\s+/g, '_')}_${exportData.meta.year}_${lang}.json`;

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
