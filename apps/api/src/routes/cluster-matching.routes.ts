import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { ClusterMatchingService, POI, Cluster } from '../services/cluster-matching.service';

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
