import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { OpenAIService } from '../services/openai.service';
import { GeocodingService } from '../services/geocoding.service';
import { env } from '../config/env';
import { z } from 'zod';

// Schema Zod pour un POI
const POISchema = z.object({
  poi_id: z.string(),
  nom: z.string(),
  type: z.string(),
  source: z.enum(['article', 'manual', 'library']), // Origine du POI
  article_source: z.string().optional(), // Si depuis article
  raison_selection: z.string().optional(),
  autres_articles_mentions: z.array(z.string()).optional(),
  coordinates: z.object({
    lat: z.number(),
    lon: z.number(),
    display_name: z.string().optional(),
  }).optional(),
  cluster_id: z.string().optional(), // Si depuis bibliothèque RL
  region_lovers_id: z.string().optional(), // ID dans la base RL
});

const ManualPOISchema = z.object({
  nom: z.string().min(1),
  type: z.string(),
  coordinates: z.object({
    lat: z.number(),
    lon: z.number(),
  }).optional(),
});

export default async function poisManagementRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;
  const geocodingService = new GeocodingService();

  /**
   * POST /guides/:guideId/pois/generate
   * Génère les POIs depuis les articles WordPress via IA
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/generate',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`🔍 [POIs] Génération POIs pour guide ${guideId}`);

        // 1. Récupérer le guide
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        const destination = guide.destinations?.[0] || guide.destination || 'Destination inconnue';

        // 2. Créer l'OpenAI service
        const openaiApiKey = env.OPENAI_API_KEY;
        if (!openaiApiKey) {
          return reply.code(500).send({ error: 'OPENAI_API_KEY non configuré' });
        }
        
        const openaiService = new OpenAIService({
          apiKey: openaiApiKey,
          model: 'gpt-5-mini',
          reasoningEffort: 'medium',
        });

        // 3. Charger les articles
        const articles = await db.collection('articles_raw')
          .find({ site_id: guide.slug })
          .toArray();

        if (articles.length === 0) {
          return reply.code(400).send({ 
            error: 'Aucun article trouvé', 
            message: 'Récupérez d\'abord les articles WordPress' 
          });
        }

        console.log(`📄 ${articles.length} article(s) trouvé(s)`);

        // 4. Charger le prompt de sélection POI
        const promptPOI = await db.collection('prompts').findOne({ 
          prompt_id: 'selection_pois',
          actif: true 
        });

        if (!promptPOI) {
          return reply.code(400).send({ error: 'Prompt selection_pois non trouvé' });
        }

        // 5. Générer les POIs avec l'IA
        const articlesFormatted = articles.map((a: any) => ({
          title: a.title,
          slug: a.slug,
          categories: a.categories || [],
        }));

        const listeArticles = articlesFormatted
          .map((a: any) => `- ${a.title} (${a.slug})`)
          .join('\n');

        const prompt = openaiService.replaceVariables(promptPOI.texte_prompt, {
          SITE: guide.wpConfig?.siteUrl || '',
          DESTINATION: destination,
          LISTE_ARTICLES: listeArticles,
        });

        console.log('🤖 Appel OpenAI pour génération POIs...');
        const response = await openaiService.generateContent(prompt);
        const result = JSON.parse(response.output);

        if (!result.pois || !Array.isArray(result.pois)) {
          throw new Error('Format de réponse invalide');
        }

        console.log(`✅ ${result.pois.length} POI(s) généré(s)`);

        // 6. Enrichir avec géolocalisation
        const pays = geocodingService.getCountryFromDestination(destination);
        const poisWithCoords: any[] = [];

        for (const poi of result.pois) {
          const coordsResult = await geocodingService.geocodePlace(poi.nom, pays);
          
          poisWithCoords.push({
            poi_id: poi.poi_id,
            nom: poi.nom,
            type: poi.type,
            source: 'article',
            article_source: poi.article_source,
            raison_selection: poi.raison_selection,
            autres_articles_mentions: poi.autres_articles_mentions || [],
            coordinates: coordsResult || undefined,
          });

          // Rate limiting Nominatim (1 req/sec)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`📍 ${poisWithCoords.filter(p => p.coordinates).length}/${poisWithCoords.length} POI(s) géolocalisé(s)`);

        // 7. Sauvegarder ou mettre à jour la sélection
        const now = new Date();
        await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              pois: poisWithCoords,
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
          pois: poisWithCoords,
          count: poisWithCoords.length,
        });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur génération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la génération des POIs',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /guides/:guideId/pois
   * Récupère la liste des POIs sélectionnés pour un guide
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const selection = await db.collection('pois_selection').findOne({ guide_id: guideId });
        
        if (!selection) {
          return reply.send({ pois: [] });
        }

        return reply.send({
          pois: selection.pois || [],
          count: selection.pois?.length || 0,
        });
      } catch (error: any) {
        console.error('❌ [POIs] Erreur récupération:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/add-manual
   * Ajoute un POI créé manuellement
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/add-manual',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const data = ManualPOISchema.parse(request.body);
        
        // Générer un ID unique
        const poi_id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newPOI = {
          poi_id,
          nom: data.nom,
          type: data.type,
          source: 'manual' as const,
          coordinates: data.coordinates,
        };

        // Ajouter à la collection
        const now = new Date();
        await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $push: { pois: newPOI },
            $set: { updated_at: now },
            $setOnInsert: { guide_id: guideId, created_at: now },
          },
          { upsert: true }
        );

        console.log(`✅ [POIs] POI manuel ajouté: ${data.nom}`);

        return reply.send({
          success: true,
          poi: newPOI,
        });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur ajout manuel:', error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/pois/add-from-library
   * Ajoute un POI depuis la bibliothèque Region Lovers
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/pois/add-from-library',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const { region_lovers_id, nom, type, coordinates, cluster_id } = request.body as any;

        if (!region_lovers_id || !nom) {
          return reply.code(400).send({ error: 'region_lovers_id et nom requis' });
        }

        const poi_id = `library_${region_lovers_id}`;

        const newPOI = {
          poi_id,
          nom,
          type: type || 'autre',
          source: 'library' as const,
          region_lovers_id,
          cluster_id,
          coordinates,
        };

        // Ajouter à la collection (si pas déjà présent)
        const now = new Date();
        const result = await db.collection('pois_selection').updateOne(
          { 
            guide_id: guideId,
            'pois.region_lovers_id': { $ne: region_lovers_id },
          },
          {
            $push: { pois: newPOI },
            $set: { updated_at: now },
            $setOnInsert: { guide_id: guideId, created_at: now },
          },
          { upsert: true }
        );

        if (result.matchedCount === 0 && result.upsertedCount === 0) {
          return reply.code(400).send({ error: 'Ce POI est déjà dans la sélection' });
        }

        console.log(`✅ [POIs] POI bibliothèque ajouté: ${nom}`);

        return reply.send({
          success: true,
          poi: newPOI,
        });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur ajout bibliothèque:', error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/pois/:poiId
   * Supprime un POI de la sélection
   */
  fastify.delete<{ Params: { guideId: string; poiId: string } }>(
    '/guides/:guideId/pois/:poiId',
    async (request, reply) => {
      const { guideId, poiId } = request.params;

      try {
        const result = await db.collection('pois_selection').updateOne(
          { guide_id: guideId },
          {
            $pull: { pois: { poi_id: poiId } },
            $set: { updated_at: new Date() },
          }
        );

        if (result.matchedCount === 0) {
          return reply.code(404).send({ error: 'Sélection POIs non trouvée' });
        }

        console.log(`🗑️ [POIs] POI supprimé: ${poiId}`);

        return reply.send({ success: true });

      } catch (error: any) {
        console.error('❌ [POIs] Erreur suppression:', error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/library
   * Récupère tous les POIs de la bibliothèque Region Lovers pour cette région
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/library',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        // 1. Récupérer le guide pour obtenir destination_rl_id
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        if (!guide.destination_rl_id) {
          return reply.code(400).send({ 
            error: 'destination_rl_id manquant',
            message: 'Configurez l\'ID Region Lovers dans les paramètres du guide' 
          });
        }

        // 2. Appeler l'API Region Lovers
        const regionId = guide.destination_rl_id;
        const rlApiToken = env.REGION_LOVERS_API_TOKEN;

        if (!rlApiToken) {
          return reply.code(500).send({ error: 'REGION_LOVERS_API_TOKEN non configuré' });
        }

        const response = await fetch(
          `https://api.region-lovers.com/place-instance-drafts/region/${regionId}`,
          {
            headers: {
              'Authorization': `Bearer ${rlApiToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Erreur API RL: ${response.status}`);
        }

        const data = await response.json();

        // 3. Transformer et grouper par cluster
        const poisByCluster: Record<string, any[]> = {};

        for (const item of data) {
          const clusterId = item.cluster_id || 'non_affecte';
          const clusterName = item.cluster_name || 'Non affecté';

          if (!poisByCluster[clusterId]) {
            poisByCluster[clusterId] = [];
          }

          poisByCluster[clusterId].push({
            region_lovers_id: item._id,
            nom: item.place_name || item.nom,
            type: item.place_type || 'autre',
            cluster_id: clusterId,
            cluster_name: clusterName,
            coordinates: item.coordinates,
          });
        }

        // 4. Trier alphabétiquement dans chaque cluster
        for (const clusterId in poisByCluster) {
          poisByCluster[clusterId].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        }

        console.log(`📚 [Library] ${data.length} POI(s) récupéré(s) depuis Region Lovers`);

        return reply.send({
          clusters: poisByCluster,
          total: data.length,
        });

      } catch (error: any) {
        console.error('❌ [Library] Erreur récupération:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la récupération de la bibliothèque',
          details: error.message,
        });
      }
    }
  );
}
