import { Db } from 'mongodb';
import { GuideTemplate } from '@redactor-guide/core-model';

interface BuilderDependencies {
  db: Db;
}

interface BuildContext {
  clusters?: any;
  inspirations?: any;
  pois?: any;
}

interface PageDocument {
  guide_id: string;
  template_name: string;
  order: number;
  section_id?: string;
  section_name?: string;
  status: string;
  metadata: {
    cluster_id?: string;
    cluster_name?: string;
    poi_id?: string;
    poi_name?: string;
    article_source?: string | null;
    autres_articles_mentions?: string[];
    inspiration_id?: string;
    inspiration_title?: string;
    saison?: string;
    page_type?: string;
    page_index?: number;
    total_pages?: number;
  };
  fields: any[];
  created_at: string;
  updated_at: string;
}

/**
 * Service pour construire la structure du chemin de fer à partir d'un guide template
 */
export class CheminDeFerBuilderService {
  private db: Db;

  constructor({ db }: BuilderDependencies) {
    this.db = db;
  }

  /**
   * Construit la structure complète du chemin de fer à partir d'un guide template
   */
  async buildFromTemplate(
    guideId: string,
    guideTemplate: GuideTemplate,
    context: BuildContext
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    let currentOrder = 1;

    console.log(`🏗️ [CheminDeFer Builder] Construction pour guide ${guideId}`);
    console.log(`📋 Template: ${guideTemplate.name} (${guideTemplate.structure.length} blocs)`);

    // Parcourir la structure du template
    for (const block of guideTemplate.structure) {
      console.log(`\n🔨 Traitement bloc ${block.ordre}: ${block.type} - ${block.name || block.template_name}`);

      if (block.type === 'fixed_page') {
        // Page fixe unique
        const page = await this.createFixedPage(
          guideId,
          block.template_name!,
          currentOrder,
          block.name
        );
        pages.push(page);
        currentOrder++;
        console.log(`  ✅ Page fixe "${block.template_name}" créée (ordre: ${page.order})`);
      } else if (block.type === 'section') {
        // Section dynamique
        const sectionPages = await this.createSectionPages(
          guideId,
          block,
          context,
          currentOrder
        );
        pages.push(...sectionPages);
        currentOrder += sectionPages.length;
        console.log(`  ✅ Section "${block.name}" créée (${sectionPages.length} pages)`);
      }
    }

    console.log(`\n✅ [CheminDeFer Builder] ${pages.length} pages créées au total`);
    return pages;
  }

