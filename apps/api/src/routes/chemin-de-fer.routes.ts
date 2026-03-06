import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
import { COLLECTIONS } from '../config/collections.js';
  UpdateCheminDeFerSchema,
  CreatePageSchema,
  UpdatePageSchema,
  CreateSectionSchema,
} from '@redactor-guide/core-model';

export async function cheminDeFerRoutes(fastify: FastifyInstance) {
  /**
   * GET /guides/:guideId/chemin-de-fer
   * Récupère le chemin de fer d'un guide avec ses pages
   */
  fastify.get<{ Params: { guideId: string } }>('/guides/:guideId/chemin-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });

      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

      // Récupérer les pages du chemin de fer
      const rawPages = await db
        .collection(COLLECTIONS.pages)
        .find({ chemin_de_fer_id: cheminDeFerId })
        .sort({ ordre: 1 })
        .toArray();

      // Récupérer les sections
      const sections = await db
        .collection(COLLECTIONS.sections)
        .find({ chemin_de_fer_id: cheminDeFerId })
        .sort({ ordre: 1 })
        .toArray();

      // Résoudre inspiration_pois pour toutes les pages inspiration ayant des inspiration_pois_ids
      const inspirationPagesNeedingResolution = rawPages.filter(
        (p: any) =>
          p.metadata?.page_type === 'inspiration' &&
          Array.isArray(p.metadata?.inspiration_pois_ids) &&
          p.metadata.inspiration_pois_ids.length > 0
      );

      let resolvedPoisByPageId: Record<string, Array<{ poi_id: string; nom: string; url_source: string | null }>> = {};

      if (inspirationPagesNeedingResolution.length > 0) {
        const poisDoc = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        const allPois: any[] = poisDoc?.pois ?? [];
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        const guideLang: string = guide?.language ?? guide?.langue ?? 'fr';
        const urlCache: Record<string, string | null> = {};

        const sommaireDoc = await db.collection(COLLECTIONS.sommaire_proposals).findOne({ guide_id: guideId });
        const sommairePois: any[] = sommaireDoc?.proposal?.pois ?? [];
        const sommairePoisMap: Record<string, { nom: string; article_source?: string }> = {};
        for (const sp of sommairePois) {
          if (sp.poi_id) sommairePoisMap[sp.poi_id] = { nom: sp.nom, article_source: sp.article_source };
        }
        const poisByNom: Record<string, any> = {};
        for (const p of allPois) {
          poisByNom[p.nom?.toLowerCase()?.trim()] = p;
        }

        for (const p of inspirationPagesNeedingResolution) {
          const resolved: Array<{ poi_id: string; nom: string; url_source: string | null }> = [];
          const ids: string[] = p.metadata.inspiration_pois_ids;

          for (const poiId of ids) {
            let poi = allPois.find((x: any) => x.poi_id === poiId);

            if (!poi) {
              const somPoi = sommairePoisMap[poiId];
              if (somPoi) {
                poi = poisByNom[somPoi.nom?.toLowerCase()?.trim()];
                if (!poi) {
                  resolved.push({ poi_id: poiId, nom: somPoi.nom, url_source: null });
                  continue;
                }
              } else {
                continue;
              }
            }

            let poiUrl: string | null = null;
            const slug: string | undefined = poi.article_source;
            if (slug) {
              if (!(slug in urlCache)) {
                const artDoc = await db.collection(COLLECTIONS.articles_raw).findOne(
                  { slug },
                  { projection: { urls_by_lang: 1 } }
                );
                urlCache[slug] = artDoc?.urls_by_lang?.[guideLang] ?? artDoc?.urls_by_lang?.['fr'] ?? null;
              }
              poiUrl = urlCache[slug];
            }
            if (!poiUrl && poi.url_source && typeof poi.url_source === 'string' && poi.url_source.startsWith('http')) {
              poiUrl = poi.url_source;
            }
            if (!poiUrl && poi.url_source && typeof poi.url_source === 'string' && !poi.url_source.startsWith('http')) {
              const cacheKey = `url:${poi.url_source}`;
              if (!(cacheKey in urlCache)) {
                const artBySlug = await db.collection(COLLECTIONS.articles_raw).findOne(
                  { slug: poi.url_source },
                  { projection: { urls_by_lang: 1 } }
                );
                urlCache[cacheKey] = artBySlug?.urls_by_lang?.[guideLang] ?? artBySlug?.urls_by_lang?.['fr'] ?? null;
              }
              poiUrl = urlCache[cacheKey];
            }
            resolved.push({ poi_id: poi.poi_id, nom: poi.nom, url_source: poiUrl });
          }
          resolvedPoisByPageId[p._id.toString()] = resolved;
        }
      }

      const pages = rawPages.map((p: any) => {
        const resolved = resolvedPoisByPageId[p._id.toString()];
        if (!resolved) return p;
        return { ...p, metadata: { ...p.metadata, inspiration_pois: resolved } };
      });

      return reply.send({
        ...cheminDeFer,
        pages,
        sections,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération du chemin de fer' });
    }
  });

  /**
   * PUT /guides/:guideId/chemin-de-fer
   * Met à jour le chemin de fer d'un guide
   */
  fastify.put<{ Params: { guideId: string }; Body: unknown }>('/guides/:guideId/chemin-de-fer', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      const body = UpdateCheminDeFerSchema.parse(request.body);
      const now = new Date().toISOString();

      const result = await db.collection(COLLECTIONS.chemins_de_fer).findOneAndUpdate(
        { guide_id: guideId },
        { $set: { ...body, updated_at: now } },
        { returnDocument: 'after' }
      );

      if (!result) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la mise à jour' });
    }
  });

  /**
   * POST /guides/:guideId/chemin-de-fer/pages
   * Ajoute une page au chemin de fer
   */
  fastify.post<{ Params: { guideId: string }; Body: unknown }>('/guides/:guideId/chemin-de-fer/pages', async (request, reply) => {
    try {
      const db = request.server.container.db;
      const { guideId } = request.params;
      const body = CreatePageSchema.parse(request.body);

      if (!ObjectId.isValid(guideId)) {
        return reply.status(400).send({ error: 'Guide ID invalide' });
      }

      // Récupérer le chemin de fer
      const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

      // Vérifier que le template existe
      if (!ObjectId.isValid(body.template_id)) {
        return reply.status(400).send({ error: 'Template ID invalide' });
      }

      const template = await db.collection(COLLECTIONS.templates).findOne({ _id: new ObjectId(body.template_id) });
      if (!template) {
        return reply.status(404).send({ error: 'Template non trouvé' });
      }

      const now = new Date().toISOString();
      const page = {
        ...body,
        chemin_de_fer_id: cheminDeFerId,
        template_name: template.name,
        created_at: now,
        updated_at: now,
      };

      const result = await db.collection(COLLECTIONS.pages).insertOne(page);
      const created = await db.collection(COLLECTIONS.pages).findOne({ _id: result.insertedId });

      // Mettre à jour le compteur de pages
      await db.collection(COLLECTIONS.chemins_de_fer).updateOne(
        { _id: cheminDeFer._id },
        { $inc: { nombre_pages: 1 }, $set: { updated_at: now } }
      );

      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Erreur lors de la création de la page' });
    }
  });

  /**
   * PUT /guides/:guideId/chemin-de-fer/pages/:pageId
   * Met à jour une page
   */
  fastify.put<{ Params: { guideId: string; pageId: string }; Body: unknown }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const body = UpdatePageSchema.parse(request.body);
        const now = new Date().toISOString();

        const result = await db.collection(COLLECTIONS.pages).findOneAndUpdate(
          { _id: new ObjectId(pageId) },
          { $set: { ...body, updated_at: now } },
          { returnDocument: 'after' }
        );

        if (!result) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la mise à jour' });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/chemin-de-fer/pages
   * Supprime toutes les pages du chemin de fer en une seule requête
   */
  fastify.delete<{ Params: { guideId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { guideId } = request.params;

        const result = await db.collection(COLLECTIONS.pages).deleteMany({ guide_id: guideId });

        const now = new Date().toISOString();
        await db.collection(COLLECTIONS.chemins_de_fer).updateOne(
          { guide_id: guideId },
          { $set: { nombre_pages: 0, updated_at: now } }
        );

        return reply.send({ deleted: result.deletedCount });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur serveur' });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/chemin-de-fer/pages/:pageId
   * Supprime une page
   */
  fastify.delete<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { guideId, pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const result = await db.collection(COLLECTIONS.pages).deleteOne({ _id: new ObjectId(pageId) });

        if (result.deletedCount === 0) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Mettre à jour le compteur
        const now = new Date().toISOString();
        await db.collection(COLLECTIONS.chemins_de_fer).updateOne(
          { guide_id: guideId },
          { $inc: { nombre_pages: -1 }, $set: { updated_at: now } }
        );

        return reply.status(204).send();
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la suppression' });
      }
    }
  );

  /**
   * PUT /guides/:guideId/chemin-de-fer/pages/reorder
   * Réorganise les pages (drag-and-drop)
   */
  fastify.put<{ Params: { guideId: string }; Body: { pages: Array<{ _id: string; ordre: number }> } }>(
    '/guides/:guideId/chemin-de-fer/pages/reorder',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pages } = request.body;

        if (!Array.isArray(pages)) {
          return reply.status(400).send({ error: 'Format invalide' });
        }

        const now = new Date().toISOString();
        const bulkOps = pages.map((page) => ({
          updateOne: {
            filter: { _id: new ObjectId(page._id) },
            update: { $set: { ordre: page.ordre, updated_at: now } },
          },
        }));

        await db.collection(COLLECTIONS.pages).bulkWrite(bulkOps);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la réorganisation' });
      }
    }
  );

  /**
   * POST /guides/:guideId/chemin-de-fer/sections
   * Ajoute une section
   */
  fastify.post<{ Params: { guideId: string }; Body: unknown }>(
    '/guides/:guideId/chemin-de-fer/sections',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { guideId } = request.params;
        const body = CreateSectionSchema.parse(request.body);

        // Récupérer le chemin de fer
        const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
        if (!cheminDeFer) {
          return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
        }

        const now = new Date().toISOString();
        const section = {
          ...body,
          chemin_de_fer_id: cheminDeFer._id.toString(),
          created_at: now,
          updated_at: now,
        };

        const result = await db.collection(COLLECTIONS.sections).insertOne(section);
        const created = await db.collection(COLLECTIONS.sections).findOne({ _id: result.insertedId });

        return reply.status(201).send(created);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation échouée', details: error.errors });
        }
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la création de la section' });
      }
    }
  );

  /**
   * GET /guides/:guideId/chemin-de-fer/pages/:pageId/content
   * Récupère le contenu rédactionnel d'une page
   */
  fastify.get<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/content',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const page = await db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });

        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send({ content: page.content || {} });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la récupération du contenu' });
      }
    }
  );

  /**
   * PUT /guides/:guideId/chemin-de-fer/pages/:pageId/content
   * Met à jour le contenu rédactionnel d'une page
   */
  fastify.put<{ Params: { guideId: string; pageId: string }; Body: { content: Record<string, any> } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/content',
    async (request, reply) => {
      try {
        const db = request.server.container.db;
        const { pageId } = request.params;
        const { content } = request.body;

        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const now = new Date().toISOString();

        // Récupérer la page actuelle pour vérifier son statut
        const currentPage = await db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });
        if (!currentPage) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Si la page est "non_conforme" ou "draft", passer à "relue" lors de la sauvegarde manuelle
        const shouldUpdateStatus = currentPage.statut_editorial === 'non_conforme' || currentPage.statut_editorial === 'draft';
        const newStatus = shouldUpdateStatus ? 'relue' : currentPage.statut_editorial;

        const result = await db.collection(COLLECTIONS.pages).findOneAndUpdate(
          { _id: new ObjectId(pageId) },
          {
            $set: {
              content,
              ...(shouldUpdateStatus && { statut_editorial: newStatus }),
              updated_at: now,
            },
          },
          { returnDocument: 'after' }
        );

        if (!result) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        return reply.send({ success: true, content: result.content });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Erreur lors de la sauvegarde du contenu' });
      }
    }
  );

  /**
   * POST /guides/:guideId/chemin-de-fer/pages/:pageId/generate-content
   * Lancer la rédaction automatique d'une page via IA (worker)
   */
  fastify.post<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/generate-content',
    async (request, reply) => {
      const { guideId, pageId } = request.params;
      const db = request.server.container.db;

      try {
        // Vérifier que la page existe
        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const page = await db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });
        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Pour les pages POI, l'url_source est obligatoire (article mono-lieu).
        // Pour les pages INSPIRATION, le contexte vient de metadata.inspiration_pois — pas d'url_source.
        // Pour les autres types (couverture, cluster, saison…), le contexte général est utilisé.
        const pageType = (page.type_de_page ?? page.template_name ?? '').toLowerCase();
        if (pageType === 'poi' && !page.url_source) {
          return reply.status(400).send({ 
            error: 'Aucun article WordPress source associé à cette page',
            details: 'Veuillez d\'abord associer un article WordPress à cette page via ses paramètres.'
          });
        }
        if (pageType === 'inspiration' && !page.metadata?.inspiration_pois?.length) {
          return reply.status(400).send({
            error: 'Aucun POI associé à cette page inspiration',
            details: 'Générez d\'abord la structure du guide pour résoudre les POIs de cette inspiration.',
          });
        }

        // Marquer la page comme "en cours de génération"
        await db.collection(COLLECTIONS.pages).updateOne(
          { _id: new ObjectId(pageId) },
          { 
            $set: { 
              statut_editorial: 'en_attente', // ✅ En attente pendant la génération
              updated_at: new Date().toISOString() 
            } 
          }
        );

        // Déclencher le worker via QStash
        const qstashToken = process.env.QSTASH_TOKEN;
        let workerUrl = process.env.INGEST_WORKER_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.API_URL;
        
        // Ajouter https:// si absent
        if (workerUrl && !workerUrl.startsWith('http://') && !workerUrl.startsWith('https://')) {
          workerUrl = `https://${workerUrl}`;
        }

        console.log(`🔧 [Config] QSTASH_TOKEN: ${qstashToken ? '✅ présent' : '❌ manquant'}`);
        console.log(`🔧 [Config] workerUrl: ${workerUrl || '❌ manquant'}`);

        if (qstashToken && workerUrl) {
          // Worker asynchrone via QStash
          const fullWorkerUrl = `${workerUrl}/api/v1/workers/generate-page-content`;
          
          console.log(`📤 [QStash] Envoi job vers ${fullWorkerUrl}`);
          
          try {
            const qstashResponse = await fetch(`https://qstash.upstash.io/v2/publish/${fullWorkerUrl}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${qstashToken}`,
                'Content-Type': 'application/json',
                'Upstash-Retries': '3',
              },
              body: JSON.stringify({ guideId, pageId }),
            });

            if (!qstashResponse.ok) {
              const qstashError = await qstashResponse.text();
              console.error('❌ [QStash] Erreur:', qstashError);
              
              // Remettre le statut à draft en cas d'erreur
              await db.collection(COLLECTIONS.pages).updateOne(
                { _id: new ObjectId(pageId) },
                { 
                  $set: { 
                    statut_editorial: 'non_conforme',
                    commentaire_interne: `Erreur QStash: ${qstashError}`,
                    updated_at: new Date().toISOString() 
                  } 
                }
              );
              
              throw new Error(`QStash error: ${qstashError}`);
            }

            console.log(`✅ [QStash] Job envoyé avec succès`);

            return reply.send({ 
              success: true, 
              message: 'Rédaction IA lancée en arrière-plan',
              pageId,
              async: true
            });
          } catch (qstashErr: any) {
            console.error('❌ [QStash] Exception:', qstashErr);
            throw qstashErr;
          }
        } else {
          // Fallback : génération synchrone (pour développement)
          const { PageRedactionService } = await import('../services/page-redaction.service');
          const openaiApiKey = process.env.OPENAI_API_KEY;
          
          if (!openaiApiKey) {
            return reply.status(500).send({ error: 'OPENAI_API_KEY non configurée' });
          }

          const redactionService = new PageRedactionService(db, openaiApiKey);
          const result = await redactionService.generatePageContent(guideId, pageId);

          if (result.status === 'error') {
            return reply.status(500).send({ error: result.error });
          }

          // Sauvegarder le contenu généré
          await db.collection(COLLECTIONS.pages).updateOne(
            { _id: new ObjectId(pageId) },
            { 
              $set: { 
                content: result.content,
                statut_editorial: 'generee_ia',
                updated_at: new Date().toISOString() 
              } 
            }
          );

          return reply.send({ 
            success: true, 
            content: result.content,
            message: 'Contenu généré avec succès'
          });
        }
      } catch (error: any) {
        console.error('❌ [generate-content] Erreur:', error);
        request.log.error(error);
        
        // Remettre le statut à non_conforme en cas d'erreur
        try {
          await db.collection(COLLECTIONS.pages).updateOne(
            { _id: new ObjectId(pageId) },
            { 
              $set: { 
                statut_editorial: 'non_conforme',
                commentaire_interne: `Erreur API: ${error.message}`,
                updated_at: new Date().toISOString() 
              } 
            }
          );
        } catch (dbErr) {
          console.error('❌ Erreur mise à jour statut:', dbErr);
        }
        
        return reply.status(500).send({ 
          error: 'Erreur lors de la génération du contenu',
          details: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    }
  );

  /**
   * GET /guides/:guideId/chemin-de-fer/pages/:pageId/image-analysis
   * Récupérer les analyses d'images de l'article WordPress source
   */
  fastify.get<{ Params: { guideId: string; pageId: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/image-analysis',
    async (request, reply) => {
      const { pageId } = request.params;
      const db = request.server.container.db;

      try {
        if (!ObjectId.isValid(pageId)) {
          return reply.status(400).send({ error: 'Page ID invalide' });
        }

        const page = await db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });
        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        if (!page.url_source) {
          return reply.status(404).send({ error: 'Aucune URL source pour cette page' });
        }

        // Récupérer l'article WordPress correspondant
        const article = await db.collection(COLLECTIONS.articles_raw).findOne({ 
          'urls_by_lang.fr': page.url_source 
        });

        if (!article) {
          return reply.status(404).send({ error: 'Article WordPress non trouvé' });
        }

        // Mapper les analyses vers le format attendu par le frontend (format plat)
        const mappedAnalyses = (article.images_analysis || []).map((imgAnalysis: any, idx: number) => ({
          image_id: `image_${idx}`,
          url: imgAnalysis.url || '',
          // Aplatir l'objet "analysis" vers le niveau racine
          shows_entire_site: imgAnalysis.analysis?.shows_entire_site ?? false,
          shows_detail: imgAnalysis.analysis?.shows_detail ?? false,
          detail_type: imgAnalysis.analysis?.detail_type || 'indéterminé',
          is_iconic_view: imgAnalysis.analysis?.is_iconic_view ?? false,
          is_contextual: imgAnalysis.analysis?.is_contextual ?? false,
          visual_clarity_score: imgAnalysis.analysis?.visual_clarity_score ?? 0,
          composition_quality_score: imgAnalysis.analysis?.composition_quality_score ?? 0,
          lighting_quality_score: imgAnalysis.analysis?.lighting_quality_score ?? 0,
          readability_small_screen_score: imgAnalysis.analysis?.readability_small_screen_score ?? 0,
          has_text_overlay: imgAnalysis.analysis?.has_text_overlay ?? false,
          has_graphic_effects: imgAnalysis.analysis?.has_graphic_effects ?? false,
          editorial_relevance: imgAnalysis.analysis?.editorial_relevance || 'faible',
          analysis_summary: imgAnalysis.analysis?.analysis_summary || '',
        }));

        return reply.send({
          images: mappedAnalyses,
          analyzed: mappedAnalyses.length > 0
        });
      } catch (error: any) {
        request.log.error(error);
        return reply.status(500).send({ 
          error: 'Erreur lors de la récupération des analyses',
          details: error.message 
        });
      }
    }
  );

  /**
   * GET /guides/:guideId/poi-names
   * Retourne la liste dédupliquée des titres de pages du guide (noms de POIs).
   * Utilisé pour l'autocomplétion lors de l'association d'une image à un POI.
   * Query params:
   *   - q : filtre texte (optionnel)
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { q?: string };
  }>('/guides/:guideId/poi-names', async (request, reply) => {
    const { guideId } = request.params;
    const { q } = request.query;
    const db = request.server.container.db;

    try {
      const filter: Record<string, unknown> = {
        guide_id: guideId,
        titre:    { $exists: true, $nin: [null, ''] },
      };
      if (q?.trim()) {
        filter.titre = { $regex: q.trim(), $options: 'i' };
      }

      const pages = await db
        .collection(COLLECTIONS.pages)
        .find(filter, { projection: { titre: 1 } })
        .toArray();

      const names = [...new Set(
        pages
          .map((p: any) => p.titre as string)
          .filter(Boolean)
          .sort((a: string, b: string) => a.localeCompare(b, 'fr'))
      )];

      return reply.send({ names });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /guides/:guideId/images
   * Toutes les images analysées de tous les articles du guide.
   * Utilisé par les pages sans url_source (COUVERTURE, CLUSTER, SAISON…)
   * pour choisir une illustration dans le pool global du guide.
   *
   * Query params:
   *   - q      : filtre texte sur le titre de l'article source
   *   - sort   : 'relevance' (défaut) | 'clarity' | 'composition'
   */
  fastify.get<{
    Params: { guideId: string };
    Querystring: { q?: string; sort?: string };
  }>('/guides/:guideId/images', async (request, reply) => {
    const { guideId } = request.params;
    const { q, sort = 'relevance' } = request.query;
    const db = request.server.container.db;

    try {
      // 1. Récupérer la destination du guide pour filtrer les articles
      const guide = await db.collection(COLLECTIONS.guides).findOne(
        { _id: new (require('mongodb').ObjectId)(guideId) },
        { projection: { destination: 1 } }
      );
      const destination: string = guide?.destination ?? '';

      // 2. Requêter TOUS les articles de la destination ayant des images analysées
      //    (pas seulement ceux liés aux POIs — nécessaire pour COUVERTURE, CLUSTER, etc.)
      const filter: Record<string, unknown> = {
        images_analysis: { $exists: true, $not: { $size: 0 } },
      };

      // Filtre par destination si disponible
      if (destination) {
        filter.categories = { $regex: destination, $options: 'i' };
      }

      // Filtre texte sur le titre de l'article si ?q= fourni
      if (q) {
        filter.title = { $regex: q, $options: 'i' };
      }

      const articles = await db
        .collection(COLLECTIONS.articles_raw)
        .find(filter, { projection: { title: 1, slug: 1, images_analysis: 1 } })
        .toArray();

      // 3. Aplatir toutes les images avec la source article
      const allImages: any[] = [];
      for (const article of articles) {
        for (let idx = 0; idx < (article.images_analysis ?? []).length; idx++) {
          const imgAnalysis = article.images_analysis[idx];
          allImages.push({
            image_id:                    `${article.slug}_${idx}`,
            url:                         imgAnalysis.url || '',
            source_article_title:        article.title ?? article.slug,
            source_article_slug:         article.slug,
            shows_entire_site:           imgAnalysis.analysis?.shows_entire_site ?? false,
            shows_detail:                imgAnalysis.analysis?.shows_detail ?? false,
            is_iconic_view:              imgAnalysis.analysis?.is_iconic_view ?? false,
            visual_clarity_score:        imgAnalysis.analysis?.visual_clarity_score ?? 0,
            composition_quality_score:   imgAnalysis.analysis?.composition_quality_score ?? 0,
            editorial_relevance:         imgAnalysis.analysis?.editorial_relevance || 'faible',
            analysis_summary:            imgAnalysis.analysis?.analysis_summary || '',
          });
        }
      }

      // 4. Trier
      const sortFn: Record<string, (a: any, b: any) => number> = {
        relevance:   (a, b) => (b.editorial_relevance === 'forte' ? 1 : 0) - (a.editorial_relevance === 'forte' ? 1 : 0),
        clarity:     (a, b) => b.visual_clarity_score - a.visual_clarity_score,
        composition: (a, b) => b.composition_quality_score - a.composition_quality_score,
      };
      allImages.sort(sortFn[sort] ?? sortFn.relevance);

      return reply.send({ images: allImages, total: allImages.length });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /guides/:guideId/chemin-de-fer/generate-sommaire
   * Lancer la génération automatique du sommaire via IA
   * Query params: ?parts=sections,pois,inspirations (optionnel, défaut: toutes les parties)
   */
  fastify.post('/guides/:guideId/chemin-de-fer/generate-sommaire', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const { parts } = request.query as { parts?: string };
    const db = request.server.container.db;

    // Parser les parties à générer
    const requestedParts = parts ? parts.split(',').map(p => p.trim()) : ['sections', 'pois', 'inspirations'];
    const validParts = ['sections', 'pois', 'inspirations'];
    const partsToGenerate = requestedParts.filter(p => validParts.includes(p));

    if (partsToGenerate.length === 0) {
      return reply.code(400).send({ 
        error: 'Parties invalides. Valeurs possibles: sections, pois, inspirations' 
      });
    }

    console.log(`📋 Génération sommaire - Parties demandées: ${partsToGenerate.join(', ')}`);

    // Vérifier que le guide existe
    const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
    if (!guide) {
      return reply.code(404).send({ error: 'Guide non trouvé' });
    }

    // Vérifier qu'une destination est définie
    if (!guide.destination) {
      return reply.code(400).send({ error: 'Aucune destination définie pour ce guide' });
    }

    // Vérifier qu'il y a un site WordPress configuré
    if (!guide.wpConfig?.siteUrl) {
      return reply.code(400).send({ error: 'Aucun site WordPress configuré pour ce guide' });
    }

    // Récupérer le site_id depuis la collection sites (via siteUrl)
    const site = await db.collection(COLLECTIONS.sites).findOne({ url: guide.wpConfig.siteUrl });
    if (!site) {
      return reply.code(400).send({ error: 'Site WordPress non trouvé dans la base' });
    }

    // Vérifier qu'il y a des articles pour ce site avec cette destination
    const articlesCount = await db.collection(COLLECTIONS.articles_raw).countDocuments({ 
      site_id: site._id.toString(),
      categories: { $in: [guide.destination] }, // Catégories contient la destination
    });
    
    if (articlesCount === 0) {
      return reply.code(400).send({ 
        error: `Aucun article WordPress trouvé pour la destination "${guide.destination}"` 
      });
    }

    try {
      // Import dynamique des services
      const { OpenAIService } = await import('../services/openai.service');
      const { SommaireGeneratorService } = await import('../services/sommaire-generator.service');

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return reply.code(500).send({ error: 'OPENAI_API_KEY non configurée' });
      }

      const openaiService = new OpenAIService({
        apiKey: openaiApiKey,
        model: 'gpt-5-mini',
        reasoningEffort: 'medium', // Raisonnement modéré pour équilibre qualité/coût
      });

      const sommaireGenerator = new SommaireGeneratorService({
        db,
        openaiService,
      });

      // Récupérer la proposition existante si elle existe
      const existingProposal = await db.collection(COLLECTIONS.sommaire_proposals).findOne({ guide_id: guideId });
      const baseProposal = existingProposal?.proposal || {};

      // Générer uniquement les parties demandées
      const proposal = await sommaireGenerator.generateSommaire(guideId, partsToGenerate);

      // Fusionner avec la proposition existante
      const mergedProposal = {
        ...baseProposal,
        ...proposal,
      };

      // Sauvegarder la proposition fusionnée
      await db.collection(COLLECTIONS.sommaire_proposals).updateOne(
        { guide_id: guideId },
        {
          $set: {
            proposal: mergedProposal,
            updated_at: new Date().toISOString(),
            parts_generated: partsToGenerate,
          },
          $setOnInsert: {
            created_at: new Date().toISOString(),
            status: 'generated',
          },
        },
        { upsert: true }
      );

      return {
        success: true,
        proposal: mergedProposal,
        parts_generated: partsToGenerate,
      };
    } catch (error: any) {
      console.error('Erreur génération sommaire:', error);
      return reply.code(500).send({ error: error.message || 'Erreur lors de la génération' });
    }
  });

  /**
   * POST /guides/:guideId/chemin-de-fer/generate-structure
   * Génère automatiquement la structure du chemin de fer à partir du guide template
   */
  fastify.post('/guides/:guideId/chemin-de-fer/generate-structure', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const db = request.server.container.db;

    try {
      console.log(`🏗️ [Generate Structure] Début pour guide ${guideId}`);

      // 1. Charger le guide
      const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      if (!guide) {
        return reply.code(404).send({ error: 'Guide non trouvé' });
      }

      // 2. Charger le template de guide (ou utiliser le template par défaut)
      let guideTemplate;
      if (guide.guide_template_id) {
        guideTemplate = await db.collection(COLLECTIONS.guide_templates).findOne({
          _id: new ObjectId(guide.guide_template_id),
        });
      }

      if (!guideTemplate) {
        // Utiliser le template par défaut
        guideTemplate = await db.collection(COLLECTIONS.guide_templates).findOne({ is_default: true });
      }

      if (!guideTemplate) {
        return reply.code(400).send({
          error: 'Aucun template de guide trouvé. Veuillez en créer un ou en définir un par défaut.',
        });
      }

      console.log(`📋 Template: ${guideTemplate.name}`);

      // 3. Charger les données des étapes précédentes
      const clusters = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
      const inspirations = await db.collection(COLLECTIONS.inspirations).findOne({ guide_id: guideId });
      const pois = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });

      console.log(`📊 Données chargées:`);
      console.log(`  - Clusters: ${clusters?.clusters_metadata?.length || 0}`);
      console.log(`  - Inspirations: ${inspirations?.inspirations?.length || 0}`);
      console.log(`  - POIs: ${pois?.pois?.length || 0}`);

      // 4. Construire les pages selon la structure du template
      const { CheminDeFerBuilderService } = await import('../services/chemin-de-fer-builder.service');
      const cheminDeFerBuilder = new CheminDeFerBuilderService({ db });
      
      const rawPages = await cheminDeFerBuilder.buildFromTemplate(guideId, guideTemplate as any, {
        clusters,
        inspirations,
        pois,
      });

      // 5. Créer ou mettre à jour le document chemin_de_fer EN PREMIER
      //    (nécessaire pour obtenir l'_id avant d'insérer les pages)
      const now = new Date().toISOString();
      const cdfResult = await db.collection(COLLECTIONS.chemins_de_fer).findOneAndUpdate(
        { guide_id: guideId },
        {
          $set: {
            guide_id: guideId,
            structure_generated: true,
            template_used: guideTemplate.name,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
        },
        { upsert: true, returnDocument: 'after' }
      );
      const cheminDeFerId = cdfResult?._id?.toString() ?? '';

      // 6. Supprimer les pages existantes avant de régénérer
      const deleteResult = await db.collection(COLLECTIONS.pages).deleteMany({ chemin_de_fer_id: cheminDeFerId });
      if (deleteResult.deletedCount > 0) {
        console.log(`🗑️ [Generate Structure] ${deleteResult.deletedCount} page(s) existante(s) supprimée(s)`);
      }

      // 7. Normaliser les pages du builder vers le format attendu par le chemin de fer
      //    Le builder produit { order, status, ... } mais le reste de l'app attend
      //    { ordre, statut_editorial, chemin_de_fer_id, titre, template_id, url_source, ... }
      const templateCache: Record<string, any> = {};
      // Cache slug → URL pour éviter des requêtes répétées sur articles_raw
      const articleUrlCache: Record<string, string | null> = {};
      const guideLang = guide.language || 'fr';

      const normalizedPages = await Promise.all(rawPages.map(async (p: any) => {
        // Résoudre template_id depuis le nom
        if (!templateCache[p.template_name]) {
          const tpl = await db.collection(COLLECTIONS.templates).findOne({ name: p.template_name });
          templateCache[p.template_name] = tpl ?? null;
        }
        const tpl = templateCache[p.template_name];

        // Construire le titre à partir des métadonnées disponibles
        const titre =
          p.metadata?.poi_name          ||
          p.metadata?.cluster_name      ||
          p.metadata?.inspiration_title ||
          p.metadata?.saison            ||
          p.section_name                ||
          p.template_name               ||
          'Page';

        // Résoudre url_source depuis article_source (slug POI) → articles_raw.urls_by_lang
        let url_source: string | null = null;
        const articleSlug: string | undefined = p.metadata?.article_source;
        if (articleSlug) {
          if (!(articleSlug in articleUrlCache)) {
            const article = await db.collection(COLLECTIONS.articles_raw).findOne(
              { slug: articleSlug },
              { projection: { urls_by_lang: 1 } }
            );
            articleUrlCache[articleSlug] =
              article?.urls_by_lang?.[guideLang] ??
              article?.urls_by_lang?.['fr']     ??
              null;
          }
          url_source = articleUrlCache[articleSlug];
        }

        if (url_source) {
          console.log(`🔗 [URL résolue] ${titre} → ${url_source}`);
        }

        // ── Pages inspiration : résoudre les POIs → [{nom, url_source}] ──────
        let inspiration_pois: Array<{ poi_id: string; nom: string; url_source: string | null }> | undefined;

        if (p.metadata?.page_type === 'inspiration' && p.metadata.inspiration_pois_ids?.length) {
          const allPois: any[] = pois?.pois ?? [];
          inspiration_pois = [];

          for (const poiId of p.metadata.inspiration_pois_ids as string[]) {
            const poi = allPois.find((x: any) => x.poi_id === poiId);
            if (!poi) continue;

            let poiUrl: string | null = null;
            const poiSlug: string | undefined = poi.article_source;
            if (poiSlug) {
              if (!(poiSlug in articleUrlCache)) {
                const artDoc = await db.collection(COLLECTIONS.articles_raw).findOne(
                  { slug: poiSlug },
                  { projection: { urls_by_lang: 1 } }
                );
                articleUrlCache[poiSlug] =
                  artDoc?.urls_by_lang?.[guideLang] ??
                  artDoc?.urls_by_lang?.['fr']      ??
                  null;
              }
              poiUrl = articleUrlCache[poiSlug];
            }

            inspiration_pois.push({ poi_id: poi.poi_id, nom: poi.nom, url_source: poiUrl });
          }

          console.log(`💡 [Inspiration] "${titre}" → ${inspiration_pois.length} POI(s) résolus`);
        }

        const finalMetadata = inspiration_pois
          ? { ...p.metadata, inspiration_pois }
          : p.metadata ?? {};

        return {
          chemin_de_fer_id: cheminDeFerId,
          guide_id:         guideId,
          template_name:    p.template_name,
          template_id:      tpl?._id?.toString() ?? null,
          titre,
          ordre:            p.order,
          statut_editorial: 'draft',
          section_id:       p.section_name ?? null,
          url_source,
          content:          {},
          metadata:         finalMetadata,
          fields:           p.fields   ?? [],
          created_at:       p.created_at,
          updated_at:       p.updated_at,
        };
      }));

      // 8. Sauvegarder toutes les pages normalisées
      if (normalizedPages.length > 0) {
        await db.collection(COLLECTIONS.pages).insertMany(normalizedPages);
        console.log(`✅ ${normalizedPages.length} pages sauvegardées`);
      }

      const pages = normalizedPages; // alias pour les stats ci-dessous

      return reply.send({
        success: true,
        message: 'Structure du chemin de fer générée avec succès',
        template: guideTemplate.name,
        pages_created: pages.length,
        structure: {
          fixed_pages:       pages.filter((p: any) => p.metadata?.page_type === 'fixed').length,
          cluster_pages:     pages.filter((p: any) => p.metadata?.page_type === 'cluster_intro').length,
          poi_pages:         pages.filter((p: any) => p.metadata?.page_type === 'poi').length,
          inspiration_pages: pages.filter((p: any) => p.metadata?.page_type === 'inspiration').length,
          other_pages:       pages.filter((p: any) => !['fixed','cluster_intro','poi','inspiration'].includes(p.metadata?.page_type)).length,
        },
      });
    } catch (error: any) {
      console.error('❌ [Generate Structure] Erreur:', error);
      return reply.code(500).send({
        error: 'Erreur lors de la génération de la structure',
        details: error.message,
      });
    }
  });

  /**
   * GET /guides/:guideId/chemin-de-fer/sommaire-proposal
   * Récupérer la dernière proposition de sommaire générée
   */
  fastify.get('/guides/:guideId/chemin-de-fer/sommaire-proposal', async (request, reply) => {
    const { guideId } = request.params as { guideId: string };
    const db = request.server.container.db;

    const proposal = await db.collection(COLLECTIONS.sommaire_proposals).findOne({ guide_id: guideId });
    
    if (!proposal) {
      return reply.code(404).send({ error: 'Aucune proposition de sommaire trouvée' });
    }

    return { proposal: proposal.proposal, created_at: proposal.created_at, status: proposal.status };
  });

  /**
   * POST /guides/:guideId/chemin-de-fer/pages/:pageId/validate-content
   * Valide le contenu d'une fiche via Perplexity (grounding web).
   * Retourne un rapport de validation avec statut, correction et source pour chaque champ.
   */
  fastify.post<{ Params: { guideId: string; pageId: string }; Body: { content: Record<string, any>; poi_name?: string } }>(
    '/guides/:guideId/chemin-de-fer/pages/:pageId/validate-content',
    async (request, reply) => {
      const db = request.server.container.db;
      const { guideId, pageId } = request.params;
      const { content, poi_name } = request.body;

      try {
        // Récupérer le guide (pour la destination) et la page (pour le template)
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        const destination: string = guide?.destination ?? 'destination inconnue';

        const page = await db.collection(COLLECTIONS.pages).findOne({ _id: new ObjectId(pageId) });
        if (!page) return reply.code(404).send({ error: 'Page non trouvée' });

        // Récupérer le template pour avoir les labels des champs
        const template = page.template_id
          ? await db.collection(COLLECTIONS.templates).findOne({ _id: new ObjectId(page.template_id) })
          : null;

        const fieldLabelMap: Record<string, string> = {};
        if (template?.fields) {
          for (const f of template.fields) {
            fieldLabelMap[f.name] = f.label || f.name;
          }
        }

        // Libellés lisibles pour les valeurs de pictos
        const PICTO_VALUE_LABELS: Record<string, string> = {
          incontournable: 'Incontournable (lieu exceptionnel, à ne pas manquer)',
          interessant:    'Intéressant (vaut le détour)',
          a_voir:         'À voir (si on passe dans le secteur)',
          '100':          'Accessible 100% (PMR, accès complet)',
          '50':           'Partiellement accessible (PMR, accès limité)',
          '0':            'Non accessible (PMR)',
          oui:            'Oui',
          non:            'Non',
        };

        // Construire la liste des champs à valider (texte + picto, non vides)
        const TEXT_TYPES = new Set(['titre', 'texte', 'meta']);
        const PICTO_TYPE = 'picto';
        const fieldsToValidate: Array<{ name: string; label: string; value: string; fieldType?: string }> = [];

        const pageContent: Record<string, any> = content || page.content || {};

        for (const [key, val] of Object.entries(pageContent)) {
          if (!val || typeof val !== 'string' || val.trim().length === 0) continue;
          // Ignorer les URLs et les champs image
          if (val.startsWith('http') || key.toLowerCase().includes('image') || key.toLowerCase().includes('url')) continue;

          const fieldDef = template?.fields?.find((f: any) => f.name === key);
          const fieldType = fieldDef?.type;

          if (fieldType === PICTO_TYPE) {
            // Champ picto : valeur courte mais on enrichit le label avec la signification
            const pictoLabel = PICTO_VALUE_LABELS[val.trim()] ?? val.trim();
            const optionLabels = (fieldDef.options ?? [])
              .map((o: string) => `"${o}" = ${PICTO_VALUE_LABELS[o] ?? o}`)
              .join(', ');
            fieldsToValidate.push({
              name: key,
              label: `${fieldLabelMap[key] || key} [picto — options : ${optionLabels}]`,
              value: `${val.trim()} (= ${pictoLabel})`,
              fieldType: PICTO_TYPE,
            });
          } else {
            if (val.trim().length < 2) continue;
            if (fieldDef && !TEXT_TYPES.has(fieldType)) continue;
            fieldsToValidate.push({
              name: key,
              label: fieldLabelMap[key] || key,
              value: val.trim().substring(0, 400),
            });
          }
        }

        if (fieldsToValidate.length === 0) {
          return reply.code(400).send({ error: 'Aucun champ textuel à valider dans ce contenu' });
        }

        const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
        if (!perplexityApiKey) {
          return reply.code(503).send({ error: 'PERPLEXITY_API_KEY non configurée' });
        }

        const { PerplexityService } = await import('../services/perplexity.service');
        const perplexity = new PerplexityService(perplexityApiKey, 'sonar');

        const name = poi_name || page.titre || 'POI';

        // ── Charger le prompt Perplexity depuis la DB ─────────────────────────
        const PROMPT_ID_FACTUEL = process.env.PROMPT_ID_FACTUEL ?? 'validation_factuelle_poi';
        const factuelPromptDoc = await db.collection(COLLECTIONS.prompts).findOne({ prompt_id: PROMPT_ID_FACTUEL });

        const fieldsText = fieldsToValidate.map(f => `- ${f.label} (${f.name}) : "${f.value}"`).join('\n');
        const nomsChamps = fieldsToValidate.map(f => `"${f.name}"`).join(', ');

        let renderedPrompt: string;
        if (factuelPromptDoc?.texte_prompt) {
          // replaceVariables via une fonction locale (OpenAIService non disponible ici sans instance)
          renderedPrompt = factuelPromptDoc.texte_prompt
            .replace(/\{\{NOM_POI\}\}/g, name)
            .replace(/\{\{DESTINATION\}\}/g, destination)
            .replace(/\{\{CHAMPS_A_VERIFIER\}\}/g, fieldsText)
            .replace(/\{\{NOMS_CHAMPS\}\}/g, nomsChamps);
          console.log(`📋 [VALIDATE] Prompt factuel chargé depuis DB (${PROMPT_ID_FACTUEL})`);
        } else {
          console.warn(`⚠️ [VALIDATE] Prompt factuel non trouvé (id: ${PROMPT_ID_FACTUEL}), fallback`);
          renderedPrompt = `Tu es un fact-checker. Vérifie chaque information sur "${name}" (${destination}) via tes sources web. NE PAS utiliser canarias-lovers.com.\n\n${fieldsText}\n\nRetourne UNIQUEMENT du JSON : {"results":[{"field":"...","label":"...","value":"...","status":"valid|invalid|uncertain","validated_points":[{"point":"...","source_ref":1}],"invalid_points":[{"point":"...","correction":"...","source_ref":1}],"comment":"..."}]}`;
        }

        console.log(`🔍 [VALIDATE] Validation Perplexity Sonar de "${name}" (${fieldsToValidate.length} champs)`);

        // ── 1. Validation factuelle Perplexity + récupération article en parallèle ──
        const [report, articleDoc] = await Promise.all([
          perplexity.validatePageContent(renderedPrompt),
          page.url_source
            ? db.collection(COLLECTIONS.articles_raw).findOne({ 'urls_by_lang.fr': page.url_source })
            : Promise.resolve(null),
        ]);

        // ── 2. Vérification cohérence avec l'article source (si disponible) ──────────
        if (articleDoc?.markdown) {
          const openaiApiKey = process.env.OPENAI_API_KEY;
          if (openaiApiKey) {
            try {
              const { OpenAIService } = await import('../services/openai.service');
              const openai = new OpenAIService({ apiKey: openaiApiKey, model: 'gpt-5-mini', reasoningEffort: 'low' });

              // Tronquer le markdown article pour rester dans le contexte (8000 chars max)
              const articleExcerpt = (articleDoc.markdown as string).substring(0, 8000);
              const fieldsJson = fieldsToValidate.map(f => `- ${f.label} (${f.name}): "${f.value}"`).join('\n');

              // ── Charger le prompt depuis la collection (fallback intégré si absent) ──
              const PROMPT_ID_CONSISTENCY = process.env.PROMPT_ID_CONSISTENCY ?? 'validation_coherence_article';
              const consistencyPromptDoc = await db.collection(COLLECTIONS.prompts).findOne({ prompt_id: PROMPT_ID_CONSISTENCY });

              let consistencyPrompt: string;
              if (consistencyPromptDoc?.texte_prompt) {
                consistencyPrompt = openai.replaceVariables(consistencyPromptDoc.texte_prompt, {
                  ARTICLE_SOURCE: articleExcerpt,
                  NOM_POI: name,
                  CHAMPS_REDIGES: fieldsJson,
                });
                console.log(`📋 [VALIDATE] Prompt cohérence chargé depuis DB (${PROMPT_ID_CONSISTENCY})`);
              } else {
                console.warn(`⚠️ [VALIDATE] Prompt cohérence non trouvé en DB (id: ${PROMPT_ID_CONSISTENCY}), utilisation du fallback`);
                consistencyPrompt = `Tu es un éditeur vérifiant la cohérence entre un contenu rédigé et son article source.\n\nArticle source :\n---\n${articleExcerpt}\n---\n\nContenu rédigé pour "${name}" :\n${fieldsJson}\n\nÉvalue si ce qui est ÉCRIT dans chaque champ est confirmé par l'article (present/partial/absent).\n\nRetourne UNIQUEMENT ce JSON :\n{ "consistency": [{ "field": "nom_du_champ", "article_consistency": "present|partial|absent", "article_excerpt": "citation ou null", "article_comment": "explication max 80 caractères" }] }`;
              }

              const consistencyResult = await openai.generateJSON(consistencyPrompt, 6000);

              if (consistencyResult?.consistency && Array.isArray(consistencyResult.consistency)) {
                const consistencyMap: Record<string, any> = {};
                for (const c of consistencyResult.consistency) consistencyMap[c.field] = c;

                // Enrichir chaque résultat Perplexity avec la cohérence article
                report.results = report.results.map((r: any) => ({
                  ...r,
                  article_consistency: consistencyMap[r.field]?.article_consistency ?? 'not_checked',
                  article_excerpt: consistencyMap[r.field]?.article_excerpt ?? null,
                  article_comment: consistencyMap[r.field]?.article_comment ?? null,
                }));

                console.log(`✅ [VALIDATE] Cohérence article vérifiée pour ${Object.keys(consistencyMap).length} champs`);
              }
            } catch (consistErr: any) {
              console.warn(`⚠️ [VALIDATE] Cohérence article échouée (non bloquant): ${consistErr.message}`);
              // Non bloquant : on continue avec la validation Perplexity seule
            }
          }
        } else {
          // Pas d'article source : marquer comme non vérifié
          report.results = report.results.map((r: any) => ({
            ...r,
            article_consistency: 'not_checked' as const,
          }));
        }

        // Sauvegarder le rapport dans la page pour consultation ultérieure
        await db.collection(COLLECTIONS.pages).updateOne(
          { _id: new ObjectId(pageId) },
          { $set: { last_validation: report, updated_at: new Date().toISOString() } }
        );

        console.log(`✅ [VALIDATE] Rapport généré: ${report.results.length} champs, statut: ${report.overall_status}, ${report.grounding_sources?.length || 0} sources grounding`);
        return reply.send(report);

      } catch (error: any) {
        console.error('❌ [VALIDATE] Erreur:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

}
