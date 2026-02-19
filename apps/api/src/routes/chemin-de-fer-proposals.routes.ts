import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';

export default async function cheminDeFerProposalsRoutes(fastify: FastifyInstance) {
  const db = fastify.mongo.db!;

  /**
   * GET /guides/:guideId/chemin-de-fer/proposals
   * Génère les propositions de pages basées sur le template de guide et les données des étapes 3 et 4
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/chemin-de-fer/proposals',
    async (request, reply) => {
      const { guideId } = request.params;

      try {
        console.log(`📋 [Proposals] Génération des propositions pour guide ${guideId}`);

        // 1. Charger le guide
        const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
          return reply.code(404).send({ error: 'Guide non trouvé' });
        }

        // 2. Charger le template de guide
        let guideTemplate;
        if (guide.guide_template_id) {
          guideTemplate = await db.collection('guide_templates').findOne({
            _id: new ObjectId(guide.guide_template_id),
          });
        }

        if (!guideTemplate) {
          guideTemplate = await db.collection('guide_templates').findOne({ is_default: true });
        }

        if (!guideTemplate) {
          return reply.code(400).send({
            error: 'Aucun template de guide trouvé',
          });
        }

        // 3. Charger les données des étapes 3 et 4
        const clusters = await db.collection('cluster_assignments').findOne({ guide_id: guideId });
        const inspirations = await db.collection('inspirations').findOne({ guide_id: guideId });
        const pois = await db.collection('pois_selection').findOne({ guide_id: guideId });

        console.log(`📊 Données chargées:`);
        console.log(`  - Template: ${guideTemplate.name}`);
        console.log(`  - Clusters: ${clusters?.clusters_metadata?.length || 0}`);
        console.log(`  - Inspirations: ${inspirations?.inspirations?.length || 0}`);
        console.log(`  - POIs: ${pois?.pois?.length || 0}`);

        // 4. Générer les propositions par catégorie
        const proposals: any = {
          fixed_pages: [],
          cluster_pages: [],
          poi_pages: [],
          inspiration_pages: [],
          saison_pages: [],
        };

        // Traiter chaque bloc du template
        for (const block of guideTemplate.structure || []) {
          if (block.type === 'fixed_page') {
            // Pages fixes
            proposals.fixed_pages.push({
              page_id: `fixed_${block.template_name}_${Date.now()}`,
              template_name: block.template_name,
              titre: getPageTitle(block.template_name),
              section_name: block.name,
              ordre: block.ordre,
              type: 'fixed',
            });
          } else if (block.type === 'section') {
            if (block.source === 'clusters' && clusters?.clusters_metadata) {
              // Section clusters
              const poisList = pois?.pois || [];
              const poisByCluster = new Map<string, any[]>();
              
              for (const poi of poisList) {
                if (poi.cluster_id) {
                  if (!poisByCluster.has(poi.cluster_id)) {
                    poisByCluster.set(poi.cluster_id, []);
                  }
                  poisByCluster.get(poi.cluster_id)!.push(poi);
                }
              }

              for (const cluster of clusters.clusters_metadata) {
                const clusterPois = poisByCluster.get(cluster.cluster_id) || [];
                
                if (clusterPois.length === 0) continue;

                // Page intro cluster
                proposals.cluster_pages.push({
                  page_id: `cluster_${cluster.cluster_id}_${Date.now()}`,
                  template_name: 'CLUSTER',
                  titre: cluster.cluster_name,
                  cluster_id: cluster.cluster_id,
                  cluster_name: cluster.cluster_name,
                  section_name: block.section_title || 'Lieux par zones',
                  type: 'cluster_intro',
                  poi_count: clusterPois.length,
                });

                // Pages POI
                for (const poi of clusterPois) {
                  proposals.poi_pages.push({
                    page_id: `poi_${poi.poi_id}_${Date.now()}`,
                    template_name: 'POI',
                    titre: poi.nom,
                    poi_id: poi.poi_id,
                    poi_name: poi.nom,
                    cluster_id: cluster.cluster_id,
                    cluster_name: cluster.cluster_name,
                    section_name: block.section_title || 'Lieux par zones',
                    type: 'poi',
                    // Champs nécessaires pour résoudre url_source côté frontend
                    article_source: poi.article_source ?? null,
                    autres_articles_mentions: poi.autres_articles_mentions ?? [],
                  });
                }
              }
            } else if (block.source === 'inspirations' && inspirations?.inspirations) {
              // Section inspirations
              const poisPerPage = block.pois_per_page || 6;

              for (const inspiration of inspirations.inspirations) {
                const associatedPois = inspiration.lieux_associes || [];
                if (associatedPois.length === 0) continue;

                const pagesCount = Math.ceil(associatedPois.length / poisPerPage);

                for (let pageIndex = 0; pageIndex < pagesCount; pageIndex++) {
                  proposals.inspiration_pages.push({
                    page_id: `inspiration_${inspiration.theme_id}_${pageIndex}_${Date.now()}`,
                    template_name: 'INSPIRATION',
                    titre: `${inspiration.titre} (${pageIndex + 1}/${pagesCount})`,
                    inspiration_id: inspiration.theme_id,
                    inspiration_title: inspiration.titre,
                    section_name: block.section_title || 'Inspirations',
                    type: 'inspiration',
                    page_index: pageIndex + 1,
                    total_pages: pagesCount,
                    poi_count: Math.min(poisPerPage, associatedPois.length - pageIndex * poisPerPage),
                  });
                }
              }
            } else if (block.source === 'none' && block.pages_count && block.template_name === 'SAISON') {
              // Section saisons
              const saisons = ['Printemps', 'Été', 'Automne', 'Hiver'];
              for (let i = 0; i < block.pages_count; i++) {
                proposals.saison_pages.push({
                  page_id: `saison_${i}_${Date.now()}`,
                  template_name: 'SAISON',
                  titre: saisons[i] || `Saison ${i + 1}`,
                  saison: saisons[i]?.toLowerCase(),
                  section_name: block.section_title || 'Les saisons',
                  type: 'saison',
                });
              }
            }
          }
        }

        // Compter les totaux
        const stats = {
          total: 
            proposals.fixed_pages.length +
            proposals.cluster_pages.length +
            proposals.poi_pages.length +
            proposals.inspiration_pages.length +
            proposals.saison_pages.length,
          by_type: {
            fixed: proposals.fixed_pages.length,
            clusters: proposals.cluster_pages.length,
            pois: proposals.poi_pages.length,
            inspirations: proposals.inspiration_pages.length,
            saisons: proposals.saison_pages.length,
          },
        };

        console.log(`✅ [Proposals] ${stats.total} propositions générées`);

        return reply.send({
          template_name: guideTemplate.name,
          proposals,
          stats,
        });
      } catch (error: any) {
        console.error('❌ [Proposals] Erreur:', error);
        return reply.code(500).send({
          error: 'Erreur lors de la génération des propositions',
          details: error.message,
        });
      }
    }
  );
}

// Fonction helper pour générer des titres lisibles
function getPageTitle(templateName: string): string {
  const titles: Record<string, string> = {
    COUVERTURE: 'Couverture',
    PRESENTATION_GUIDE: 'Présentation du guide',
    PRESENTATION_DESTINATION: 'Présentation de la destination',
    CARTE_DESTINATION: 'Carte de la destination',
    ALLER_PLUS_LOIN: 'Aller plus loin',
    A_PROPOS_RL: 'À propos de Region Lovers',
  };
  return titles[templateName] || templateName;
}
