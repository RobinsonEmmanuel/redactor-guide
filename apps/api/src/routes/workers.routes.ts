import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { PageRedactionService } from '../services/page-redaction.service';
import { JsonTranslatorService } from '../services/json-translator.service';
import { FieldServiceRunner, explodeRepetitifField } from '../services/field-service-runner.service.js';

export async function workersRoutes(fastify: FastifyInstance) {
  /**
   * POST /workers/generate-page-content
   * Worker pour générer le contenu d'une page via IA
   * Appelé par QStash de manière asynchrone
   */
  fastify.post('/workers/generate-page-content', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, pageId } = request.body as { guideId: string; pageId: string };

    try {
      console.log(`🚀 [WORKER] Génération contenu page ${pageId}`);

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      // Générer le contenu via IA (avec retry automatique intégré)
      const redactionService = new PageRedactionService(db, openaiApiKey);
      const result = await redactionService.generatePageContent(guideId, pageId);

      // Déterminer le statut éditorial selon le résultat
      let statutEditorial = 'draft';
      let commentaire: string | undefined;

      if (result.status === 'success') {
        statutEditorial = 'generee_ia';
        commentaire = result.retryCount && result.retryCount > 0
          ? `Généré avec succès après ${result.retryCount} tentative(s)`
          : undefined;
        console.log(`✅ [WORKER] Génération réussie après ${result.retryCount || 0} retry(s)`);
      } else if (result.validationErrors && result.validationErrors.length > 0) {
        // Validation échouée après retries
        statutEditorial = 'non_conforme';
        const failedFieldsSummary = result.validationErrors
          .map((e) => `${e.field} (${e.errors.length} erreur(s))`)
          .join(', ');
        commentaire = `Validation échouée après ${result.retryCount || 0} tentative(s): ${failedFieldsSummary}`;
        console.error(`❌ [WORKER] Validation non conforme:`, commentaire);
      } else {
        // Autre erreur
        statutEditorial = 'non_conforme';
        commentaire = `Erreur IA: ${result.error || 'Erreur inconnue'}`;
        console.error(`❌ [WORKER] Erreur génération:`, commentaire);
      }

      // Exécuter les field services "per-page" (ex: geocoding_maps_link) immédiatement
      // après la génération IA, pour que la valeur soit visible dans la modale de rédaction.
      // (Les services globaux comme sommaire_generator restent en passe 2 d'export.)
      // Services "per-page" : exécutés immédiatement après la génération IA
      // pour que les valeurs calculées soient visibles dans la modale de rédaction.
      // (Les services globaux comme sommaire_generator restent en passe 2 d'export.)
      const PER_PAGE_SERVICES = new Set<string>(['geocoding_maps_link', 'inspiration_poi_cards']);
      try {
        const rawPageDoc = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });
        if (rawPageDoc) {
          const template = await db.collection('templates').findOne({ _id: new ObjectId(rawPageDoc.template_id) });
          const serviceFields = ((template?.fields ?? []) as any[]).filter(
            (f: any) => f.service_id && PER_PAGE_SERVICES.has(f.service_id)
          );

          if (serviceFields.length > 0) {
            const guide  = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
            const runner = new FieldServiceRunner();

            for (const field of serviceFields) {
              try {
                const svcResult = await runner.run(field.service_id, {
                  guideId,
                  guide:            guide ?? {},
                  currentPage:      { ...rawPageDoc, content: result.content },
                  allExportedPages: [],
                  db,
                  fieldDef:         field,
                });
                result.content[field.name] = svcResult.value;

                // Si le champ est de type repetitif, on explose le tableau JSON en
                // champs plats pour que la modale et l'export InDesign les voient directement.
                if (field.type === 'repetitif' && svcResult.value) {
                  const flat = explodeRepetitifField(field.name, svcResult.value);
                  Object.assign(result.content, flat);
                }

                console.log(`✅ [WORKER] Service "${field.service_id}" → champ "${field.name}" calculé`);
              } catch (svcErr: any) {
                console.warn(`⚠️ [WORKER] Service "${field.service_id}" échoué : ${svcErr.message}`);
              }
            }
          }
        }
      } catch (svcSetupErr: any) {
        console.warn(`⚠️ [WORKER] Erreur setup field-services : ${svcSetupErr.message}`);
      }

      // Sauvegarder le contenu généré (même si validation échoue, pour permettre édition manuelle)
      await db.collection('pages').updateOne(
        { _id: new ObjectId(pageId) },
        { 
          $set: { 
            content: result.content,
            statut_editorial: statutEditorial,
            ...(commentaire && { commentaire_interne: commentaire }),
            updated_at: new Date().toISOString() 
          } 
        }
      );

      console.log(`✅ [WORKER] Contenu sauvegardé pour page ${pageId} (statut: ${statutEditorial})`);

      return reply.send({ 
        success: result.status === 'success', 
        pageId,
        fieldsGenerated: Object.keys(result.content).length,
        statutEditorial,
        retryCount: result.retryCount || 0,
        validationErrors: result.validationErrors
      });
    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur fatale:`, error);
      
      // Marquer la page en erreur
      try {
        await db.collection('pages').updateOne(
          { _id: new ObjectId(pageId) },
          { 
            $set: { 
              statut_editorial: 'non_conforme',
              commentaire_interne: `Erreur worker: ${error.message}`,
              updated_at: new Date().toISOString() 
            } 
          }
        );
      } catch (dbError) {
        console.error('Erreur mise à jour statut:', dbError);
      }

      return reply.status(500).send({ 
        error: 'Erreur lors de la génération',
        details: error.message 
      });
    }
  });

  /**
   * POST /workers/sync-inspiration-pages
   * Synchronise toutes les pages du chemin de fer liées à une inspiration
   * après modification de lieux_associes dans l'étape 4 "Lieux & Inspirations".
   *
   * - Récupère les nouveaux lieux_associes depuis la collection inspirations
   * - Redistribue les POIs sur les pages existantes (même pagination que le builder)
   * - Met à jour inspiration_pois_ids et relance le service inspiration_poi_cards sur chaque page
   */
  fastify.post('/workers/sync-inspiration-pages', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, inspirationId } = request.body as { guideId: string; inspirationId: string };

    try {
      // 1. Charger la liste à jour des lieux_associes
      const inspDoc = await db.collection('inspirations').findOne({ guide_id: guideId });
      const inspiration = (inspDoc?.inspirations ?? []).find(
        (i: any) => i.theme_id === inspirationId || i.inspiration_id === inspirationId
      );
      if (!inspiration) {
        return reply.status(404).send({ error: `Inspiration ${inspirationId} introuvable` });
      }
      const newPoisIds: string[] = inspiration.lieux_associes ?? [];

      // 2. Trouver toutes les pages du chemin de fer pour cette inspiration
      const cheminDeFerDoc = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
      if (!cheminDeFerDoc) return reply.status(404).send({ error: 'Chemin de fer introuvable' });

      const cheminDeFerId = cheminDeFerDoc._id.toString();
      const inspirationPages = await db.collection('pages').find({
        chemin_de_fer_id: cheminDeFerId,
        'metadata.page_type': 'inspiration',
        $or: [
          { 'metadata.inspiration_id': inspirationId },
          { 'metadata.inspiration_title': inspiration.titre },
        ],
      }).sort({ 'metadata.page_index': 1 }).toArray();

      if (inspirationPages.length === 0) {
        console.warn(`⚠️ [sync-inspiration-pages] Aucune page trouvée pour inspiration "${inspiration.titre}" (id: ${inspirationId}) dans chemin de fer ${cheminDeFerId}`);
        return reply.send({ success: true, message: 'Aucune page chemin de fer à synchroniser', pagesUpdated: 0 });
      }

      // 3. Redistribuer les POIs sur les pages existantes
      const pageCount   = inspirationPages.length;
      const poisPerPage = Math.ceil(newPoisIds.length / pageCount) || 1;

      // 4. Charger données guide + pois_selection pour résolution
      const guide    = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      const poisDoc  = await db.collection('pois_selection').findOne({ guide_id: guideId });
      const allPois: any[] = poisDoc?.pois ?? [];
      const guideLang: string = guide?.language ?? guide?.langue ?? 'fr';
      const articleUrlCache: Record<string, string | null> = {};

      const resolvePoiIds = async (ids: string[]) => {
        const resolved: Array<{ poi_id: string; nom: string; url_source: string | null }> = [];
        for (const poiId of ids) {
          const poi = allPois.find((x: any) => x.poi_id === poiId);
          if (!poi) continue;
          let poiUrl: string | null = null;
          const slug: string | undefined = poi.article_source;
          if (slug) {
            if (!(slug in articleUrlCache)) {
              const artDoc = await db.collection('articles_raw').findOne({ slug }, { projection: { urls_by_lang: 1 } });
              articleUrlCache[slug] = artDoc?.urls_by_lang?.[guideLang] ?? artDoc?.urls_by_lang?.['fr'] ?? null;
            }
            poiUrl = articleUrlCache[slug];
          }
          resolved.push({ poi_id: poi.poi_id, nom: poi.nom, url_source: poiUrl });
        }
        return resolved;
      };

      const runner   = new FieldServiceRunner();
      let pagesUpdated = 0;

      for (let i = 0; i < inspirationPages.length; i++) {
        const pageDoc = inspirationPages[i];
        const pagePoiIds = newPoisIds.slice(i * poisPerPage, (i + 1) * poisPerPage);
        const resolvedPois = await resolvePoiIds(pagePoiIds);

        // Mettre à jour metadata (+ réparer inspiration_id si absent)
        await db.collection('pages').updateOne(
          { _id: pageDoc._id },
          { $set: {
            'metadata.inspiration_id':       inspirationId,
            'metadata.inspiration_pois_ids': pagePoiIds,
            'metadata.inspiration_pois':     resolvedPois,
            updated_at: new Date().toISOString(),
          }}
        );

        // Relancer le service inspiration_poi_cards
        const template = await db.collection('templates').findOne({ _id: new ObjectId(pageDoc.template_id) });
        const repField  = ((template?.fields ?? []) as any[]).find((f: any) => f.service_id === 'inspiration_poi_cards');
        const updatedContent: Record<string, string> = { ...(pageDoc.content ?? {}) };

        if (repField) {
          try {
            const svcResult = await runner.run('inspiration_poi_cards', {
              guideId,
              guide:            guide ?? {},
              currentPage:      { ...pageDoc, metadata: { ...pageDoc.metadata, inspiration_pois: resolvedPois } },
              allExportedPages: [],
              db,
              fieldDef:         repField,
            });
            updatedContent[repField.name] = svcResult.value;
            if (repField.type === 'repetitif' && svcResult.value) {
              Object.assign(updatedContent, explodeRepetitifField(repField.name, svcResult.value));
            }
          } catch (svcErr: any) {
            console.warn(`⚠️ [sync-inspiration-pages] Service échoué page ${pageDoc._id}: ${svcErr.message}`);
          }
        }

        await db.collection('pages').updateOne(
          { _id: pageDoc._id },
          { $set: { content: updatedContent, updated_at: new Date().toISOString() } }
        );
        pagesUpdated++;
      }

      console.log(`✅ [sync-inspiration-pages] ${pagesUpdated} page(s) synchronisée(s) pour inspiration ${inspirationId}`);
      return reply.send({ success: true, pagesUpdated, poisTotal: newPoisIds.length });
    } catch (error: any) {
      console.error(`❌ [sync-inspiration-pages]`, error);
      return reply.status(500).send({ error: 'Erreur lors de la synchronisation', details: error.message });
    }
  });

  /**
   * POST /workers/rebuild-inspiration-sections
   * Recalcule le bon nombre de pages inspiration dans le chemin de fer
   * (crée les pages manquantes, supprime les excédentaires) puis redistribue
   * les POIs selon les lieux_associes à jour de l'étape 4.
   * Ne touche PAS aux pages POI, saison, fixes.
   */
  fastify.post('/workers/rebuild-inspiration-sections', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId } = request.body as { guideId: string };

    try {
      console.log(`\n🔄 [rebuild-inspiration-sections] START — guideId: ${guideId}`);

      // 1. Inspirations (étape 4)
      const inspDoc          = await db.collection('inspirations').findOne({ guide_id: guideId });
      const allInspirations: any[] = inspDoc?.inspirations ?? [];
      console.log(`📋 [rebuild] inspirations collection: ${inspDoc ? 'trouvé' : 'ABSENT'}, ${allInspirations.length} inspiration(s)`);
      allInspirations.forEach((ins: any, i: number) => {
        console.log(`   [${i}] "${ins.titre}" — theme_id: ${ins.theme_id ?? 'N/A'}, lieux_associes: ${(ins.lieux_associes ?? []).length}`);
      });

      if (allInspirations.length === 0) {
        return reply.send({ success: true, message: 'Aucune inspiration', pagesCreated: 0, pagesDeleted: 0, pagesUpdated: 0 });
      }

      // 2. Chemin de fer
      const cheminDeFerDoc = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
      if (!cheminDeFerDoc) {
        console.error(`❌ [rebuild] chemins_de_fer introuvable pour guideId: ${guideId}`);
        return reply.status(404).send({ error: 'Chemin de fer introuvable' });
      }
      const cheminDeFerId = cheminDeFerDoc._id.toString();
      console.log(`📎 [rebuild] chemin de fer _id: ${cheminDeFerId}`);

      // 3. Audit des pages existantes dans ce chemin de fer
      const allPages = await db.collection('pages').find({ chemin_de_fer_id: cheminDeFerId }).toArray();
      console.log(`📄 [rebuild] total pages (chemin_de_fer_id=${cheminDeFerId}): ${allPages.length}`);
      const inspiPages = allPages.filter((p: any) => p.metadata?.page_type === 'inspiration');
      console.log(`💡 [rebuild] pages page_type=inspiration: ${inspiPages.length}`);
      if (inspiPages.length > 0) {
        inspiPages.forEach((p: any, i: number) => {
          console.log(`   [${i}] id=${p._id} titre="${p.metadata?.inspiration_title}" inspiration_id="${p.metadata?.inspiration_id}" pois_ids: ${(p.metadata?.inspiration_pois_ids ?? []).length} pois: ${(p.metadata?.inspiration_pois ?? []).length}`);
        });
      } else {
        // Échantillon des pages existantes pour diagnostic
        const sample = allPages.slice(0, 3);
        console.log(`⚠️ [rebuild] Aucune page inspiration trouvée. Échantillon des pages existantes:`);
        sample.forEach((p: any, i: number) => {
          console.log(`   [${i}] id=${p._id} chemin_de_fer_id="${p.chemin_de_fer_id}" page_type="${p.metadata?.page_type}" template="${p.template_name}"`);
        });
      }

      // 4. pois_per_page depuis le guide template (défaut 6)
      const guideTemplateDoc = await db.collection('guide_templates').findOne({ guide_id: guideId });
      const guideTemplate    = guideTemplateDoc ?? await db.collection('guide_templates').findOne({ is_default: true });
      const poisPerPage: number = (() => {
        for (const block of (guideTemplate?.sections ?? [])) {
          if (block.source === 'inspirations' && block.pois_per_page) return block.pois_per_page;
          for (const sub of (block.blocks ?? [])) {
            if (sub.source === 'inspirations' && sub.pois_per_page) return sub.pois_per_page;
          }
        }
        return 6;
      })();
      console.log(`📐 [rebuild] poisPerPage: ${poisPerPage}`);

      // 5. Données guide + pois_selection
      const guide    = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      const poisDoc  = await db.collection('pois_selection').findOne({ guide_id: guideId });
      const allPois: any[] = poisDoc?.pois ?? [];
      const guideLang: string = guide?.language ?? guide?.langue ?? 'fr';
      const sampleIds = allPois.slice(0, 3).map((p: any) => p.poi_id);
      console.log(`🗺️ [rebuild] pois_selection: ${poisDoc ? `${allPois.length} POIs` : 'ABSENT'}, langue: ${guideLang}`);
      console.log(`🔑 [rebuild] Échantillon poi_id pois_selection: ${JSON.stringify(sampleIds)}`);
      const urlCache: Record<string, string | null> = {};

      // Fallback: POIs du sommaire AI (poi_ids slug-based) → résolution par nom
      const sommaireDoc = await db.collection('sommaire_proposals').findOne({ guide_id: guideId });
      const sommairePois: any[] = sommaireDoc?.proposal?.pois ?? [];
      // Map: old sommaire poi_id → { nom, article_source }
      const sommairePoisMap: Record<string, { nom: string; article_source?: string }> = {};
      for (const sp of sommairePois) {
        if (sp.poi_id) sommairePoisMap[sp.poi_id] = { nom: sp.nom, article_source: sp.article_source };
      }
      // Map: nom normalisé → pois_selection entry (pour matching par nom)
      const poisByNom: Record<string, any> = {};
      for (const p of allPois) {
        poisByNom[p.nom?.toLowerCase()?.trim()] = p;
      }
      console.log(`📚 [rebuild] sommaire_proposals: ${sommairePois.length} POIs de référence`);

      const resolvePoiIds = async (ids: string[]) => {
        const out: Array<{ poi_id: string; nom: string; url_source: string | null }> = [];
        for (const id of ids) {
          // 1er choix : correspondance directe par poi_id dans pois_selection
          let poi = allPois.find((x: any) => x.poi_id === id);

          if (!poi) {
            // 2ème choix : l'ID vient du sommaire AI → retrouver le nom, puis matcher dans pois_selection
            const somPoi = sommairePoisMap[id];
            if (somPoi) {
              poi = poisByNom[somPoi.nom?.toLowerCase()?.trim()];
              if (poi) {
                console.log(`   🔄 POI "${id}" (sommaire) → trouvé via nom "${somPoi.nom}" → poi_id="${poi.poi_id}"`);
              } else {
                // 3ème choix : utiliser le nom du sommaire sans URL
                console.warn(`   ⚠️ POI "${id}" → nom sommaire "${somPoi.nom}" non trouvé dans pois_selection, utilisé sans URL`);
                out.push({ poi_id: id, nom: somPoi.nom, url_source: null });
                continue;
              }
            } else {
              console.warn(`   ⚠️ POI "${id}" introuvable dans pois_selection ni sommaire_proposals`);
              continue;
            }
          }

          let url: string | null = null;
          const slug: string | undefined = poi.article_source;
          if (slug) {
            if (!(slug in urlCache)) {
              const art = await db.collection('articles_raw').findOne({ slug }, { projection: { urls_by_lang: 1 } });
              urlCache[slug] = art?.urls_by_lang?.[guideLang] ?? art?.urls_by_lang?.['fr'] ?? null;
            }
            url = urlCache[slug];
          }
          out.push({ poi_id: poi.poi_id, nom: poi.nom, url_source: url });
        }
        return out;
      };

      // Trouver une page inspiration existante comme référence (template, section_id, etc.)
      const samplePage = inspiPages[0] ?? null;
      if (samplePage) {
        console.log(`📌 [rebuild] Page de référence: id=${samplePage._id} template="${samplePage.template_name}"`);
      } else {
        console.warn(`⚠️ [rebuild] Aucune page de référence — les nouvelles pages auront template='INSPIRATION'`);
      }

      // ── Supprimer toutes les pages inspiration (orphelines + fantômes sans metadata) ──
      const validInspirationIds = new Set(
        allInspirations.map((ins: any) => ins.theme_id ?? ins.inspiration_id).filter(Boolean)
      );
      const validInspirationTitles = new Set(
        allInspirations.map((ins: any) => ins.titre).filter(Boolean)
      );

      // Pages orphelines : metadata.page_type=inspiration mais inspiration supprimée
      const orphanPages = inspiPages.filter((p: any) => {
        const id = p.metadata?.inspiration_id;
        const title = p.metadata?.inspiration_title;
        return !validInspirationIds.has(id) && !validInspirationTitles.has(title);
      });

      // Pages fantômes : titre ressemble à une inspiration (ex: "Plages secrètes (1/1)") mais
      // metadata.page_type est absent ou incorrect — restes de rebuilds précédents bugués
      const allInspirationTitlesRegex = allInspirations.map((ins: any) => {
        const titre: string = ins.titre ?? '';
        // Échappe les caractères spéciaux regex
        const escaped = titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escaped}(\\s*\\(\\d+\\/\\d+\\))?$`);
      });
      const ghostPages = allPages.filter((p: any) => {
        if (p.metadata?.page_type === 'inspiration') return false; // déjà dans inspiPages
        const titre: string = p.titre ?? '';
        return allInspirationTitlesRegex.some(rx => rx.test(titre));
      });

      const toDelete = [...orphanPages, ...ghostPages];
      if (toDelete.length > 0) {
        console.log(`🗑️ [rebuild] Suppression de ${toDelete.length} page(s) obsolètes/fantômes:`);
        orphanPages.forEach((p: any) => {
          console.log(`   - orpheline: "${p.metadata?.inspiration_title}" (id=${p._id})`);
        });
        ghostPages.forEach((p: any) => {
          console.log(`   - fantôme: "${p.titre}" (id=${p._id}, page_type=${p.metadata?.page_type ?? 'absent'})`);
        });
        await db.collection('pages').deleteMany({
          _id: { $in: toDelete.map((p: any) => p._id) },
        });
      } else {
        console.log(`✅ [rebuild] Aucune page orpheline/fantôme à supprimer`);
      }

      const runner = new FieldServiceRunner();
      let pagesCreated = 0, pagesDeleted = toDelete.length, pagesUpdated = 0;

      for (const inspiration of allInspirations) {
        const lieux: string[] = inspiration.lieux_associes ?? [];
        if (lieux.length === 0) {
          console.log(`⏭️ [rebuild] "${inspiration.titre}" ignorée (0 POI)`);
          continue;
        }

        const inspirationId: string = inspiration.theme_id ?? inspiration.inspiration_id;
        const neededCount = Math.ceil(lieux.length / poisPerPage);
        console.log(`\n💡 [rebuild] "${inspiration.titre}" — id: ${inspirationId}, ${lieux.length} POIs → ${neededCount} page(s) nécessaire(s)`);

        // Trouver les pages existantes pour cette inspiration
        const existingPages = inspiPages.filter((p: any) =>
          p.metadata?.inspiration_id === inspirationId ||
          p.metadata?.inspiration_title === inspiration.titre
        ).sort((a: any, b: any) => (a.metadata?.page_index ?? 0) - (b.metadata?.page_index ?? 0));

        console.log(`   → Pages existantes trouvées: ${existingPages.length}`);

        // ── Supprimer les pages en excès ──────────────────────────────────────
        if (existingPages.length > neededCount) {
          const toDelete = existingPages.slice(neededCount);
          console.log(`   🗑️ Suppression de ${toDelete.length} page(s) en excès`);
          await db.collection('pages').deleteMany({
            _id: { $in: toDelete.map((p: any) => p._id) },
          });
          pagesDeleted += toDelete.length;
          existingPages.splice(neededCount);
        }

        // ── Créer les pages manquantes ────────────────────────────────────────
        const refPage = existingPages[0] ?? samplePage;
        const now = new Date().toISOString();
        const toCreate = neededCount - existingPages.length;
        if (toCreate > 0) {
          console.log(`   ➕ Création de ${toCreate} page(s) manquante(s)`);
        }
        while (existingPages.length < neededCount) {
          const newPage: any = {
            guide_id:         guideId,
            chemin_de_fer_id: cheminDeFerId,
            template_name:    refPage?.template_name ?? 'INSPIRATION',
            template_id:      refPage?.template_id   ?? null,
            section_id:       refPage?.section_id    ?? null,
            section_name:     refPage?.section_name  ?? null,
            ordre:            (refPage?.ordre ?? refPage?.order ?? 0) + existingPages.length + 1,
            status:           'draft',
            content:          {},
            metadata:         { page_type: 'inspiration' },
            created_at:       now,
            updated_at:       now,
          };
          const inserted = await db.collection('pages').insertOne(newPage);
          existingPages.push({ ...newPage, _id: inserted.insertedId });
          pagesCreated++;
          console.log(`   ✅ Page créée: id=${inserted.insertedId}`);
        }

        // ── Mettre à jour chaque page avec la bonne tranche de POIs ──────────
        const pages = existingPages.slice(0, neededCount);
        const templateDoc = pages[0]?.template_id
          ? await db.collection('templates').findOne({ _id: new ObjectId(pages[0].template_id) })
          : await db.collection('templates').findOne({ name: pages[0]?.template_name ?? 'INSPIRATION' });
        const repField = ((templateDoc?.fields ?? []) as any[]).find((f: any) => f.service_id === 'inspiration_poi_cards');
        console.log(`   📋 Template trouvé: ${templateDoc ? templateDoc.name : 'ABSENT'}, repField: ${repField ? repField.name : 'non configuré'}`);

        for (let i = 0; i < pages.length; i++) {
          const pageDoc  = pages[i];
          const pageIds  = lieux.slice(i * poisPerPage, (i + 1) * poisPerPage);
          const resolved = await resolvePoiIds(pageIds);

          const totalPages = pages.length;
          const newTitle   = totalPages > 1
            ? `${inspiration.titre} (${i + 1}/${totalPages})`
            : inspiration.titre;

          console.log(`   📝 Page ${i + 1}/${totalPages}: "${newTitle}" — ${pageIds.length} POI IDs → ${resolved.length} résolus`);

          await db.collection('pages').updateOne(
            { _id: pageDoc._id },
            { $set: {
              titre:                           newTitle,
              'metadata.inspiration_id':       inspirationId,
              'metadata.inspiration_title':    inspiration.titre,
              'metadata.inspiration_pois_ids': pageIds,
              'metadata.inspiration_pois':     resolved,
              'metadata.page_index':           i + 1,
              'metadata.total_pages':          totalPages,
              updated_at:                      now,
            }}
          );

          // Relancer le service inspiration_poi_cards si configuré
          if (repField) {
            try {
              const svcResult = await runner.run('inspiration_poi_cards', {
                guideId,
                guide:            guide ?? {},
                currentPage:      { ...pageDoc, metadata: { ...pageDoc.metadata, inspiration_pois: resolved } },
                allExportedPages: [],
                db,
                fieldDef:         repField,
              });
              const updatedContent: Record<string, string> = { ...(pageDoc.content ?? {}), [repField.name]: svcResult.value };
              if (repField.type === 'repetitif' && svcResult.value) {
                Object.assign(updatedContent, explodeRepetitifField(repField.name, svcResult.value));
              }
              await db.collection('pages').updateOne(
                { _id: pageDoc._id },
                { $set: { content: updatedContent, updated_at: now } }
              );
              console.log(`   🤖 Service inspiration_poi_cards OK`);
            } catch (svcErr: any) {
              console.warn(`   ⚠️ Service échoué: ${svcErr.message}`);
            }
          }
          pagesUpdated++;
        }

        console.log(`✅ [rebuild] "${inspiration.titre}": ${pages.length} page(s) OK (+${toCreate} créées, -${Math.max(0, existingPages.length - neededCount - toCreate)} supprimées)`);
      }

      console.log(`\n✅ [rebuild-inspiration-sections] DONE — créées: ${pagesCreated}, supprimées: ${pagesDeleted}, mises à jour: ${pagesUpdated}`);
      return reply.send({ success: true, pagesCreated, pagesDeleted, pagesUpdated });
    } catch (error: any) {
      console.error('❌ [rebuild-inspiration-sections]', error);
      return reply.status(500).send({ error: 'Erreur rebuild', details: error.message });
    }
  });

  /**
   * POST /workers/refresh-inspiration-pois
   * Ré-résout la liste des POIs d'une page inspiration à partir de inspiration_pois_ids
   * puis relance le service inspiration_poi_cards.
   *
   * À appeler après avoir modifié la liste des POIs dans le chemin de fer (étape 4).
   */
  fastify.post('/workers/refresh-inspiration-pois', async (request, reply) => {
    const db = request.server.container.db;
    const { pageId } = request.body as { pageId: string };

    try {
      const page = await db.collection('pages').findOne({ _id: new ObjectId(pageId) });
      if (!page) return reply.status(404).send({ error: 'Page introuvable' });

      const guideId: string = page.guide_id?.toString();
      if (!guideId) return reply.status(400).send({ error: 'guide_id manquant sur la page' });

      const poisIds: string[] = page.metadata?.inspiration_pois_ids ?? [];
      if (poisIds.length === 0) {
        return reply.status(400).send({ error: 'Aucun inspiration_pois_ids dans les métadonnées de la page' });
      }

      console.log(`🔄 [refresh-inspiration-pois] Page ${pageId} — ${poisIds.length} POI(s) à ré-résoudre`);

      // 1. Charger les données du guide
      const guide  = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      const poisDoc = await db.collection('pois_selection').findOne({ guide_id: guideId });
      const allPois: any[] = poisDoc?.pois ?? [];

      const guideLang: string = guide?.language ?? guide?.langue ?? 'fr';

      // 2. Ré-résoudre chaque POI : nom + url_source WordPress
      const articleUrlCache: Record<string, string | null> = {};
      const resolvedPois: Array<{ poi_id: string; nom: string; url_source: string | null }> = [];

      for (const poiId of poisIds) {
        const poi = allPois.find((x: any) => x.poi_id === poiId);
        if (!poi) {
          console.warn(`  ⚠️ POI ${poiId} introuvable dans pois_selection`);
          continue;
        }

        let poiUrl: string | null = null;
        const poiSlug: string | undefined = poi.article_source;
        if (poiSlug) {
          if (!(poiSlug in articleUrlCache)) {
            const artDoc = await db.collection('articles_raw').findOne(
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

        resolvedPois.push({ poi_id: poi.poi_id, nom: poi.nom, url_source: poiUrl });
      }

      console.log(`  ✅ ${resolvedPois.length} POI(s) résolus`);

      // 3. Mettre à jour metadata.inspiration_pois en DB
      await db.collection('pages').updateOne(
        { _id: new ObjectId(pageId) },
        { $set: { 'metadata.inspiration_pois': resolvedPois, updated_at: new Date().toISOString() } }
      );

      // 4. Relancer le service inspiration_poi_cards
      const template = await db.collection('templates').findOne({ _id: new ObjectId(page.template_id) });
      const repField = ((template?.fields ?? []) as any[]).find(
        (f: any) => f.service_id === 'inspiration_poi_cards'
      );

      const updatedContent: Record<string, string> = { ...(page.content ?? {}) };

      if (repField) {
        const runner = new FieldServiceRunner();
        const svcResult = await runner.run('inspiration_poi_cards', {
          guideId,
          guide:            guide ?? {},
          currentPage:      { ...page, metadata: { ...page.metadata, inspiration_pois: resolvedPois } },
          allExportedPages: [],
          db,
          fieldDef:         repField,
        });

        updatedContent[repField.name] = svcResult.value;

        if (repField.type === 'repetitif' && svcResult.value) {
          const flat = explodeRepetitifField(repField.name, svcResult.value);
          Object.assign(updatedContent, flat);
        }

        console.log(`  ✅ Service inspiration_poi_cards relancé → ${repField.name}`);
      } else {
        console.warn(`  ⚠️ Aucun champ inspiration_poi_cards dans le template — contenu non recalculé`);
      }

      // 5. Sauvegarder le contenu mis à jour
      await db.collection('pages').updateOne(
        { _id: new ObjectId(pageId) },
        { $set: { content: updatedContent, updated_at: new Date().toISOString() } }
      );

      return reply.send({
        success:      true,
        pageId,
        poisResolved: resolvedPois.length,
        poisIds,
      });
    } catch (error: any) {
      console.error(`❌ [refresh-inspiration-pois]`, error);
      return reply.status(500).send({ error: 'Erreur lors du rafraîchissement', details: error.message });
    }
  });

  /**
   * POST /workers/generate-pois
   * Worker pour générer les POIs depuis les articles WordPress via IA
   * Traitement par batch pour un recensement exhaustif, suivi d'un appel de déduplication.
   * Appelé par QStash de manière asynchrone
   */
  fastify.post('/workers/generate-pois', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    try {
      console.log(`🚀 [WORKER] Génération POIs par batch pour guide ${guideId}`);

      // Garde anti-doublon : refuser si un autre job est déjà en cours pour ce guide
      const existingProcessing = await db.collection('pois_generation_jobs').findOne({
        guide_id: guideId,
        status: 'processing',
        _id: { $ne: new ObjectId(jobId) },
        // Ignorer les jobs bloqués depuis plus de 30 minutes
        updated_at: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      });
      if (existingProcessing) {
        console.warn(`⚠️ [WORKER] Job ${existingProcessing._id} déjà en cours pour guide ${guideId} — abandon du doublon ${jobId}`);
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'failed', error: 'Doublon : un job est déjà en cours', updated_at: new Date() } }
        );
        return reply.send({ success: false, reason: 'duplicate' });
      }

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'processing', updated_at: new Date() } }
      );

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      const { OpenAIService } = await import('../services/openai.service');

      const openaiService = new OpenAIService({
        apiKey: openaiApiKey,
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
      });

      // 1. Charger le guide
      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      if (!guide) throw new Error('Guide non trouvé');

      const destination: string = guide.destination;
      if (!destination) throw new Error('Aucune destination définie pour ce guide');

      // 2. Récupérer les articles WordPress filtrés par destination
      const destinationFilter = { categories: { $regex: destination, $options: 'i' } };

      const articles = await db
        .collection('articles_raw')
        .find(destinationFilter)
        .project({ title: 1, slug: 1, markdown: 1, url: 1 })
        .toArray();

      if (articles.length === 0) {
        throw new Error(`Aucun article WordPress trouvé pour la destination "${destination}"`);
      }

      console.log(`📚 ${articles.length} articles chargés pour "${destination}"`);

      // 3. Charger les prompts depuis la DB par leur ID unique
      const PROMPT_ID_EXTRACTION = process.env.PROMPT_ID_POI_EXTRACTION ?? 'prompt_1770544848350_9j5m305ukj';
      const PROMPT_ID_DEDUP      = process.env.PROMPT_ID_POI_DEDUP      ?? 'deduplication_POI_24022026';

      const promptExtractionDoc = await db.collection('prompts').findOne({ prompt_id: PROMPT_ID_EXTRACTION });
      if (!promptExtractionDoc) {
        throw new Error(`Prompt d'extraction POI non trouvé (id: ${PROMPT_ID_EXTRACTION})`);
      }
      console.log(`📋 Prompt extraction: ${promptExtractionDoc.prompt_nom || promptExtractionDoc.prompt_id}`);

      // Prompt de déduplication (optionnel — fallback intégré si absent)
      const promptDedupDoc = await db.collection('prompts').findOne({ prompt_id: PROMPT_ID_DEDUP });
      if (promptDedupDoc) {
        console.log(`📋 Prompt dédup: ${promptDedupDoc.prompt_nom || promptDedupDoc.prompt_id}`);
      } else {
        console.log(`📋 Prompt dédup: id "${PROMPT_ID_DEDUP}" non trouvé, utilisation du prompt par défaut`);
      }

      // ─── Helper : extraction H2/H3 (utilisé pour les articles multi-POI) ──────

      function extractHeadings(markdown: string): string[] {
        return markdown
          .split('\n')
          .filter(line => /^#{2,3}\s/.test(line))
          .map(line => line.replace(/^#{2,3}\s+/, '').trim())
          .filter(h => h.length > 2);
      }

      // ─── 4. Classification IA des articles ──────────────────────────────────
      // Payload ultra-léger : on envoie uniquement les titres

      console.log(`🤖 Classification IA de ${(articles as any[]).length} articles...`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { progress: `Classification IA de ${(articles as any[]).length} articles...`, updated_at: new Date() } }
      );

      const articleTitlesList = (articles as any[])
        .map((a: any, i: number) => `${i}. ${a.title}`)
        .join('\n');

      const classificationSystemPrompt = `Tu es un expert en contenu touristique. Classifie chaque article dans l'une de ces 3 catégories :

- "mono" : l'article est entièrement consacré à UN SEUL lieu touristique précis et localisable (une plage spécifique, un site naturel, un monument, un village, une piscine naturelle, un mirador, un belvédère, etc.). Le nom du lieu principal est dans le titre.
- "multi" : l'article présente ou liste PLUSIEURS lieux touristiques distincts (guides "que faire à X", tops N lieux, itinéraires, listes de plages/jardins/villages, "pourquoi visiter", etc.)
- "exclude" : l'article ne génère pas de POI pertinent pour un guide touristique. Exemples : hôtels/hébergements/apparthotels, transport/location de voiture/comment se déplacer, météo/saisons/quand partir/combien de jours, guides pratiques généraux, comparaisons de destinations.

Pour les articles "mono", indique également le poi_name : le nom propre du lieu, sans les suffixes descriptifs comme "conseils + photos", "avis + photos", etc.

Retourne STRICTEMENT un objet JSON valide, sans texte additionnel :
{ "classifications": [{ "index": 0, "type": "mono|multi|exclude", "poi_name": "string ou null", "reason": "explication courte" }] }`;

      let aiClassifications: Array<{ index: number; type: 'mono' | 'multi' | 'exclude'; poi_name: string | null; reason: string }> = [];

      try {
        const classifResult = await openaiService.generateJSON(
          `${classificationSystemPrompt}\n\nArticles à classifier :\n${articleTitlesList}`,
          8000
        );
        aiClassifications = (classifResult as any).classifications || [];
        console.log(`✅ Classification IA : ${aiClassifications.length} articles classifiés`);
      } catch (err: any) {
        console.error(`❌ Erreur classification IA : ${err.message} — fallback classification "multi" pour tous`);
        aiClassifications = (articles as any[]).map((_: any, i: number) => ({
          index: i, type: 'multi' as const, poi_name: null, reason: 'fallback (erreur IA)',
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

        classificationLog.push({
          title: article.title,
          url: article.url || article.slug,
          type: classif.type,
          reason: classif.reason,
          poiName: classif.poi_name || undefined,
          headingCount: headings.length || undefined,
        });

        if (classif.type === 'mono') {
          monoArticles.push({ ...article, _poi_name: classif.poi_name || article.title, _classification: classif });
        } else if (classif.type === 'multi') {
          multiArticles.push({ ...article, _headings: headings, _classification: classif });
        } else {
          excludedArticles.push({ ...article, _classification: classif });
        }
      }

      console.log(`📊 Classification: ${monoArticles.length} mono-POI, ${multiArticles.length} multi-POI, ${excludedArticles.length} exclus`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            classification_log: classificationLog,
            mono_count: monoArticles.length,
            multi_count: multiArticles.length,
            excluded_count: excludedArticles.length,
            updated_at: new Date(),
          },
        }
      );

      const allRawPois: any[] = [];
      const previewBatches: any[] = [];

      // ─── 5a. Articles mono-POI : extraction directe, sans IA ────────────────

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

      console.log(`✅ Mono-POI: ${monoArticles.length} POIs extraits directement`);

      // Sauvegarde intermédiaire des mono-POIs
      if (monoArticles.length > 0) {
        previewBatches.push({
          batch_num: 0,
          total_batches: 0,
          label: `${monoArticles.length} articles mono-POI (extraction directe)`,
          articles: monoArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug })),
          pois: allRawPois.filter(p => p._extraction_mode === 'mono'),
          is_mono_batch: true,
        });
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { preview_pois: [...allRawPois], preview_batches: [...previewBatches], updated_at: new Date() } }
        );
      }

      // ─── 5b. Articles multi-POI : extraction par batch via IA ───────────────

      /**
       * Normalise la réponse IA quel que soit le format retourné :
       * { pois: [...] }, { articles: [{ slug, pois: [...] }] }, { "slug": [...] }, [...]
       */
      function normalizePoisFromResult(result: any): any[] | null {
        if (!result || typeof result !== 'object') return null;
        if (Array.isArray(result.pois)) return result.pois;
        if (Array.isArray(result)) return result;
        if (Array.isArray(result.articles)) {
          const flat: any[] = [];
          for (const art of result.articles) {
            const subPois = art.pois || art.lieux || art.points_of_interest;
            if (Array.isArray(subPois)) {
              subPois.forEach((p: any) => flat.push({
                ...p,
                article_source: p.article_source || art.title || art.slug || '',
                url_source: p.url_source || art.url || art.slug || '',
              }));
            }
          }
          return flat.length > 0 ? flat : [];
        }
        const values = Object.values(result);
        if (values.length > 0 && values.every(v => Array.isArray(v))) {
          const flat: any[] = [];
          for (const [slug, pois] of Object.entries(result)) {
            (pois as any[]).forEach((p: any) => flat.push({
              ...p,
              article_source: p.article_source || slug,
              url_source: p.url_source || slug,
            }));
          }
          return flat.length > 0 ? flat : [];
        }
        return null;
      }

      const BATCH_SIZE = 5;
      const total = multiArticles.length;
      const totalBatches = Math.ceil(total / BATCH_SIZE);

      console.log(`📊 Multi-POI: ${total} articles → ${totalBatches} batches de ${BATCH_SIZE}`);

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchNum = batchIdx + 1;

        // Vérifier à chaque batch si le job a été annulé
        const currentJob = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
        if (!currentJob || currentJob.status === 'cancelled') {
          console.log(`🛑 [WORKER] Job ${jobId} annulé — arrêt à batch ${batchNum}/${totalBatches}`);
          return reply.send({ success: false, reason: 'cancelled' });
        }

        const batchArticles = multiArticles.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE) as any[];
        const firstArticleNum = batchIdx * BATCH_SIZE + 1;

        console.log(`🔄 Batch ${batchNum}/${totalBatches} — articles ${firstArticleNum}-${firstArticleNum + batchArticles.length - 1}`);

        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'processing', progress: `Batch ${batchNum}/${totalBatches}`, updated_at: new Date() } }
        );

        // Filtrer les articles vides
        const validArticles = batchArticles.filter((a: any) => (a.markdown || '').trim());
        if (validArticles.length === 0) {
          console.log(`  ⚠️ Batch ${batchNum}: tous les articles sont vides, ignoré`);
          continue;
        }


        // Construire un article_source lookup pour la correction post-réponse
        const articleByTitle: Record<string, any> = {};
        const articleByUrl: Record<string, any> = {};
        for (const a of validArticles) {
          articleByTitle[a.title.toLowerCase()] = a;
          if (a.url) articleByUrl[a.url] = a;
          if (a.slug) articleByUrl[a.slug] = a;
        }

        // Prompt dédié H2/H3 : plus fiable que d'injecter les headings dans le prompt utilisateur
        // qui attend un contenu d'article complet.
        const h2h3PerArticle = validArticles.map((a: any, idx: number) => {
          const headings = extractHeadings(a.markdown || '');
          // Filtrer les headings génériques (intro, conseils, FAQ, etc.)
          const GENERIC = /^(introduction|présentation|conseils|conseil|pratique|infos?|FAQ|résumé|conclusion|en bref|contact|accès|horaire|tarif|prix|comment|pourquoi|où|quand|notre avis|notre sélection|pour aller plus loin|autres|suite)/i;
          const poiCandidates = headings.filter(h => !GENERIC.test(h.trim()) && h.trim().length > 3);
          return `Article ${idx + 1}: "${a.title}" (URL: ${a.url || a.slug})\nTitres H2/H3 candidats POI:\n${poiCandidates.map(h => `  • ${h}`).join('\n') || '  (aucun titre POI identifié)'}`;
        }).join('\n\n');

        const extractionPrompt = `Tu es un expert en sélection touristique pour des guides de voyage.

Destination : ${destination}
Site : ${guide.wpConfig?.siteUrl || ''}

Pour chaque article ci-dessous, extrais UNIQUEMENT les lieux touristiques réels (POI) à partir des titres H2/H3.

Règles de sélection :
- Un POI est un lieu précis et localisable : musée, site naturel, plage, village, monument, panorama, jardin, etc.
- Les titres numérotés ("1. Nom du lieu", "2. Nom du lieu") sont généralement des POIs
- IGNORER les sections génériques : introduction, conseils pratiques, FAQ, tarifs, horaires, "pourquoi visiter", "notre avis"
- IGNORER les hébergements et restaurants
- article_source = titre de l'article dont est issu le POI
- url_source = URL de l'article source

Articles à traiter :
${h2h3PerArticle}

Exclusions strictes : hôtels, hébergements, restaurants, bars, commerces.

Retourne STRICTEMENT un JSON valide sans texte additionnel :
{ "pois": [ { "poi_id": "slug_unique", "nom": "Nom du POI", "type": "musée|site_culturel|village|ville|plage|site_naturel|panorama|quartier|autre", "article_source": "titre de l'article", "url_source": "url de l'article", "mentions": "principale", "raison_selection": "max 120 caractères", "autres_articles_mentions": [] } ] }`;

        const MAX_RETRIES = 3;
        let batchSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 1) {
              const delay = attempt * 5000;
              console.log(`  ⏳ Batch ${batchNum} — retry ${attempt}/${MAX_RETRIES} dans ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }

            const result = await openaiService.generateJSON(extractionPrompt, 24000);

            const rawList = normalizePoisFromResult(result);

            // Normalise les noms de champs (l'IA peut retourner name/nom, slug/poi_id, etc.)
            const poisList = rawList === null ? null : rawList.map((p: any) => ({
              poi_id: p.poi_id || p.id || p.slug || (p.nom || p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              nom: p.nom || p.name || p.titre || p.label || '',
              type: p.type || p.category || p.categorie || 'autre',
              article_source: p.article_source || p.source || p.slug_source || '',
              url_source: p.url_source || p.url || p.source_url || '',
              mentions: p.mentions || p.mention || 'principale',
              raison_selection: p.raison_selection || p.reason || p.description || p.raison || '',
              autres_articles_mentions: p.autres_articles_mentions || p.other_articles || [],
            })).filter((p: any) => p.nom); // exclure les POIs sans nom

            if (poisList === null) {
              // Format non reconnu → on logue et on retry
              console.warn(`  ⚠️ Batch ${batchNum} — format JSON non reconnu, clés: ${Object.keys(result || {}).join(', ')} — retry`);
              throw new Error(`Format JSON non reconnu: ${JSON.stringify(result).substring(0, 200)}`);
            }

            // poisList peut être vide (aucun POI dans ce batch) → on marque succès directement
            if (poisList.length === 0) {
              console.log(`  ✅ Batch ${batchNum}: aucun POI dans ce batch (0 résultat)`);
              previewBatches.push({
                batch_num: batchNum,
                total_batches: totalBatches,
                label: `Batch ${batchNum}/${totalBatches} — multi-POI`,
                articles: validArticles.map((a: any) => ({ title: a.title, url: a.url || a.slug })),
                pois: [],
              });
              batchSuccess = true;
              break;
            }

            if (poisList.length > 0) {
              const enriched = poisList.map((poi: any) => {
                // Corriger article_source si l'IA a renvoyé le titre du batch ou une valeur invalide
                const isBatchTitle = !poi.article_source ||
                  poi.article_source.startsWith('Batch ') ||
                  poi.article_source.startsWith('Lot de ');

                if (isBatchTitle || !poi.url_source) {
                  const matchByUrl = poi.url_source && articleByUrl[poi.url_source];
                  const matchByTitle = poi.article_source &&
                    validArticles.find((a: any) =>
                      a.title.toLowerCase().includes(poi.article_source.toLowerCase().substring(0, 20))
                    );
                  const fallback = matchByUrl || matchByTitle || validArticles[0];
                  return {
                    ...poi,
                    article_source: isBatchTitle ? fallback.title : poi.article_source,
                    url_source: poi.url_source && !isBatchTitle ? poi.url_source : (fallback.url || fallback.slug),
                  };
                }
                return poi;
              });
              const enrichedWithMode = enriched.map((p: any) => ({ ...p, _extraction_mode: 'multi' }));
              allRawPois.push(...enrichedWithMode);
              console.log(`  ✅ Batch ${batchNum}${attempt > 1 ? ` (après ${attempt} tentatives)` : ''}: ${enrichedWithMode.length} POIs (total: ${allRawPois.length})`);

              // Sauvegarde intermédiaire avec métadonnées du batch pour la modale
              previewBatches.push({
                batch_num: batchNum,
                total_batches: totalBatches,
                label: `Batch ${batchNum}/${totalBatches} — multi-POI`,
                articles: validArticles.map((a: any) => ({
                  title: a.title,
                  url: a.url || a.slug,
                  headings: extractHeadings(a.markdown || ''),
                })),
                pois: enrichedWithMode,
              });

              await db.collection('pois_generation_jobs').updateOne(
                { _id: new ObjectId(jobId) },
                { $set: { preview_pois: allRawPois, preview_batches: previewBatches, updated_at: new Date() } }
              );

              batchSuccess = true;
              break;
            }
          } catch (batchError: any) {
            console.error(`  ❌ Batch ${batchNum} — tentative ${attempt}/${MAX_RETRIES}: ${batchError.message}`);
            if (attempt === MAX_RETRIES) {
              console.error(`  ⛔ Batch ${batchNum} abandonné après ${MAX_RETRIES} tentatives`);
            }
          }
        }

        if (!batchSuccess) {
          console.warn(`  ⚠️ Batch ${batchNum} ignoré (${MAX_RETRIES} échecs consécutifs)`);
        }
      }

      if (allRawPois.length === 0) {
        throw new Error('Aucun POI extrait depuis les articles');
      }

      console.log(`📊 ${allRawPois.length} POIs bruts extraits — en attente du dédoublonnage manuel`);

      // 5. Marquer l'extraction comme terminée (sans déduplication ni sauvegarde dans pois_selection)
      // Le dédoublonnage et la confirmation sont déclenchés manuellement depuis l'interface
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'extraction_complete',
            raw_count: allRawPois.length,
            preview_pois: allRawPois,
            progress: null,
            updated_at: new Date(),
          },
        }
      );

      console.log(`✅ [WORKER] Extraction terminée: ${allRawPois.length} POIs bruts pour guide ${guideId} — en attente du dédoublonnage manuel`);

      return reply.send({
        success: true,
        raw_count: allRawPois.length,
        articles_processed: total,
        status: 'extraction_complete',
      });

    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur génération POIs:`, error);

      try {
        await db.collection('pois_generation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          { $set: { status: 'failed', error: error.message, progress: null, updated_at: new Date() } }
        );
      } catch (dbError) {
        console.error('Erreur mise à jour statut job:', dbError);
      }

      return reply.status(500).send({
        error: 'Erreur lors de la génération des POIs',
        details: error.message,
      });
    }
  });

  /**
   * POST /workers/deduplicate-pois
   * Worker asynchrone (appelé par QStash) pour dédoublonner les POIs extraits.
   */
  fastify.post('/workers/deduplicate-pois', async (request, reply) => {
    const db = request.server.container.db;
    const { guideId, jobId } = request.body as { guideId: string; jobId: string };

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /** Normalise un nom pour comparaison : minuscules, sans accents, sans ponctuation */
    function normalizeName(s: string): string {
      return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // supprime les accents
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Distance de Levenshtein entre deux chaînes */
    function levenshtein(a: string, b: string): number {
      const m = a.length, n = b.length;
      const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
      );
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
      return d[m][n];
    }

    /**
     * Phase 1 : déduplication algorithmique pure, sans LLM.
     *
     * Fusionne les POIs dont :
     *  (a) le nom normalisé est identique (doublons exacts)
     *  (b) la distance de Levenshtein entre noms normalisés est ≤ 2
     *  (c) l'un des noms normalisés est entièrement contenu dans l'autre
     *      ET les deux partagent le même premier mot significatif (≥ 4 chars)
     *
     * Pour chaque groupe, le POI conservé est celui qui possède le nom le plus court
     * (le plus canonique) et les autres_articles_mentions sont consolidés.
     */
    function deduplicateAlgorithmically(pois: any[]): { pois: any[]; groups: string[][] } {
      const norms = pois.map(p => normalizeName(p.nom));
      const n = pois.length;
      const parent = Array.from({ length: n }, (_, i) => i);

      function find(i: number): number {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
      }
      function union(i: number, j: number) {
        parent[find(i)] = find(j);
      }

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const ni = norms[i], nj = norms[j];

          // (a) identiques
          if (ni === nj) { union(i, j); continue; }

          // (b) Levenshtein ≤ 2 (seuil adaptatif selon longueur)
          const maxLen = Math.max(ni.length, nj.length);
          const threshold = maxLen <= 10 ? 1 : 2;
          if (levenshtein(ni, nj) <= threshold) { union(i, j); continue; }

          // (c) l'un contient l'autre + même premier mot significatif
          const firstWordI = ni.split(' ').find((w: string) => w.length >= 4) ?? '';
          const firstWordJ = nj.split(' ').find((w: string) => w.length >= 4) ?? '';
          if (firstWordI && firstWordI === firstWordJ && (ni.includes(nj) || nj.includes(ni))) {
            union(i, j);
          }
        }
      }

      // Construire les groupes
      const groups: Map<number, number[]> = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(i);
      }

      const fusedPois: any[] = [];
      const fusionGroups: string[][] = [];

      for (const members of groups.values()) {
        // Choisir le représentant : nom le plus court (le plus canonique)
        const sorted = members.sort((a, b) => pois[a].nom.length - pois[b].nom.length);
        const rep = pois[sorted[0]];

        // Consolider les mentions
        const allMentions = new Set<string>([
          ...(rep.autres_articles_mentions || []),
          ...sorted.slice(1).flatMap((idx: number) => pois[idx].autres_articles_mentions || []),
        ]);
        if (rep.article_source) allMentions.delete(rep.article_source);

        fusedPois.push({
          ...rep,
          autres_articles_mentions: Array.from(allMentions),
        });

        if (members.length > 1) {
          fusionGroups.push(members.map((idx: number) => pois[idx].nom));
        }
      }

      return { pois: fusedPois, groups: fusionGroups };
    }

    // ─── Worker ─────────────────────────────────────────────────────────────────

    try {
      console.log(`🔄 [WORKER-DEDUP] Dédoublonnage job ${jobId}`);

      const job = await db.collection('pois_generation_jobs').findOne({ _id: new ObjectId(jobId) });
      if (!job) throw new Error(`Job ${jobId} introuvable`);

      const rawPois: any[] = job.preview_pois || [];
      if (rawPois.length === 0) throw new Error('Aucun POI à dédoublonner');

      const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
      const destination: string = guide?.destination ?? '';

      // ── Phase 1 : déduplication algorithmique ─────────────────────────────────
      const { pois: afterAlgo, groups: algoGroups } = deduplicateAlgorithmically(rawPois);
      const removedAlgo = rawPois.length - afterAlgo.length;
      console.log(`🔢 [WORKER-DEDUP] Phase 1 algo : ${afterAlgo.length} POIs (${removedAlgo} fusionnés)`);
      if (algoGroups.length > 0) {
        algoGroups.slice(0, 20).forEach(g =>
          console.log(`  ↳ fusionné : ${g.join(' | ')}`)
        );
      }

      // ── Phase 2 : LLM — détection des groupes de doublons (sortie compacte) ─
      //
      // Stratégie : au lieu de demander au LLM de retourner la liste complète
      // dédoublonnée (sortie ~400 POIs = troncature JSON), on lui demande
      // UNIQUEMENT les groupes de doublons identifiés. La sortie est alors
      // très courte (~50 groupes max) et ne peut pas être tronquée.
      // Le merge est ensuite fait programmatiquement.

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) throw new Error('OPENAI_API_KEY non configurée');

      const { OpenAIService } = await import('../services/openai.service');
      const openaiService = new OpenAIService({ apiKey: openaiApiKey, model: 'gpt-5-mini', reasoningEffort: 'medium' });

      // Liste ultra-compacte : numéro + nom + type (≈ 10 tokens/POI)
      const compactList = afterAlgo
        .map((p: any, i: number) => `${i}|${p.nom} (${p.type})`)
        .join('\n');

      const dedupGroupsPrompt = `Tu es un expert en consolidation de données touristiques.
Destination : ${destination}
Voici ${afterAlgo.length} POIs numérotés (format: numéro|nom (type)) :

${compactList}

MISSION : Identifie UNIQUEMENT les groupes de doublons — des POIs qui désignent le MÊME lieu physique.

FUSIONNER si :
- Noms en langues différentes (ex: "Teide" = "Mount Teide" = "Pico del Teide")
- Variantes orthographiques / accents (ex: "Playa Fanabe" = "Playa de Fañabé")
- Même lieu avec/sans article ou précision géo (ex: "Aqualand" = "Aqualand Costa Adeje")

NE PAS FUSIONNER :
- Deux lieux distincts qui partagent un mot (ex : deux plages différentes)
- En cas de doute : ne pas fusionner

Pour chaque groupe, indique l'indice du POI à CONSERVER (le plus précis / nom le plus riche).

Retourne UNIQUEMENT ce JSON (sans markdown) :
{
  "groupes": [
    { "indices": [3, 17, 42], "garder": 3, "raison": "même lieu, 3 variantes" }
  ]
}

Si aucun doublon détecté : retourne { "groupes": [] }`;

      console.log(`🤖 [WORKER-DEDUP] Phase 2 LLM — détection groupes sur ${afterAlgo.length} POIs...`);
      const groupsResult = await openaiService.generateJSON(dedupGroupsPrompt, 4000);

      let dedupPois: any[] = [...afterAlgo];

      if (groupsResult.groupes && Array.isArray(groupsResult.groupes) && groupsResult.groupes.length > 0) {
        // Appliquer les fusions programmatiquement
        const toRemove = new Set<number>();

        for (const group of groupsResult.groupes) {
          const indices: number[] = group.indices ?? [];
          const keepIdx: number = group.garder ?? indices[0];

          if (!Number.isInteger(keepIdx) || keepIdx < 0 || keepIdx >= afterAlgo.length) continue;

          const keeper = afterAlgo[keepIdx];

          // Consolider les autres_articles_mentions dans le POI conservé
          const allMentions = new Set<string>(keeper.autres_articles_mentions || []);
          for (const idx of indices) {
            if (idx === keepIdx || !Number.isInteger(idx) || idx < 0 || idx >= afterAlgo.length) continue;
            const dup = afterAlgo[idx];
            if (dup.article_source && dup.article_source !== keeper.article_source) {
              allMentions.add(dup.article_source);
            }
            (dup.autres_articles_mentions || []).forEach((m: string) => allMentions.add(m));
            toRemove.add(idx);
          }

          // Mettre à jour le keeper dans le tableau de résultat
          dedupPois[keepIdx] = {
            ...keeper,
            autres_articles_mentions: Array.from(allMentions).filter(m => m !== keeper.article_source),
            alias_names: indices
              .filter(i => i !== keepIdx && Number.isInteger(i) && i >= 0 && i < afterAlgo.length)
              .map(i => afterAlgo[i].nom),
            dedup_confidence: group.raison ? 'certain' : 'probable',
          };
        }

        // Filtrer les doublons supprimés
        dedupPois = dedupPois.filter((_: any, i: number) => !toRemove.has(i));

        console.log(`✅ [WORKER-DEDUP] Phase 2 : ${groupsResult.groupes.length} groupes détectés, ${toRemove.size} doublons supprimés`);
        groupsResult.groupes.slice(0, 20).forEach((g: any) => {
          const names = (g.indices || []).map((i: number) => afterAlgo[i]?.nom ?? `#${i}`).join(' | ');
          console.log(`  ↳ [${g.raison || ''}] ${names} → garder: ${afterAlgo[g.garder]?.nom ?? g.garder}`);
        });
      } else {
        console.log(`✅ [WORKER-DEDUP] Phase 2 : aucun doublon résiduel détecté par le LLM`);
      }

      const removedLLM = afterAlgo.length - dedupPois.length;
      const totalRemoved = rawPois.length - dedupPois.length;
      console.log(`✅ [WORKER-DEDUP] Phase 2 LLM : ${dedupPois.length} POIs (${removedLLM} supplémentaires)`);
      console.log(`✅ [WORKER-DEDUP] TOTAL : ${dedupPois.length} POIs uniques (${totalRemoved} doublons sur ${rawPois.length})`);

      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'dedup_complete',
            deduplicated_pois: dedupPois,
            dedup_count: dedupPois.length,
            dedup_algo_removed: removedAlgo,
            dedup_llm_removed: removedLLM,
            updated_at: new Date(),
          },
        }
      );

      return reply.send({ success: true, dedup_count: dedupPois.length, removed: totalRemoved, removed_algo: removedAlgo, removed_llm: removedLLM });

    } catch (error: any) {
      console.error(`❌ [WORKER-DEDUP] Erreur:`, error);
      await db.collection('pois_generation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'extraction_complete', error_dedup: error.message, updated_at: new Date() } }
      ).catch(() => {});
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /workers/translate-json
   * Worker pour traduire un JSON (appelé par QStash)
   */
  fastify.post('/workers/translate-json', async (request, reply) => {
    const db = request.server.container.db;
    const { jobId } = request.body as { jobId: string };

    try {
      console.log(`🚀 [WORKER] Traduction JSON job ${jobId}`);

      if (!ObjectId.isValid(jobId)) {
        throw new Error('Job ID invalide');
      }

      // Charger le job
      const job = await db.collection('translation_jobs').findOne({
        _id: new ObjectId(jobId),
      });

      if (!job) {
        throw new Error('Job non trouvé');
      }

      // Marquer comme "en cours"
      await db.collection('translation_jobs').updateOne(
        { _id: new ObjectId(jobId) },
        { 
          $set: { 
            status: 'processing', 
            updated_at: new Date().toISOString() 
          } 
        }
      );

      // Traduire via ChatGPT
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY non configurée');
      }

      const translator = new JsonTranslatorService(openaiApiKey);
      const result = await translator.translateJson(job.input_json);

      if (result.success) {
        // Succès
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'completed',
              output_json: result.translatedJson,
              stats: result.stats,
              updated_at: new Date().toISOString(),
            },
          }
        );

        console.log(`✅ [WORKER] Traduction terminée pour job ${jobId}`);
        return reply.send({ success: true, stats: result.stats });
      } else {
        // Erreur
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'failed',
              error: result.error,
              stats: result.stats,
              updated_at: new Date().toISOString(),
            },
          }
        );

        console.error(`❌ [WORKER] Traduction échouée pour job ${jobId}:`, result.error);
        return reply.status(500).send({
          error: 'Traduction échouée',
          details: result.error,
        });
      }
    } catch (error: any) {
      console.error(`❌ [WORKER] Erreur traduction job ${jobId}:`, error);

      // Marquer comme "failed"
      if (ObjectId.isValid(jobId)) {
        await db.collection('translation_jobs').updateOne(
          { _id: new ObjectId(jobId) },
          {
            $set: {
              status: 'failed',
              error: error.message,
              updated_at: new Date().toISOString(),
            },
          }
        );
      }

      return reply.status(500).send({
        error: 'Erreur lors de la traduction',
        details: error.message,
      });
    }
  });
}
