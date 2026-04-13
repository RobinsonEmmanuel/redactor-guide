import { Db, ObjectId } from 'mongodb';
import { OpenAIService } from './openai.service';
import { GeocodingService } from './geocoding.service';
import { COLLECTIONS } from '../config/collections.js';
import { getArticlesDatabase } from '../config/database.js';

export interface SommaireGeneratorConfig {
  db: Db;
  openaiService: OpenAIService;
}

export interface ArticleForSommaire {
  title: string;
  slug: string;
  categories: string[];
  url_francais?: string;
}

export interface SommaireSection {
  section_id: string;
  section_nom: string;
  description_courte: string;
  articles_associes: string[];
}

export interface SommairePOI {
  poi_id: string;
  nom: string;
  type: string;
  article_source: string;
  raison_selection: string;
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}

export interface SommaireInspiration {
  theme_id: string;
  titre: string;
  angle_editorial: string;
  lieux_associes: string[];
}

export interface SommaireProposal {
  sections: SommaireSection[];
  pois: SommairePOI[];
  inspirations: SommaireInspiration[];
}

export class SommaireGeneratorService {
  private db: Db;
  private openaiService: OpenAIService;
  private geocodingService: GeocodingService;

  constructor(config: SommaireGeneratorConfig) {
    this.db = config.db;
    this.openaiService = config.openaiService;
    this.geocodingService = new GeocodingService();
  }

