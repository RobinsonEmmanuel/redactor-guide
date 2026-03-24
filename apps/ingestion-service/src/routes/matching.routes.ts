import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';
import { ClusterMatchingService, POI } from '../services/cluster-matching.service.js';
import { COLLECTIONS } from '../config/collections.js';

export default async function matchingRoutes(fastify: FastifyInstance) {
  const db: Db = fastify.mongo.db!;
  const clusterMatchingService = new ClusterMatchingService();

  /**
   * POST /guides/:guideId/matching/generate
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching/generate',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });
        if (!guide.destination_rl_id) {
          return reply.code(400).send({ error: 'destination_rl_id manquant', message: 'Veuillez configurer l\'ID Region Lovers de la destination' });
        }

        const regionId = guide.destination_rl_id;
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (!poisSelection?.pois?.length) {
          return reply.code(400).send({ error: 'Aucun POI sélectionné', message: 'Veuillez d\'abord identifier et sélectionner des lieux à l\'étape 3' });
        }

        const selectedPois = poisSelection.pois;
        const pois: POI[] = selectedPois.map((p: any) => ({ nom: p.nom, type: p.type || 'autre' } as POI));

        const userToken = request.cookies?.accessToken || request.headers.authorization?.replace('Bearer ', '');
        if (!userToken) return reply.code(401).send({ error: 'Non authentifié', message: 'Token JWT manquant' });

        const regionLoversApiUrl = process.env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';
        const clustersResponse = await fetch(`${regionLoversApiUrl}/place-instance-drafts/region/${regionId}`, {
          headers: { 'Authorization': `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        });

        if (!clustersResponse.ok) {
          const errorText = await clustersResponse.text();
          return reply.code(502).send({ error: 'Erreur API Region Lovers', details: errorText });
        }

        const clustersData: any = await clustersResponse.json();
        let clustersArray: any[] = [];
        if (Array.isArray(clustersData)) clustersArray = clustersData;
        else if (clustersData?.clusters && Array.isArray(clustersData.clusters)) clustersArray = clustersData.clusters;
        else if (clustersData?.data && Array.isArray(clustersData.data)) clustersArray = clustersData.data;

        const placeInstances: any[] = [];
        for (const cluster of clustersArray) {
          const clusterId = cluster.id || cluster._id || cluster.cluster_id;
          const clusterName = cluster.name || cluster.cluster_name || 'Sans nom';
          const drafts = cluster.drafts || cluster.place_instances || [];
          for (const draft of drafts) {
            let realPlaceName = draft.place_name || draft.name || 'Sans nom';
            try {
              const generalInfoBlock = draft.blocks?.find((b: any) => b.block_id === 'general_info');
              const generalSection = generalInfoBlock?.sections?.find((s: any) => s.section_id === 'general_info_general');
              const nameField = generalSection?.fields?.find((f: any) => f.field_id === 'name');
              if (nameField?.value) realPlaceName = nameField.value;
            } catch { /* ignore */ }
            placeInstances.push({ place_instance_id: draft._id || draft.id, place_name: realPlaceName, place_type: draft.place_type || draft.type || 'autre', cluster_id: clusterId, cluster_name: clusterName });
          }
        }

        const assignment = clusterMatchingService.autoAssignPOIs(pois, placeInstances);
        const stats = clusterMatchingService.generateStats(assignment);

        const uniqueClusters = clustersArray.map(c => ({ cluster_id: c.id || c._id || c.cluster_id, cluster_name: c.name || c.cluster_name || 'Sans nom', place_count: (c.drafts || c.place_instances || []).length }));

        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $set: { guide_id: guideId, region_id: regionId, assignment, stats, clusters_metadata: uniqueClusters, place_instances_count: placeInstances.length, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
          { upsert: true }
        );

        const updatedPois = selectedPois.map((poi: any) => {
          let matchedPoi: any = null;
          for (const clusterId in assignment.clusters) {
            matchedPoi = assignment.clusters[clusterId].find((p: any) => p.poi.nom === poi.nom);
            if (matchedPoi) break;
          }
          if (!matchedPoi) matchedPoi = assignment.unassigned.find((p: any) => p.poi.nom === poi.nom);
          if (matchedPoi) {
            return { ...poi, cluster_id: matchedPoi.current_cluster_id === 'unassigned' ? null : matchedPoi.current_cluster_id, cluster_name: matchedPoi.current_cluster_id === 'unassigned' ? null : uniqueClusters.find((c: any) => c.cluster_id === matchedPoi.current_cluster_id)?.cluster_name, place_instance_id: matchedPoi.place_instance_id || null, matched_automatically: matchedPoi.matched_automatically, confidence: matchedPoi.suggested_match?.confidence || null, score: matchedPoi.suggested_match?.score || null };
          }
          return poi;
        });

        await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: updatedPois, updated_at: new Date() } });

        return reply.send({ success: true, assignment, stats, clusters_metadata: uniqueClusters, place_instances_count: placeInstances.length });
      } catch (error: any) {
        return reply.code(500).send({ error: 'Erreur lors de la génération', details: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/matching
   */
  fastify.post<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
        if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });
        if (!guide.destination_rl_id) return reply.code(400).send({ error: 'destination_rl_id manquant' });

        const regionId = guide.destination_rl_id;
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (!poisSelection?.pois?.length) return reply.code(400).send({ error: 'Aucun POI sélectionné' });

        const selectedPois = poisSelection.pois;
        const pois: POI[] = selectedPois.map((p: any) => ({ poi_id: p.poi_id, nom: p.nom, type: p.type, article_source: p.article_source || '' }));

        const regionLoversApiUrl = process.env.REGION_LOVERS_API_URL || 'https://api-prod.regionlovers.ai';
        const userToken = request.cookies?.accessToken || request.headers.authorization?.replace('Bearer ', '');

        const clustersResponse = await fetch(`${regionLoversApiUrl}/place-instance-drafts/region/${regionId}`, {
          headers: { 'Authorization': `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        });

        if (!clustersResponse.ok) return reply.code(502).send({ error: 'Impossible de récupérer les clusters', message: `API Region Lovers: ${clustersResponse.status}` });

        const clustersData: any = await clustersResponse.json();
        let clustersArray: any[] = [];
        if (clustersData?.clusters && Array.isArray(clustersData.clusters)) clustersArray = clustersData.clusters;

        const placeInstances: any[] = [];
        for (const cluster of clustersArray) {
          const clusterId = cluster.id || cluster._id;
          const clusterName = cluster.name || 'Sans nom';
          for (const draft of (cluster.drafts || [])) {
            let realPlaceName = draft.place_name || draft.name || 'Sans nom';
            try {
              const generalInfoBlock = draft.blocks?.find((b: any) => b.block_id === 'general_info');
              const generalSection = generalInfoBlock?.sections?.find((s: any) => s.section_id === 'general_info_general');
              const nameField = generalSection?.fields?.find((f: any) => f.field_id === 'name');
              if (nameField?.value) realPlaceName = nameField.value;
            } catch { /* ignore */ }
            placeInstances.push({ place_instance_id: draft._id || draft.id, place_name: realPlaceName, place_type: draft.place_type || 'autre', cluster_id: clusterId, cluster_name: clusterName });
          }
        }

        const assignment = clusterMatchingService.autoAssignPOIs(pois, placeInstances);
        const stats = clusterMatchingService.generateStats(assignment);

        const uniqueClusterIds = Array.from(new Set(placeInstances.map(pi => pi.cluster_id)));
        const clustersMetadata = uniqueClusterIds.map(clusterId => {
          const cluster = clustersArray.find(c => (c.id || c._id) === clusterId);
          return { cluster_id: clusterId, cluster_name: cluster?.name || 'Sans nom', place_count: placeInstances.filter(pi => pi.cluster_id === clusterId).length };
        });

        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $set: { guide_id: guideId, assignment, stats, clusters_metadata: clustersMetadata, matched_at: new Date(), updated_at: new Date() } },
          { upsert: true }
        );

        const updatedPois = selectedPois.map((poi: any) => {
          let matchedPoi: any = null;
          for (const clusterId in assignment.clusters) {
            matchedPoi = assignment.clusters[clusterId].find((p: any) => p.poi.poi_id === poi.poi_id);
            if (matchedPoi) break;
          }
          if (!matchedPoi) matchedPoi = assignment.unassigned.find((p: any) => p.poi.poi_id === poi.poi_id);
          if (matchedPoi) {
            return { ...poi, cluster_id: matchedPoi.current_cluster_id === 'unassigned' ? null : matchedPoi.current_cluster_id, cluster_name: matchedPoi.current_cluster_id === 'unassigned' ? null : clustersMetadata.find((c: any) => c.cluster_id === matchedPoi.current_cluster_id)?.cluster_name, place_instance_id: matchedPoi.place_instance_id || null, matched_automatically: matchedPoi.matched_automatically, confidence: matchedPoi.suggested_match?.confidence || null, score: matchedPoi.suggested_match?.score || null };
          }
          return poi;
        });

        await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: updatedPois, updated_at: new Date() } });

        return reply.send({ assignment, stats, clusters_metadata: clustersMetadata });
      } catch (error: any) {
        return reply.code(500).send({ error: 'Erreur lors de la génération', details: error.message });
      }
    }
  );

  /**
   * GET /guides/:guideId/matching
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/matching',
    async (request, reply) => {
      const { guideId } = request.params;
      try {
        const assignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
        if (!assignment) return reply.send({ assignment: null, stats: null, clusters_metadata: [], created_at: null, updated_at: null });
        return reply.send({ assignment: assignment.assignment, stats: assignment.stats, clusters_metadata: assignment.clusters_metadata, created_at: assignment.created_at, updated_at: assignment.updated_at });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/matching/save
   */
  fastify.post<{ Params: { guideId: string }; Body: { assignment: any } }>(
    '/guides/:guideId/matching/save',
    async (request, reply) => {
      const { guideId } = request.params;
      const { assignment } = request.body;
      try {
        const stats = clusterMatchingService.generateStats(assignment);
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $set: { assignment, stats, updated_at: new Date() } }
        );
        return reply.send({ success: true, stats });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /guides/:guideId/clusters
   */
  fastify.post<{ Params: { guideId: string }; Body: { cluster_name: string } }>(
    '/guides/:guideId/clusters',
    async (request, reply) => {
      const { guideId } = request.params;
      const { cluster_name } = request.body;
      if (!cluster_name?.trim()) return reply.code(400).send({ error: 'Le nom du cluster est requis' });

      try {
        const clusterId = `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const newCluster = { cluster_id: clusterId, cluster_name: cluster_name.trim(), place_count: 0, is_manual: true, created_at: new Date() };

        const existingAssignment = await db.collection(COLLECTIONS.cluster_assignments).findOne({ guide_id: guideId });
        if (existingAssignment) {
          await db.collection(COLLECTIONS.cluster_assignments).updateOne(
            { guide_id: guideId },
            { $push: { clusters_metadata: newCluster } as any, $set: { updated_at: new Date() } }
          );
        } else {
          await db.collection(COLLECTIONS.cluster_assignments).insertOne({ guide_id: guideId, clusters_metadata: [newCluster], assignment: { clusters: {}, unassigned: [] }, stats: { total_pois: 0, assigned: 0, unassigned: 0, auto_matched: 0, manual_matched: 0, by_cluster: {} }, created_at: new Date(), updated_at: new Date() });
        }

        return reply.send({ success: true, cluster: newCluster });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * DELETE /guides/:guideId/clusters/:clusterId
   */
  fastify.delete<{ Params: { guideId: string; clusterId: string } }>(
    '/guides/:guideId/clusters/:clusterId',
    async (request, reply) => {
      const { guideId, clusterId } = request.params;
      try {
        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (poisSelection) {
          const updatedPois = poisSelection.pois.map((p: any) => p.cluster_id === clusterId ? { ...p, cluster_id: null, cluster_name: null, matched_automatically: false, updated_at: new Date() } : p);
          await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: updatedPois, updated_at: new Date() } });
        }

        const result = await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId },
          { $pull: { clusters_metadata: { cluster_id: clusterId } } as any, $set: { updated_at: new Date() } }
        );

        if (result.matchedCount === 0) return reply.code(404).send({ error: 'Cluster ou guide non trouvé' });
        return reply.send({ success: true, message: 'Cluster supprimé et POIs réaffectés' });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * PATCH /guides/:guideId/clusters/:clusterId
   */
  fastify.patch<{ Params: { guideId: string; clusterId: string }; Body: { cluster_name: string } }>(
    '/guides/:guideId/clusters/:clusterId',
    async (request, reply) => {
      const { guideId, clusterId } = request.params;
      const { cluster_name } = request.body;
      if (!cluster_name?.trim()) return reply.code(400).send({ error: 'Le nom du cluster est requis' });

      const newName = cluster_name.trim();
      try {
        await db.collection(COLLECTIONS.cluster_assignments).updateOne(
          { guide_id: guideId, 'clusters_metadata.cluster_id': clusterId },
          { $set: { 'clusters_metadata.$.cluster_name': newName, updated_at: new Date() } }
        );

        const poisSelection = await db.collection(COLLECTIONS.pois_selection).findOne({ guide_id: guideId });
        if (poisSelection) {
          const updatedPois = poisSelection.pois.map((p: any) => p.cluster_id === clusterId ? { ...p, cluster_name: newName } : p);
          await db.collection(COLLECTIONS.pois_selection).updateOne({ guide_id: guideId }, { $set: { pois: updatedPois, updated_at: new Date() } });
        }

        return reply.send({ success: true, cluster_id: clusterId, cluster_name: newName });
      } catch (error: any) {
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
