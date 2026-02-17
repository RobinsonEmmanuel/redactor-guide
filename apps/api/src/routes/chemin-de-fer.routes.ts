import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
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

      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });

      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

      // Récupérer les pages du chemin de fer
      const pages = await db
        .collection('pages')
        .find({ chemin_de_fer_id: cheminDeFerId })
        .sort({ ordre: 1 })
        .toArray();

      // Récupérer les sections
      const sections = await db
        .collection('sections')
        .find({ chemin_de_fer_id: cheminDeFerId })
        .sort({ ordre: 1 })
        .toArray();

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

      const result = await db.collection('chemins_de_fer').findOneAndUpdate(
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
      const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
      if (!cheminDeFer) {
        return reply.status(404).send({ error: 'Chemin de fer non trouvé' });
      }

      const cheminDeFerId = cheminDeFer._id.toString();

      // Vérifier que le template existe
      if (!ObjectId.isValid(body.template_id)) {
        return reply.status(400).send({ error: 'Template ID invalide' });
      }

      const template = await db.collection('templates').findOne({ _id: new ObjectId(body.template_id) });
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

      const result = await db.collection('pages').insertOne(page);
      const created = await db.collection('pages').findOne({ _id: result.insertedId });

      // Mettre à jour le compteur de pages
      await db.collection('chemins_de_fer').updateOne(
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

        const result = await db.collection('pages').findOneAndUpdate(
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

        const result = await db.collection('pages').deleteOne({ _id: new ObjectId(pageId) });

        if (result.deletedCount === 0) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Mettre à jour le compteur
        const now = new Date().toISOString();
        await db.collection('chemins_de_fer').updateOne(
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

        await db.collection('pages').bulkWrite(bulkOps);

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
        const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
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

        const result = await db.collection('sections').insertOne(section);
        const created = await db.collection('sections').findOne({ _id: result.insertedId });

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

        const page = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });

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

        const result = await db.collection('pages').findOneAndUpdate(
          { _id: new ObjectId(pageId) },
          {
            $set: {
              content,
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

        const page = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });
        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        // Vérifier qu'il y a une URL source
        if (!page.url_source) {
          return reply.status(400).send({ 
            error: 'Aucun article WordPress source associé à cette page',
            details: 'Veuillez d\'abord associer un article WordPress à cette page via ses paramètres.'
          });
        }

        // Marquer la page comme "en cours de génération"
        await db.collection('pages').updateOne(
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
              await db.collection('pages').updateOne(
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
          await db.collection('pages').updateOne(
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
          await db.collection('pages').updateOne(
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

        const page = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });
        if (!page) {
          return reply.status(404).send({ error: 'Page non trouvée' });
        }

        if (!page.url_source) {
          return reply.status(404).send({ error: 'Aucune URL source pour cette page' });
        }

        // Récupérer l'article WordPress correspondant
        const article = await db.collection('articles_raw').findOne({ 
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
    const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
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
    const site = await db.collection('sites').findOne({ url: guide.wpConfig.siteUrl });
    if (!site) {
      return reply.code(400).send({ error: 'Site WordPress non trouvé dans la base' });
    }

    // Vérifier qu'il y a des articles pour ce site avec cette destination
    const articlesCount = await db.collection('articles_raw').countDocuments({ 
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
      const existingProposal = await db.collection('sommaire_proposals').findOne({ guide_id: guideId });
      const baseProposal = existingProposal?.proposal || {};

      // Générer uniquement les parties demandées
      const proposal = await sommaireGenerator.generateSommaire(guideId, partsToGenerate);

      // Fusionner avec la proposition existante
      const mergedProposal = {
        ...baseProposal,
        ...proposal,
      };

      // Sauvegarder la proposition fusionnée
      await db.collection('sommaire_proposals').updateOne(
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
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      if (!guide) {
        return reply.code(404).send({ error: 'Guide non trouvé' });
      }

      // 2. Charger le template de guide (ou utiliser le template par défaut)
      let guideTemplate;
      if (guide.guide_template_id) {
        guideTemplate = await db.collection('guide_templates').findOne({
          _id: new ObjectId(guide.guide_template_id),
        });
      }

      if (!guideTemplate) {
        // Utiliser le template par défaut
        guideTemplate = await db.collection('guide_templates').findOne({ is_default: true });
      }

      if (!guideTemplate) {
        return reply.code(400).send({
          error: 'Aucun template de guide trouvé. Veuillez en créer un ou en définir un par défaut.',
        });
      }

      console.log(`📋 Template: ${guideTemplate.name}`);

      // 3. Charger les données des étapes précédentes
      const clusters = await db.collection('cluster_assignments').findOne({ guide_id: guideId });
      const inspirations = await db.collection('inspirations').findOne({ guide_id: guideId });
      const pois = await db.collection('pois_selection').findOne({ guide_id: guideId });

      console.log(`📊 Données chargées:`);
      console.log(`  - Clusters: ${clusters?.clusters_metadata?.length || 0}`);
      console.log(`  - Inspirations: ${inspirations?.inspirations?.length || 0}`);
      console.log(`  - POIs: ${pois?.pois?.length || 0}`);

      // 4. Construire les pages selon la structure du template
      const { CheminDeFerBuilderService } = await import('../services/chemin-de-fer-builder.service');
      const cheminDeFerBuilder = new CheminDeFerBuilderService({ db });
      
      const pages = await cheminDeFerBuilder.buildFromTemplate(guideId, guideTemplate as any, {
        clusters,
        inspirations,
        pois,
      });

      // 5. Vérifier si des pages existent déjà
      const existingPagesCount = await db.collection('pages').countDocuments({ guide_id: guideId });
      
      if (existingPagesCount > 0) {
        return reply.code(409).send({
          error: `Le guide contient déjà ${existingPagesCount} page(s). Veuillez les supprimer avant de générer la structure.`,
        });
      }

      // 6. Sauvegarder toutes les pages
      if (pages.length > 0) {
        await db.collection('pages').insertMany(pages);
        console.log(`✅ ${pages.length} pages sauvegardées`);
      }

      // 7. Créer ou mettre à jour le document chemin_de_fer
      const now = new Date().toISOString();
      await db.collection('chemins_de_fer').updateOne(
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
        { upsert: true }
      );

      return reply.send({
        success: true,
        message: 'Structure du chemin de fer générée avec succès',
        template: guideTemplate.name,
        pages_created: pages.length,
        structure: {
          fixed_pages: pages.filter(p => p.metadata.page_type === 'fixed').length,
          cluster_pages: pages.filter(p => p.metadata.page_type === 'cluster_intro').length,
          poi_pages: pages.filter(p => p.metadata.page_type === 'poi').length,
          inspiration_pages: pages.filter(p => p.metadata.page_type === 'inspiration').length,
          other_pages: pages.filter(p => p.metadata.page_type === 'repeated_fixed').length,
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

    const proposal = await db.collection('sommaire_proposals').findOne({ guide_id: guideId });
    
    if (!proposal) {
      return reply.code(404).send({ error: 'Aucune proposition de sommaire trouvée' });
    }

    return { proposal: proposal.proposal, created_at: proposal.created_at, status: proposal.status };
  });
}
