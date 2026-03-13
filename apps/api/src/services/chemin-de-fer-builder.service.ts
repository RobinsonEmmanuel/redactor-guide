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
  page_id: string;
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
    inspiration_pois_ids?: string[];
    saison?: string;
    page_type?: string;
    page_index?: number;
    total_pages?: number;
    entries_per_page?: number;
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
          guideTemplate,
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
      page_id: `fixed_${templateName}`,
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
    guideTemplate: GuideTemplate,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    const sectionId = `section_${block.name}_${Date.now()}`;

    switch (block.source) {
      case 'clusters': {
        const clusterPages = await this.createClusterPages(
          guideId, block, context, sectionId, startOrder
        );
        pages.push(...clusterPages);
        break;
      }
      case 'inspirations': {
        const inspirationPages = await this.createInspirationPages(
          guideId, block, context, sectionId, startOrder
        );
        pages.push(...inspirationPages);
        break;
      }
      case 'sommaire': {
        // Nombre de pages calculé dynamiquement selon le contenu réel du guide
        const sommairePages = await this.createSommairePages(
          guideId, block, context, guideTemplate, sectionId, startOrder
        );
        pages.push(...sommairePages);
        break;
      }
      case 'none': {
        // Section fixe répétée (ex: saisons)
        if (block.pages_count && block.template_name) {
          const fixedPages = await this.createRepeatedFixedPages(
            guideId, block, sectionId, startOrder
          );
          pages.push(...fixedPages);
        }
        break;
      }
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
      clusterIntroPage.page_id = `cluster_${cluster.cluster_id}`;
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
        poiPage.page_id = `poi_${poi.poi_id}`;
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
        // Slice des POIs appartenant à cette page (ex: page 1 → POIs 0..5, page 2 → POIs 6..11)
        const pagePoiIds: string[] = associatedPois.slice(
          pageIndex * poisPerPage,
          (pageIndex + 1) * poisPerPage
        );

        const inspirationPage = await this.createFixedPage(
          guideId,
          'INSPIRATION',
          currentOrder,
          block.section_title
        );
        const inspirationId = inspiration.theme_id ?? inspiration.inspiration_id ?? `insp_${currentOrder}`;
        inspirationPage.page_id = `inspiration_${inspirationId}_${pageIndex}`;
        inspirationPage.section_id = sectionId;
        inspirationPage.metadata = {
          ...inspirationPage.metadata,
          inspiration_id:       inspiration.theme_id ?? inspiration.inspiration_id,
          inspiration_title:    inspiration.titre,
          inspiration_pois_ids: pagePoiIds,
          page_type:   'inspiration',
          page_index:  pageIndex + 1,
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
      page.page_id = `${block.name ?? 'repeated'}_${i}`;
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

  /**
   * Crée N pages de sommaire dynamiques.
   * Le nombre de pages est calculé automatiquement à partir du contenu réel du guide :
   * - On compte les entrées de premier niveau (pages fixes + 1 par section groupée)
   * - On divise par entries_per_page (défaut 12) pour obtenir le nombre de pages
   *
   * Les numéros de page définitifs sont calculés à l'export (via allExportedPages),
   * pas ici. Le builder positionne uniquement les pages dans le chemin de fer.
   */
  private async createSommairePages(
    guideId: string,
    block: any,
    context: BuildContext,
    guideTemplate: GuideTemplate,
    sectionId: string,
    startOrder: number
  ): Promise<PageDocument[]> {
    const pages: PageDocument[] = [];
    const entriesPerPage: number = block.entries_per_page ?? 12;
    const templateName: string  = block.template_name ?? 'SOMMAIRE';

    // Compter les entrées attendues pour déterminer le nombre de pages
    const nbEntries  = this.countExpectedSommaireEntries(guideTemplate, context);
    const pagesCount = Math.max(1, Math.ceil(nbEntries / entriesPerPage));

    console.log(`  📑 Sommaire dynamique: ~${nbEntries} entrées → ${pagesCount} page(s) à ${entriesPerPage} entrées/page`);

    for (let i = 0; i < pagesCount; i++) {
      const page = await this.createFixedPage(guideId, templateName, startOrder + i, block.section_title);
      page.page_id    = `sommaire_${i + 1}`;
      page.section_id = sectionId;
      page.metadata   = {
        ...page.metadata,
        page_type:       'sommaire',
        page_index:      i + 1,
        total_pages:     pagesCount,
        entries_per_page: entriesPerPage,
      };
      pages.push(page);
    }

    return pages;
  }

  /**
   * Estime le nombre d'entrées de premier niveau dans le sommaire pour ce guide.
   *
   * Règles identiques au générateur (field-service-runner) :
   *   - Pages fixes non-exclues → 1 entrée chacune
   *   - Section clusters (si des clusters existent) → 1 entrée groupée
   *   - Section inspirations (si des inspirations existent) → 1 entrée groupée
   *   - Section saisons (source:'none', name:'saisons') → 1 entrée groupée
   *   - Section sommaire → non comptée
   *   - POI, COUVERTURE, SOMMAIRE → exclus
   */
  private countExpectedSommaireEntries(guideTemplate: GuideTemplate, context: BuildContext): number {
    let count = 0;

    for (const block of guideTemplate.structure) {
      if (block.type === 'fixed_page') {
        const name = (block.template_name ?? '').toUpperCase();
        if (name.startsWith('POI') || name.startsWith('COUVERTURE') || name.startsWith('SOMMAIRE')) continue;
        count++;
      } else if (block.type === 'section') {
        if (block.source === 'sommaire') continue; // la page sommaire elle-même n'y figure pas

        if (block.source === 'clusters') {
          if ((context.clusters?.clusters_metadata?.length ?? 0) > 0) count++;
        } else if (block.source === 'inspirations') {
          if ((context.inspirations?.inspirations?.length ?? 0) > 0) count++;
        } else if (block.source === 'none') {
          // Saisons et autres sections fixes répétées → 1 entrée groupée
          if ((block.pages_count ?? 0) > 0) count++;
        }
      }
    }

    return Math.max(count, 1);
  }
}
