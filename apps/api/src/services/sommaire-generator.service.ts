import { Db } from 'mongodb';
import { OpenAIService } from './openai.service';

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

  constructor(config: SommaireGeneratorConfig) {
    this.db = config.db;
    this.openaiService = config.openaiService;
  }

  /**
   * Générer le sommaire complet pour un guide
   */
  async generateSommaire(guideId: string): Promise<SommaireProposal> {
    console.log(`🚀 Génération sommaire pour guide ${guideId}`);

    // 1. Charger le guide
    const guide = await this.db.collection('guides').findOne({ _id: guideId } as any);
    if (!guide) {
      throw new Error('Guide non trouvé');
    }

    const destination = guide.destination || guide.name;
    const siteUrl = guide.wpConfig?.siteUrl || 'WordPress';

    // 2. Charger les articles WordPress
    const articles = await this.loadArticles(guideId, destination);
    console.log(`📚 ${articles.length} articles chargés`);

    // 3. Charger les prompts
    const promptSections = await this.loadPrompt('structure_sections');
    const promptPOIs = await this.loadPrompt('selection_pois');
    const promptInspirations = await this.loadPrompt('pages_inspiration');

    // 4. Étape A — Générer les sections
    console.log('🔹 Étape A : Génération des sections');
    const sectionsResult = await this.generateSections(promptSections, destination, articles);
    console.log(`✅ ${sectionsResult.sections.length} sections générées`);

    // 5. Étape B — Sélectionner les POIs
    console.log('🔹 Étape B : Sélection des POIs');
    const poisResult = await this.generatePOIs(promptPOIs, destination, siteUrl, articles);
    console.log(`✅ ${poisResult.pois.length} POIs sélectionnés`);

    // 6. Étape C — Générer les pages inspiration
    console.log('🔹 Étape C : Génération des pages inspiration');
    const inspirationsResult = await this.generateInspirations(
      promptInspirations,
      destination,
      sectionsResult.sections,
      poisResult.pois
    );
    console.log(`✅ ${inspirationsResult.inspirations.length} pages inspiration générées`);

    // 7. Combiner les résultats
    const proposal: SommaireProposal = {
      sections: sectionsResult.sections,
      pois: poisResult.pois,
      inspirations: inspirationsResult.inspirations,
    };

    // 8. Sauvegarder la proposition
    await this.saveProposal(guideId, proposal);

    return proposal;
  }

  /**
   * Charger les articles WordPress filtrés par destination
   */
  private async loadArticles(guideId: string, destination: string): Promise<ArticleForSommaire[]> {
    const articles = await this.db
      .collection('articles_raw')
      .find({ guide_id: guideId })
      .toArray();

    // Filtrer par catégorie = destination
    const filtered = articles.filter((article) =>
      article.categories?.some((cat: string) => cat.toLowerCase() === destination.toLowerCase())
    );

    return filtered.map((article) => ({
      title: article.title,
      slug: article.slug,
      categories: article.categories || [],
      url_francais: article.url_francais,
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

    return await this.openaiService.generateJSON(prompt);
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

    return await this.openaiService.generateJSON(prompt);
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

    return await this.openaiService.generateJSON(prompt);
  }

  /**
   * Sauvegarder la proposition de sommaire
   */
  private async saveProposal(guideId: string, proposal: SommaireProposal): Promise<void> {
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