  /**
   * Générer le sommaire (complet ou parties spécifiques)
   * @param guideId ID du guide
   * @param parts Parties à générer (défaut: toutes)
   */
  async generateSommaire(
    guideId: string, 
    parts: string[] = ['sections', 'pois', 'inspirations']
  ): Promise<Partial<SommaireProposal>> {
    console.log(`🚀 Génération sommaire pour guide ${guideId} - Parties: ${parts.join(', ')}`);

    // 1. Charger le guide
    const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(guideId) });
    if (!guide) {
      throw new Error('Guide non trouvé');
    }

    const destination = guide.destination || guide.name;
    const siteUrl = guide.wpConfig?.siteUrl || 'WordPress';

    // 2. Charger les articles WordPress
    const articles = await this.loadArticles(guideId, destination);
    console.log(`📚 ${articles.length} articles chargés`);

    const proposal: Partial<SommaireProposal> = {};

    // 3. Générer les sections si demandé
    if (parts.includes('sections')) {
      console.log('🔹 Étape A : Génération des sections');
      const promptSections = await this.loadPrompt('structure_sections');
      const sectionsResult = await this.generateSections(promptSections, destination, articles);
      console.log(`✅ ${sectionsResult.sections.length} sections générées`);
      proposal.sections = sectionsResult.sections;
    }

    // 4. Générer les POIs si demandé
    if (parts.includes('pois')) {
      console.log('🔹 Étape B : Sélection des POIs');
      const promptPOIs = await this.loadPrompt('selection_pois');
      const poisResult = await this.generatePOIs(promptPOIs, destination, siteUrl, articles);
      console.log(`✅ ${poisResult.pois.length} POIs sélectionnés`);
      
      // Enrichir les POIs avec les coordonnées GPS
      if (poisResult.pois.length > 0) {
        console.log('🌍 Géolocalisation des POIs...');
        const pays = this.geocodingService.getCountryFromDestination(destination);
        const enrichedPois = await this.enrichPoisWithCoordinates(poisResult.pois, pays);
        proposal.pois = enrichedPois;
      } else {
        proposal.pois = poisResult.pois;
      }
    }

    // 5. Générer les inspirations si demandé
    if (parts.includes('inspirations')) {
      console.log('🔹 Étape C : Génération des pages inspiration');

      // Sections : priorité à ce qui vient d'être généré, sinon en base
      let sections = proposal.sections;
      if (!sections) {
        const existingProposal = await this.db.collection('sommaire_proposals').findOne({ guide_id: guideId });
        sections = existingProposal?.proposal?.sections || [];
      }

      // POIs : utiliser UNIQUEMENT pois_selection (référentiel stable confirmé par l'utilisateur)
      // Fallback sur sommaire_proposals uniquement si pois_selection est vide (guide très récent)
      let pois: SommairePOI[] = [];
      const poisSelectionDoc = await this.db.collection('pois_selection').findOne({ guide_id: guideId });
      const confirmedPois: any[] = poisSelectionDoc?.pois ?? [];

      if (confirmedPois.length > 0) {
        // Convertir au format SommairePOI (même structure, poi_id est déjà stable)
        pois = confirmedPois.map((p: any) => ({
          poi_id:            p.poi_id,
          nom:               p.nom,
          type:              p.type || 'lieu',
          article_source:    p.article_source || '',
          raison_selection:  p.raison_selection || '',
        }));
        console.log(`✅ [inspirations] ${pois.length} POIs confirmés depuis pois_selection`);
      } else {
        // Fallback : pois du sommaire proposal (non encore confirmés — guide très récent)
        const existingProposal = await this.db.collection('sommaire_proposals').findOne({ guide_id: guideId });
        pois = existingProposal?.proposal?.pois || proposal.pois || [];
        console.log(`⚠️ [inspirations] pois_selection vide — fallback sommaire_proposals (${pois.length} POIs)`);
      }

      const promptInspirations = await this.loadPrompt('pages_inspiration');
      const inspirationsResult = await this.generateInspirations(
        promptInspirations,
        destination,
        sections || [],
        pois
      );
      console.log(`✅ ${inspirationsResult.inspirations.length} pages inspiration générées`);
      proposal.inspirations = inspirationsResult.inspirations;
    }

    return proposal;
  }

  /**
   * Charger les articles WordPress filtrés par destination
   */
  private async loadArticles(guideId: string, destination: string): Promise<ArticleForSommaire[]> {
    // Charger le guide pour récupérer le site_id
    const guide = await this.db.collection('guides').findOne({ _id: new ObjectId(guideId) });
    if (!guide || !guide.wpConfig?.siteUrl) {
      throw new Error('Guide ou configuration WordPress manquante');
    }

    // Récupérer le site_id
    const site = await this.db.collection('sites').findOne({ url: guide.wpConfig.siteUrl });
    if (!site) {
      throw new Error('Site WordPress non trouvé');
    }

    // Charger les articles du site, filtrés par destination
    const articles = await getArticlesDatabase()
      .collection(COLLECTIONS.articles_raw)
      .find({ 
        site_id: site._id.toString(),
        categories: { $in: [destination] },
      })
      .toArray();

    return articles.map((article: any) => ({
      title: article.title,
      slug: article.slug,
      categories: article.categories || [],
      url_francais: article.urls_by_lang?.fr || '',
    }));
  }

  /**
   * Charger un prompt depuis la base
   */
  private async loadPrompt(intent: string): Promise<string> {
    const prompt = await this.db.collection('prompts').findOne({
      intent,
      actif: true,
    });

    if (!prompt) {
      throw new Error(`Prompt non trouvé : ${intent}`);
    }

    return prompt.texte_prompt;
  }

  /**
   * Étape A — Générer les sections
   */
  private async generateSections(
    promptTemplate: string,
    destination: string,
    articles: ArticleForSommaire[]
  ): Promise<{ sections: SommaireSection[] }> {
    const listeArticles = articles
      .map((a) => `- ${a.title} (${a.slug}) [${a.categories.join(', ')}]`)
      .join('\n');

    const prompt = this.openaiService.replaceVariables(promptTemplate, {
      DESTINATION: destination,
      LISTE_ARTICLES_STRUCTURÉE: listeArticles,
    });

    return await this.openaiService.generateJSON(prompt, 12000);
  }

  /**
   * Étape B — Sélectionner les POIs
   */
  private async generatePOIs(
    promptTemplate: string,
    destination: string,
    siteUrl: string,
    articles: ArticleForSommaire[]
  ): Promise<{ pois: SommairePOI[] }> {
    const listeArticles = articles
      .map((a) => `- ${a.title} (${a.slug})`)
      .join('\n');

    const prompt = this.openaiService.replaceVariables(promptTemplate, {
      SITE: siteUrl,
      DESTINATION: destination,
      LISTE_ARTICLES_POI: listeArticles,
    });

    return await this.openaiService.generateJSON(prompt, 12000);
  }

  /**
   * Étape C — Générer les pages inspiration
   */
  private async generateInspirations(
    promptTemplate: string,
    destination: string,
    sections: SommaireSection[],
    pois: SommairePOI[]
  ): Promise<{ inspirations: SommaireInspiration[] }> {
    const sectionsJson = JSON.stringify(sections, null, 2);
    const poisJson = JSON.stringify(pois.map(p => ({ poi_id: p.poi_id, nom: p.nom, type: p.type })), null, 2);

    const prompt = this.openaiService.replaceVariables(promptTemplate, {
      DESTINATION: destination,
      SECTIONS: sectionsJson,
      POIS: poisJson,
    });

    return await this.openaiService.generateJSON(prompt, 12000);
  }

  /**
   * Enrichir les POIs avec les coordonnées GPS via Nominatim
   */
  private async enrichPoisWithCoordinates(
    pois: SommairePOI[],
    pays: string
  ): Promise<SommairePOI[]> {
    const lieuxToGeocode = pois.map(poi => ({
      nom: poi.nom,
      pays: pays,
    }));

    const coordinates = await this.geocodingService.geocodePlaces(lieuxToGeocode);

    // Enrichir chaque POI avec ses coordonnées
    const enrichedPois = pois.map(poi => {
      const coords = coordinates.get(poi.nom);
      
      if (coords) {
        return {
          ...poi,
          coordinates: {
            lat: coords.lat,
            lon: coords.lon,
            display_name: coords.display_name,
          },
        };
      }
      
      // Pas de coordonnées trouvées, retourner le POI tel quel
      return poi;
    });

    const withCoords = enrichedPois.filter(p => p.coordinates).length;
    console.log(`📍 ${withCoords}/${pois.length} POI(s) géolocalisé(s)`);

    return enrichedPois;
  }

  /**
   * Sauvegarder la proposition de sommaire
   * (Méthode privée, utilisée par chemin-de-fer.routes.ts pour fusionner les parties)
   */
  async saveProposal(guideId: string, proposal: SommaireProposal): Promise<void> {
    await this.db.collection('sommaire_proposals').updateOne(
      { guide_id: guideId },
      {
        $set: {
          guide_id: guideId,
          proposal,
          created_at: new Date(),
          status: 'generated',
        },
      },
      { upsert: true }
    );
  }
}
