import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { ClusterMatchingService, POI } from '../services/cluster-matching.service';

export default async function clusterMatchingRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;
  const clusterMatchingService = new ClusterMatchingService();

  /**
   * POST /guides/:guideId/matching/generate
   * Charge les POIs sélectionnés (étape 3) et effectue l'auto-matching avec les clusters
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching/generate',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`🎯 [Matching] Affectation clusters pour guide ${guideId}`);

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

        // 2. Charger les POIs depuis pois_selection (étape 3)
        const poisSelection = await db.collection('pois_selection').findOne({ guide_id: guideId });
        
        if (!poisSelection || !poisSelection.pois || poisSelection.pois.length === 0) {
          return reply.code(400).send({ 
            error: 'Aucun POI sélectionné', 
            message: 'Veuillez d\'abord identifier et sélectionner des lieux à l\'étape 3' 
          });
        }

        const selectedPois = poisSelection.pois;
        console.log(`📍 ${selectedPois.length} POI(s) chargé(s) depuis la sélection`);

        // Mapper vers format POI attendu par ClusterMatchingService
        const pois: POI[] = selectedPois.map((p: any) => ({
          nom: p.nom,
          type: p.type || 'autre',
        }));

        // 3. Extraire le token JWT de l'utilisateur depuis les cookies
        // Extraire le token JWT (cookies OU Authorization header)
        const userToken = 
          request.cookies?.accessToken || 
          request.headers.authorization?.replace('Bearer ', '');
        
        if (!userToken) {
          return reply.code(401).send({ 
            error: 'Non authentifié',
            message: 'Token JWT manquant. Veuillez vous reconnecter.'
          });
        }

        // 4. Récupérer les clusters depuis Region Lovers avec le token utilisateur
        console.log(`🌍 Récupération des clusters pour la région ${regionId}...`);
        
        const regionLoversApiUrl = process.env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';

        const clustersResponse = await fetch(
          `${regionLoversApiUrl}/place-instance-drafts/region/${regionId}`,
          {
            headers: {
              'Authorization': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log(`📡 Status API Region Lovers: ${clustersResponse.status}`);

        if (!clustersResponse.ok) {
          const errorText = await clustersResponse.text();
          console.error('❌ Erreur API Region Lovers:', errorText);
          return reply.code(502).send({ 
            error: 'Erreur API Region Lovers', 
            details: errorText 
          });
        }

        const clustersData: any = await clustersResponse.json();
        
        // Logs détaillés pour debug
        console.log('📦 Type de données reçues:', Array.isArray(clustersData) ? 'Array' : typeof clustersData);
        console.log('📦 Clés de l\'objet:', clustersData && typeof clustersData === 'object' ? Object.keys(clustersData) : 'N/A');
        
        // Parser la structure de l'API Region Lovers
        let clustersArray: any[] = [];
        
        if (Array.isArray(clustersData)) {
          clustersArray = clustersData;
        } else if (clustersData?.clusters && Array.isArray(clustersData.clusters)) {
          clustersArray = clustersData.clusters;
        } else if (clustersData?.data && Array.isArray(clustersData.data)) {
          clustersArray = clustersData.data;
        }

        console.log(`📦 ${clustersArray.length} cluster(s) trouvé(s) dans la réponse`);

        // Aplatir : extraire toutes les place_instances de tous les clusters
        const placeInstances: any[] = [];
        
        for (const cluster of clustersArray) {
          const clusterId = cluster.id || cluster._id || cluster.cluster_id;
          const clusterName = cluster.name || cluster.cluster_name || 'Sans nom';
          const drafts = cluster.drafts || cluster.place_instances || [];

          console.log(`  🗂️  Cluster "${clusterName}" (${clusterId}): ${drafts.length} draft(s)`);

          for (const draft of drafts) {
            placeInstances.push({
              place_instance_id: draft._id || draft.id,
              place_name: draft.place_name || draft.name,
              place_type: draft.place_type || draft.type || 'autre',
              cluster_id: clusterId,
              cluster_name: clusterName,
            });
          }
        }

        console.log(`✅ ${placeInstances.length} place_instance(s) récupéré(es) depuis Region Lovers`);
        
        if (placeInstances.length > 0) {
          console.log('📍 Exemple de place_instance:', JSON.stringify(placeInstances[0], null, 2));
        }

        // 5. Auto-matching POIs ↔ Place Instances
        const assignment = clusterMatchingService.autoAssignPOIs(pois, placeInstances);
        const stats = clusterMatchingService.generateStats(assignment);

        // 6. Sauvegarder en base (état initial)
        // Extraire les clusters uniques pour les métadonnées
        const uniqueClusters = clustersArray.map(c => ({
          cluster_id: c.id || c._id || c.cluster_id,
          cluster_name: c.name || c.cluster_name || 'Sans nom',
          place_count: (c.drafts || c.place_instances || []).length,
        }));

        await db.collection('cluster_assignments').updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              region_id: regionId,
              assignment,
              stats,
              clusters_metadata: uniqueClusters,
              place_instances_count: placeInstances.length,
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
          clusters_metadata: uniqueClusters,
          place_instances_count: placeInstances.length,
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
          // Retourner un objet vide au lieu de 404 pour éviter les logs d'erreur dans la console
          return reply.send({
            assignment: null,
            stats: null,
            clusters_metadata: [],
            created_at: null,
            updated_at: null,
          });
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