  /**
   * Crée une page fixe
   */
  private async createFixedPage(
    guideId: string,
    templateName: string,
    order: number,
    sectionName?: string
  ): Promise<PageDocument> {
    const now = new Date().toISOString();

    // Récupérer le template pour obtenir les champs
    const template = await this.db.collection('templates').findOne({ name: templateName });

    if (!template) {
      console.warn(`⚠️ Template "${templateName}" non trouvé, création avec champs vides`);
    }

    return {
      guide_id: guideId,
      template_name: templateName,
      order,
      section_name: sectionName,
      status: 'draft',
      metadata: {
        page_type: 'fixed',
      },
      fields: template?.fields?.map((field: any) => ({
        ...field,
        value: '',
      })) || [],
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Crée les pages d'une section dynamique
   */
  private async createSectionPages(
    guideId: string,
    block: any,
    context: BuildContext,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    const sectionId = `section_${block.name}_${Date.now()}`;

    switch (block.source) {
      case 'clusters':
        // Section lieux par zones
        const clusterPages = await this.createClusterPages(
          guideId,
          block,
          context,
          sectionId,
          startOrder
        );
        pages.push(...clusterPages);
        break;

      case 'inspirations':
        // Section inspirations
        const inspirationPages = await this.createInspirationPages(
          guideId,
          block,
          context,
          sectionId,
          startOrder
        );
        pages.push(...inspirationPages);
        break;

      case 'none':
        // Section fixe répétée (ex: saisons)
        if (block.pages_count && block.template_name) {
          const fixedPages = await this.createRepeatedFixedPages(
            guideId,
            block,
            sectionId,
            startOrder
          );
          pages.push(...fixedPages);
        }
        break;
    }

    return pages;
  }

  /**
   * Crée les pages pour la section clusters (1 page intro + N pages POI par cluster)
   */
  private async createClusterPages(
    guideId: string,
    block: any,
    context: BuildContext,
    sectionId: string,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    let currentOrder = startOrder;

    if (!context.clusters || !context.pois) {
      console.warn('⚠️ Pas de données clusters/pois disponibles');
      return pages;
    }

    const { clusters_metadata } = context.clusters;
    const poisList = context.pois.pois || [];

    // Grouper les POIs par cluster
    const poisByCluster = new Map<string, any[]>();
    for (const poi of poisList) {
      if (poi.cluster_id) {
        if (!poisByCluster.has(poi.cluster_id)) {
          poisByCluster.set(poi.cluster_id, []);
        }
        poisByCluster.get(poi.cluster_id)!.push(poi);
      }
    }

    console.log(`  📍 ${clusters_metadata?.length || 0} clusters, ${poisList.length} POIs`);

    // Pour chaque cluster
    for (const cluster of clusters_metadata || []) {
      const clusterPois = poisByCluster.get(cluster.cluster_id) || [];
      
      if (clusterPois.length === 0) {
        console.log(`  ⏭️ Cluster "${cluster.cluster_name}" ignoré (aucun POI)`);
        continue;
      }

      // 1. Page intro du cluster
      const clusterIntroPage = await this.createFixedPage(
        guideId,
        'CLUSTER',
        currentOrder,
        block.section_title
      );
      clusterIntroPage.section_id = sectionId;
      clusterIntroPage.metadata = {
        ...clusterIntroPage.metadata,
        cluster_id: cluster.cluster_id,
        cluster_name: cluster.cluster_name,
        page_type: 'cluster_intro',
      };
      pages.push(clusterIntroPage);
      currentOrder++;

      console.log(`    ✅ Page intro cluster "${cluster.cluster_name}" (${clusterPois.length} POIs)`);

      // 2. Une page par POI dans le cluster
      for (const poi of clusterPois) {
        const poiPage = await this.createFixedPage(
          guideId,
          'POI',
          currentOrder,
          block.section_title
        );
        poiPage.section_id = sectionId;
        poiPage.metadata = {
          ...poiPage.metadata,
          cluster_id:               cluster.cluster_id,
          cluster_name:             cluster.cluster_name,
          poi_id:                   poi.poi_id,
          poi_name:                 poi.nom,
          article_source:           poi.article_source   ?? null,
          autres_articles_mentions: poi.autres_articles_mentions ?? [],
          page_type: 'poi',
        };
        pages.push(poiPage);
        currentOrder++;
      }

      console.log(`    ✅ ${clusterPois.length} pages POI créées`);
    }

    return pages;
  }

  /**
   * Crée les pages pour la section inspirations (N pages avec X POIs par page)
   */
  private async createInspirationPages(
    guideId: string,
    block: any,
    context: BuildContext,
    sectionId: string,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    let currentOrder = startOrder;

    if (!context.inspirations) {
      console.warn('⚠️ Pas de données inspirations disponibles');
      return pages;
    }

    const inspirationsList = context.inspirations.inspirations || [];
    const poisPerPage = block.pois_per_page || 6;

    console.log(`  💡 ${inspirationsList.length} inspirations, ${poisPerPage} POIs/page`);

    // Pour chaque inspiration
    for (const inspiration of inspirationsList) {
      const associatedPois = inspiration.lieux_associes || [];
      
      if (associatedPois.length === 0) {
        console.log(`  ⏭️ Inspiration "${inspiration.titre}" ignorée (aucun POI)`);
        continue;
      }

      // Calculer le nombre de pages nécessaires (multiples de poisPerPage)
      const pagesCount = Math.ceil(associatedPois.length / poisPerPage);

      console.log(`    💡 Inspiration "${inspiration.titre}" (${associatedPois.length} POIs → ${pagesCount} pages)`);

      // Créer les pages
      for (let pageIndex = 0; pageIndex < pagesCount; pageIndex++) {
        const inspirationPage = await this.createFixedPage(
          guideId,
          'INSPIRATION',
          currentOrder,
          block.section_title
        );
        inspirationPage.section_id = sectionId;
        inspirationPage.metadata = {
          ...inspirationPage.metadata,
          inspiration_id: inspiration.inspiration_id,
          inspiration_title: inspiration.titre,
          page_type: 'inspiration',
          page_index: pageIndex + 1,
          total_pages: pagesCount,
        };
        pages.push(inspirationPage);
        currentOrder++;
      }

      console.log(`    ✅ ${pagesCount} page(s) inspiration créée(s)`);
    }

    return pages;
  }

  /**
   * Crée des pages fixes répétées (ex: 4 saisons)
   */
  private async createRepeatedFixedPages(
    guideId: string,
    block: any,
    sectionId: string,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    const pagesCount = block.pages_count || 1;
    const templateName = block.template_name!;

    console.log(`  📄 ${pagesCount} pages répétées avec template "${templateName}"`);

    // Métadonnées spécifiques selon le type de section
    const specificMetadata: any[] = [];
    if (block.name === 'saisons') {
      specificMetadata.push(
        { saison: 'printemps' },
        { saison: 'ete' },
        { saison: 'automne' },
        { saison: 'hiver' }
      );
    }

    for (let i = 0; i < pagesCount; i++) {
      const page = await this.createFixedPage(
        guideId,
        templateName,
        startOrder + i,
        block.section_title
      );
      page.section_id = sectionId;
      page.metadata = {
        ...page.metadata,
        page_type: 'repeated_fixed',
        page_index: i + 1,
        ...specificMetadata[i],
      };
      pages.push(page);
    }

    return pages;
  }
}
