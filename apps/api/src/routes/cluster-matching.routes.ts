import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { ClusterMatchingService, POI, Cluster } from '../services/cluster-matching.service';
import { OpenAIService } from '../services/openai.service';
import { env } from '../config/env';

export default async function clusterMatchingRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;
  const clusterMatchingService = new ClusterMatchingService();

  /**
   * POST /guides/:guideId/matching/generate
   * Génère les POIs et effectue l'auto-matching avec les clusters
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching/generate',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`🎯 [Matching] Génération POIs pour guide ${guideId}`);

        // 1. Récupérer le guide et vérifier destination_rl_id
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        if (!guide.destination_rl_id) {
          return reply.code(400).send({ 
            error: 'destination_rl_id manquant', 
            message: 'Veuillez configurer l\'ID Region Lovers de la destination dans les paramètres du guide' 
          });
        }

        const regionId = guide.destination_rl_id;
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
        const site = await db.collection('sites').findOne({ url: guide.wpConfig?.siteUrl });
        if (!site) {
          return reply.code(400).send({ error: 'Site WordPress non trouvé' });
        }

        const articles = await db.collection('articles_raw')
          .find({
            site_id: site._id,
            destinations: { $in: [destination] }
          })
          .toArray();

        if (articles.length === 0) {
          return reply.code(400).send({ 
            error: 'Aucun article trouvé', 
            message: 'Récupérez d\'abord les articles WordPress pour cette destination' 
          });
        }

        console.log(`📄 ${articles.length} article(s) trouvé(s) pour la destination "${destination}"`);

        // Charger le prompt de sélection POI
        const promptPOI = await db.collection('prompts').findOne({ 
          prompt_id: 'selection_pois',
          actif: true 
        });

        if (!promptPOI) {
          return reply.code(400).send({ error: 'Prompt selection_pois non trouvé' });
        }

        // Générer les POIs avec l'IA
        const articlesFormatted = articles.map((a: any) => ({
          title: a.title,
          slug: a.slug,
          categories: a.categories || [],
          url_francais: a.url_francais,
        }));

        const listeArticles = articlesFormatted
          .map((a: any) => `- ${a.title} (${a.slug})`)
          .join('\n');

        const prompt = openaiService.replaceVariables(promptPOI.texte_prompt, {
          SITE: guide.wpConfig?.siteUrl || '',
          DESTINATION: destination,
          LISTE_ARTICLES_POI: listeArticles,
        });

        console.log('🤖 Appel OpenAI pour génération des POIs...');
        const poisResult = await openaiService.generateJSON(prompt, 12000);
        const pois: POI[] = poisResult.pois || [];

        console.log(`✅ ${pois.length} POI(s) généré(s) par l'IA`);

        // 4. Récupérer les clusters depuis Region Lovers
        console.log(`🌍 Récupération des clusters pour la région ${regionId}...`);
        
        const regionLoversApiUrl = process.env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';
        const regionLoversToken = process.env.REGION_LOVERS_API_TOKEN;

        if (!regionLoversToken) {
          return reply.code(500).send({ 
            error: 'Configuration manquante', 
            message: 'REGION_LOVERS_API_TOKEN non configuré' 
          });
        }

        const clustersResponse = await fetch(
          `${regionLoversApiUrl}/place-instance-drafts/region/${regionId}`,
          {
            headers: {
              'Authorization': `Bearer ${regionLoversToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!clustersResponse.ok) {
          const errorText = await clustersResponse.text();
          console.error('❌ Erreur API Region Lovers:', errorText);
          return reply.code(502).send({ 
            error: 'Erreur API Region Lovers', 
            details: errorText 
          });
        }

        const clustersData: any = await clustersResponse.json();
        const clusters: Cluster[] = Array.isArray(clustersData) ? clustersData : clustersData.drafts || [];

        console.log(`✅ ${clusters.length} cluster(s) récupéré(s) depuis Region Lovers`);

        // 5. Auto-matching
        const assignment = clusterMatchingService.autoAssignPOIs(pois, clusters);
        const stats = clusterMatchingService.generateStats(assignment);

        // 6. Sauvegarder en base (état initial)
        await db.collection('cluster_assignments').updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              region_id: regionId,
              assignment,
              stats,
              clusters_metadata: clusters.map(c => ({
                cluster_id: c._id,
                place_name: c.place_name,
                place_type: c.place_type,
              })),
              updated_at: new Date(),
            },
            $setOnInsert: {
              created_at: new Date(),
            },
          },
          { upsert: true }
        );

        console.log('✅ [Matching] Assignment sauvegardé');

        reply.send({
          success: true,
          assignment,
          stats,
          clusters_metadata: clusters.map(c => ({
            cluster_id: c._id,
            place_name: c.place_name,
            place_type: c.place_type,
          })),
        });
      } catch (error: any) {
        console.error('❌ [Matching] Erreur:', error);
        reply.code(500).send({ error: 'Erreur lors de la génération', details: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/matching
   * Récupère l'état actuel du matching
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        const assignment = await db.collection('cluster_assignments').findOne({ guide_id: guideId });

        if (!assignment) {
          return reply.code(404).send({ error: 'Aucun matching trouvé pour ce guide' });
        }

        reply.send({
          assignment: assignment.assignment,
          stats: assignment.stats,
          clusters_metadata: assignment.clusters_metadata,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at,
        });
      } catch (error: any) {
        console.error('❌ [Matching] Erreur récupération:', error);
        reply.code(500).send({ error: 'Erreur lors de la récupération', details: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/matching/save
   * Sauvegarde l'état final après modifications drag & drop
   */
  fastify.post<{ 
    Params: { guideId: string };
    Body: {
      assignment: any;
    }
  }>(
    '/guides/:guideId/matching/save',
    async (request, reply) => {
      const { guideId } = request.params;
      const { assignment } = request.body;

      try {
        console.log(`💾 [Matching] Sauvegarde pour guide ${guideId}`);

        // Régénérer les stats
        const stats = clusterMatchingService.generateStats(assignment);

        // Sauvegarder
        await db.collection('cluster_assignments').updateOne(
          { guide_id: guideId },
          {
            $set: {
              assignment,
              stats,
              updated_at: new Date(),
            },
          }
        );

        console.log('✅ [Matching] Sauvegarde réussie');

        reply.send({
          success: true,
          stats,
        });
      } catch (error: any) {
        console.error('❌ [Matching] Erreur sauvegarde:', error);
        reply.code(500).send({ error: 'Erreur lors de la sauvegarde', details: error.message });
      }
    }
  );
}
