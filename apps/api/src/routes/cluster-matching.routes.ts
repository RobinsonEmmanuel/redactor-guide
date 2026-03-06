import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { ClusterMatchingService, POI } from '../services/cluster-matching.service';
import { COLLECTIONS } from '../config/collections.js';

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
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
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
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        
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

          // Log du premier draft pour debug
          if (drafts.length > 0) {
            console.log(`  📍 Structure du premier draft:`, JSON.stringify(drafts[0], null, 2));
          }

          for (const draft of drafts) {
            // Extraire le VRAI nom depuis blocks > general_info > fields > name
            let realPlaceName = draft.place_name || draft.name || 'Sans nom';
            
            try {
              const generalInfoBlock = draft.blocks?.find((b: any) => b.block_id === 'general_info');
              const generalSection = generalInfoBlock?.sections?.find((s: any) => s.section_id === 'general_info_general');
              const nameField = generalSection?.fields?.find((f: any) => f.field_id === 'name');
              
              if (nameField?.value) {
                realPlaceName = nameField.value;
              }
            } catch (err) {
              console.warn('⚠️ Impossible d\'extraire le nom réel pour draft', draft._id);
            }

            placeInstances.push({
              place_instance_id: draft._id || draft.id,
              place_name: realPlaceName,
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

        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
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

        // Mettre à jour les POIs dans pois_selection avec les cluster_id
        const updatedPois = selectedPois.map((poi: any) => {
          // Trouver le POI dans l'assignment (soit dans clusters soit dans unassigned)
          let matchedPoi: any = null;
          
          // Chercher dans les clusters
          for (const clusterId in assignment.clusters) {
            matchedPoi = assignment.clusters[clusterId].find((p: any) => p.poi.nom === poi.nom);
            if (matchedPoi) break;
          }
          
          // Sinon chercher dans unassigned
          if (!matchedPoi) {
            matchedPoi = assignment.unassigned.find((p: any) => p.poi.nom === poi.nom);
          }

          // Mettre à jour le POI avec les infos de matching
          if (matchedPoi) {
            return {
              ...poi,
              cluster_id: matchedPoi.current_cluster_id === 'unassigned' ? null : matchedPoi.current_cluster_id,
              cluster_name: matchedPoi.current_cluster_id === 'unassigned' ? null : uniqueClusters.find((c: any) => c.cluster_id === matchedPoi.current_cluster_id)?.cluster_name,
              place_instance_id: matchedPoi.place_instance_id || null,
              matched_automatically: matchedPoi.matched_automatically,
              confidence: matchedPoi.suggested_match?.confidence || null,
              score: matchedPoi.suggested_match?.score || null,
            };
          }
          
          return poi;
        });

        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          {
            $set: {
              pois: updatedPois,
              updated_at: new Date(),
            },
          }
        );

        console.log('✅ [Matching] Assignment sauvegardé + POIs mis à jour');

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
   * POST /guides/:guideId/matching
   * Alias pour /matching/generate - Lance le matching automatique
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`🎯 [Matching] Affectation clusters pour guide ${guideId}`);

        // 1. Récupérer le guide et vérifier destination_rl_id
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
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

        // 2. Charger les POIs depuis pois_selection
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        
        if (!poisSelection || !poisSelection.pois || poisSelection.pois.length === 0) {
          return reply.code(400).send({ 
            error: 'Aucun POI sélectionné', 
            message: 'Veuillez d\'abord identifier et sélectionner des lieux à l\'étape 3' 
          });
        }

        const selectedPois = poisSelection.pois;
        console.log(`📍 ${selectedPois.length} POI(s) chargé(s) depuis la sélection`);

        // Mapper vers format POI attendu
        const pois: POI[] = selectedPois.map((p: any) => ({
          poi_id: p.poi_id,
          nom: p.nom,
          type: p.type,
          article_source: p.article_source || '',
        }));

        // 3. Récupérer les clusters depuis Region Lovers
        console.log(`🌍 Récupération des clusters pour la région ${regionId}...`);
        
        const regionLoversApiUrl = process.env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';
        
        const userToken = request.cookies?.accessToken || request.headers.authorization?.replace('Bearer ', '');
        
        const clustersResponse = await fetch(`${regionLoversApiUrl}/place-instance-drafts/region/${regionId}`, {
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!clustersResponse.ok) {
          return reply.code(502).send({ 
            error: 'Impossible de récupérer les clusters', 
            message: `API Region Lovers a retourné ${clustersResponse.status}` 
          });
        }

        const clustersData: any = await clustersResponse.json();

        let clustersArray: any[] = [];
        if (clustersData?.clusters && Array.isArray(clustersData.clusters)) {
          clustersArray = clustersData.clusters;
        }

        const placeInstances: any[] = [];
        
        for (const cluster of clustersArray) {
          const clusterId = cluster.id || cluster._id;
          const clusterName = cluster.name || 'Sans nom';
          const drafts = cluster.drafts || [];

          for (const draft of drafts) {
            let realPlaceName = draft.place_name || draft.name || 'Sans nom';
            
            try {
              const generalInfoBlock = draft.blocks?.find((b: any) => b.block_id === 'general_info');
              const generalSection = generalInfoBlock?.sections?.find((s: any) => s.section_id === 'general_info_general');
              const nameField = generalSection?.fields?.find((f: any) => f.field_id === 'name');
              
              if (nameField?.value) {
                realPlaceName = nameField.value;
              }
            } catch (err) {
              console.warn('⚠️ Impossible d\'extraire le nom réel pour draft', draft._id);
            }

            placeInstances.push({
              place_instance_id: draft._id || draft.id,
              place_name: realPlaceName,
              place_type: draft.place_type || draft.type || 'autre',
              cluster_id: clusterId,
              cluster_name: clusterName,
            });
          }
        }

        console.log(`✅ ${placeInstances.length} place_instance(s) récupéré(es) depuis Region Lovers`);

        // 4. Effectuer le matching
        console.log(`🎯 Auto-matching de ${pois.length} POI(s) avec ${placeInstances.length} place_instance(s) répartis dans ${clustersArray.length} cluster(s)...`);
        
        const assignment = clusterMatchingService.autoAssignPOIs(pois, placeInstances);

        // 5. Calculer les stats
        const stats = clusterMatchingService.generateStats(assignment);

        // 6. Récupérer les métadonnées des clusters uniques
        const uniqueClusters = Array.from(new Set(placeInstances.map(pi => pi.cluster_id)));
        const clustersMetadata = uniqueClusters.map(clusterId => {
          const cluster = clustersArray.find(c => (c.id || c._id) === clusterId);
          const instancesInCluster = placeInstances.filter(pi => pi.cluster_id === clusterId);
          return {
            cluster_id: clusterId,
            cluster_name: cluster?.name || 'Sans nom',
            place_count: instancesInCluster.length,
          };
        });

        // 7. Sauvegarder dans MongoDB
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          {
            $set: {
              guide_id: guideId,
              assignment,
              stats,
              clusters_metadata: clustersMetadata,
              matched_at: new Date(),
              updated_at: new Date(),
            },
          },
          { upsert: true }
        );

        // 8. Mettre à jour les POIs dans pois_selection avec les cluster_id
        const updatedPois = selectedPois.map((poi: any) => {
          // Trouver le POI dans l'assignment (soit dans clusters soit dans unassigned)
          let matchedPoi: any = null;
          
          // Chercher dans les clusters
          for (const clusterId in assignment.clusters) {
            matchedPoi = assignment.clusters[clusterId].find((p: any) => p.poi.poi_id === poi.poi_id);
            if (matchedPoi) break;
          }
          
          // Sinon chercher dans unassigned
          if (!matchedPoi) {
            matchedPoi = assignment.unassigned.find((p: any) => p.poi.poi_id === poi.poi_id);
          }

          // Mettre à jour le POI avec les infos de matching
          if (matchedPoi) {
            return {
              ...poi,
              cluster_id: matchedPoi.current_cluster_id === 'unassigned' ? null : matchedPoi.current_cluster_id,
              cluster_name: matchedPoi.current_cluster_id === 'unassigned' ? null : clustersMetadata.find((c: any) => c.cluster_id === matchedPoi.current_cluster_id)?.cluster_name,
              place_instance_id: matchedPoi.place_instance_id || null,
              matched_automatically: matchedPoi.matched_automatically,
              confidence: matchedPoi.suggested_match?.confidence || null,
              score: matchedPoi.suggested_match?.score || null,
            };
          }
          
          return poi;
        });

        await db.collection(COLLECTIONS.pois_selection).updateOne(
          { guide_id: guideId },
          {
            $set: {
              pois: updatedPois,
              updated_at: new Date(),
            },
          }
        );

        console.log(`📊 Résultat: ${stats.assigned}/${stats.total_pois} POI(s) auto-affecté(s)`);
        console.log('✅ [Matching] Assignment sauvegardé + POIs mis à jour');

        reply.send({
          assignment,
          stats,
          clusters_metadata: clustersMetadata,
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
        const assignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });

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
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
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

  /**
   * POST /guides/:guideId/clusters
   * Créer un cluster manuellement
   */
  fastify.post<{
    Params: { guideId: string };
    Body: { cluster_name: string };
  }>(
    '/guides/:guideId/clusters',
    async (request, reply) => {
      const { guideId } = request.params;
      const { cluster_name } = request.body;

      try {
        console.log(`➕ [Cluster] Création cluster manuel "${cluster_name}" pour guide ${guideId}`);

        if (!cluster_name || !cluster_name.trim()) {
          return reply.code(400).send({ error: 'Le nom du cluster est requis' });
        }

        // Générer un ID unique pour le cluster
        const clusterId = `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const newCluster = {
          cluster_id: clusterId,
          cluster_name: cluster_name.trim(),
          place_count: 0,
          is_manual: true,
          created_at: new Date(),
        };

        // Ajouter le cluster aux métadonnées dans cluster_assignments
        const assignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
        
        if (assignment) {
          // Ajouter aux métadonnées existantes
          await db.collection(COLLECTIONS.cluster_assignments).updateOne(
            { guide_id: guideId },
            {
              $push: { clusters_metadata: newCluster } as any,
              $set: { updated_at: new Date() },
            }
          );
        } else {
          // Créer un nouveau document si pas de matching encore
          await db.collection(COLLECTIONS.cluster_assignments).insertOne({
            guide_id: guideId,
            clusters_metadata: [newCluster],
            assignment: { clusters: {}, unassigned: [] },
            stats: { total_pois: 0, assigned: 0, unassigned: 0, auto_matched: 0, manual_matched: 0, by_cluster: {} },
            created_at: new Date(),
            updated_at: new Date(),
          });
        }

        console.log(`✅ [Cluster] Cluster "${cluster_name}" créé avec l'ID ${clusterId}`);

        reply.send({
          success: true,
          cluster: newCluster,
        });
      } catch (error: any) {
        console.error('❌ [Cluster] Erreur création:', error);
        reply.code(500).send({ error: 'Erreur lors de la création du cluster', details: error.message });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/clusters/:clusterId
   * Supprimer un cluster et réaffecter ses POIs à "non affecté"
   */
  fastify.delete<{
    Params: { guideId: string; clusterId: string };
  }>(
    '/guides/:guideId/clusters/:clusterId',
    async (request, reply) => {
      const { guideId, clusterId } = request.params;

      try {
        console.log(`🗑️ [Cluster] Suppression cluster ${clusterId} du guide ${guideId}`);

        // 1. Récupérer les POIs affectés à ce cluster
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        
        if (poisSelection) {
          // Compter les POIs affectés
          const affectedPois = poisSelection.pois.filter((p: any) => p.cluster_id === clusterId);
          console.log(`📍 ${affectedPois.length} POI(s) affecté(s) à ce cluster`);

          // Réaffecter tous les POIs de ce cluster à null (non affecté)
          const updatedPois = poisSelection.pois.map((p: any) => {
            if (p.cluster_id === clusterId) {
              return {
                ...p,
                cluster_id: null,
                cluster_name: null,
                matched_automatically: false,
                updated_at: new Date(),
              };
            }
            return p;
          });

          // Sauvegarder les POIs mis à jour
          await db.collection(COLLECTIONS.pois_selection).updateOne(
            { guide_id: guideId },
            {
              $set: {
                pois: updatedPois,
                updated_at: new Date(),
              },
            }
          );

          console.log(`✅ ${affectedPois.length} POI(s) réaffecté(s) à "non affecté"`);
        }

        // 2. Supprimer le cluster des métadonnées
        const result = await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          {
            $pull: { clusters_metadata: { cluster_id: clusterId } } as any,
            $set: { updated_at: new Date() },
          }
        );

        if (result.matchedCount === 0) {
          return reply.code(404).send({ error: 'Cluster ou guide non trouvé' });
        }

        console.log(`✅ [Cluster] Cluster ${clusterId} supprimé avec succès`);

        reply.send({
          success: true,
          message: 'Cluster supprimé et POIs réaffectés',
        });
      } catch (error: any) {
        console.error('❌ [Cluster] Erreur suppression:', error);
        reply.code(500).send({ error: 'Erreur lors de la suppression du cluster', details: error.message });
      }
    }
  );
}
