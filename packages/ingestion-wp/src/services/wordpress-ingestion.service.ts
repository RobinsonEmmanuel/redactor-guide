import { Db, Collection } from 'mongodb';
import { ArticleRawSchema, type ArticleRaw, type ImageAnalysis } from '@redactor-guide/core-model';
import {
  WordPressPostSchema,
  WordPressMediaSchema,
  WordPressCategorySchema,
  WordPressTagSchema,
  type WordPressPost,
  type WordPressMedia,
} from '../schemas/wordpress-api.schema';
import { extractImageUrls } from '../utils/html.utils';
import { htmlToMarkdown } from '../utils/markdown.utils';

/**
 * Interface du service d'ingestion WordPress
 */
export interface IWordPressIngestionService {
  fetchPosts(siteUrl: string, params?: FetchPostsParams): Promise<WordPressPost[]>;
  fetchPostsWithAuth(siteUrl: string, jwtToken: string, params?: FetchPostsParams): Promise<WordPressPost[]>;
  fetchMedia(siteUrl: string, mediaId: number): Promise<WordPressMedia | null>;
  ingestPost(post: WordPressPost, siteUrl: string): Promise<void>;
  ingestMedia(media: WordPressMedia, siteUrl: string): Promise<void>;
  /** Ingère tous les articles (FR + URLs WPML) dans articles_raw. Aucune transformation éditoriale. */
  ingestArticlesToRaw(
    siteId: string,
    destinationIds: string[],
    siteUrl: string,
    jwtToken: string,
    languages?: string[],
    analysisPrompt?: string,
    analyzeImages?: boolean
  ): Promise<IngestArticlesResult>;
}

export interface IngestArticlesResult {
  count: number;
  errors: string[];
}

/**
 * Paramètres pour la récupération des posts
 */
export interface FetchPostsParams {
  page?: number;
  perPage?: number;
  postType?: string;
  status?: string;
  language?: string;
}

/**
 * Service d'ingestion de contenu WordPress
 * 
 * Responsabilités :
 * - Récupérer les contenus depuis l'API REST WordPress
 * - Valider les données avec Zod
 * - Stocker dans MongoDB
 * - Gérer la synchronisation WPML
 */
export class WordPressIngestionService implements IWordPressIngestionService {
  private postsCollection: Collection;
  private mediaCollection: Collection;
  private articlesRawCollection: Collection;
  private sitesCollection: Collection;
  private imageAnalysisCallback?: (imageUrls: string[], analysisPrompt: string) => Promise<ImageAnalysis[]>;

  constructor(
    private readonly db: Db,
    private readonly httpClient: typeof fetch = fetch
  ) {
    this.postsCollection = this.db.collection('wordpress_posts');
    this.mediaCollection = this.db.collection('wordpress_media');
    this.articlesRawCollection = this.db.collection('articles_raw');
    this.sitesCollection = this.db.collection('sites');
  }

  /**
   * Définir le callback pour l'analyse d'images
   * Utilisé par le conteneur DI pour injecter le service d'analyse
   */
  setImageAnalysisCallback(
    callback: (imageUrls: string[], analysisPrompt: string) => Promise<ImageAnalysis[]>
  ): void {
    this.imageAnalysisCallback = callback;
  }

  private async getWithAuth<T>(url: string, jwtToken: string): Promise<T> {
    const response = await this.httpClient(url, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Récupérer les posts depuis WordPress
   */
  async fetchPosts(
    siteUrl: string,
    params: FetchPostsParams = {}
  ): Promise<WordPressPost[]> {
    const {
      page = 1,
      perPage = 100,
      postType = 'post',
      status = 'publish',
      language,
    } = params;

    const queryParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      type: postType,
      status,
      ...(language && { lang: language }),
    });

    const url = `${siteUrl}/wp-json/wp/v2/posts?${queryParams}`;

    try {
      const response = await this.httpClient(url);

      if (!response.ok) {
        throw new Error(
          `Erreur HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json() as unknown[];

      const posts = data.map((post) => WordPressPostSchema.parse(post));

      return posts;
    } catch (error) {
      console.error(`Erreur lors de la récupération des posts de ${siteUrl}:`, error);
      throw error;
    }
  }

  /**
   * Récupérer les posts avec authentification JWT (pour WPML / contenu protégé)
   */
  async fetchPostsWithAuth(
    siteUrl: string,
    jwtToken: string,
    params: FetchPostsParams = {}
  ): Promise<WordPressPost[]> {
    const {
      page = 1,
      perPage = 100,
      status = 'publish',
      language = 'fr',
    } = params;

    const queryParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      status,
      ...(language && { lang: language }),
    });

    const url = `${siteUrl}/wp-json/wp/v2/posts?${queryParams}`;
    const data = await this.getWithAuth<unknown[]>(url, jwtToken);
    return data.map((post) => WordPressPostSchema.parse(post));
  }

  /**
   * Récupérer toutes les catégories (id -> name)
   */
  private async fetchCategoriesMap(siteUrl: string, jwtToken: string): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const url = `${siteUrl}/wp-json/wp/v2/categories?per_page=100&page=${page}`;
      const data = await this.getWithAuth<unknown[]>(url, jwtToken);
      if (data.length === 0) break;
      for (const c of data) {
        const cat = WordPressCategorySchema.parse(c);
        map.set(cat.id, cat.name);
      }
      page++;
      hasMore = data.length === 100;
    }
    return map;
  }

  /**
   * Récupérer tous les tags (id -> name)
   */
  private async fetchTagsMap(siteUrl: string, jwtToken: string): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const url = `${siteUrl}/wp-json/wp/v2/tags?per_page=100&page=${page}`;
      const data = await this.getWithAuth<unknown[]>(url, jwtToken);
      if (data.length === 0) break;
      for (const t of data) {
        const tag = WordPressTagSchema.parse(t);
        map.set(tag.id, tag.name);
      }
      page++;
      hasMore = data.length === 100;
    }
    return map;
  }

  /**
   * Ingère les articles WordPress (FR + URLs WPML) dans articles_raw.
   * Aucune transformation éditoriale.
   * 
   * Stratégie multi-langue :
   * 1. Récupère tous les articles pour chaque langue (fr, en, de, es, it, pt, nl, pl, ru)
   * 2. Groupe par `guid` (qui pointe toujours vers l'URL FR pour les traductions WPML)
   * 3. Construit `urls_by_lang` en mappant les `link` de chaque langue
   * 4. Stocke UN SEUL article par guid (version FR) avec toutes les URLs
   * 5. Optionnel : analyse les images avec OpenAI Vision
   */
  async ingestArticlesToRaw(
    siteId: string,
    destinationIds: string[],
    siteUrl: string,
    jwtToken: string,
    languages?: string[],
    analysisPrompt?: string,
    analyzeImages: boolean = false
  ): Promise<IngestArticlesResult> {
    const errors: string[] = [];
    let count = 0;

    // 1. Créer/mettre à jour le document dans la collection sites
    await this.sitesCollection.updateOne(
      { url: siteUrl },
      {
        $set: {
          url: siteUrl,
          _id: siteId,
          name: new URL(siteUrl).hostname,
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`Site créé/mis à jour: ${siteUrl} (ID: ${siteId})`);

    // 2. Supprimer les anciens articles de ce site avant de réingérer
    const deleteResult = await this.articlesRawCollection.deleteMany({ site_id: siteId });
    console.log(`Supprimé ${deleteResult.deletedCount} articles existants pour le site ${siteId}`);

    const categoriesMap = await this.fetchCategoriesMap(siteUrl, jwtToken);
    const tagsMap = await this.fetchTagsMap(siteUrl, jwtToken);

    // Utiliser les langues fournies ou par défaut toutes les langues
    const targetLanguages = languages && languages.length > 0 
      ? languages 
      : ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];

    // Map<url_fr, Map<lang, post>> pour grouper les traductions
    // La clé est l'URL FR (soit le link de l'article FR, soit le guid des traductions)
    const articlesByFrUrl = new Map<string, Map<string, WordPressPost>>();

    // 1. Récupérer tous les articles pour chaque langue
    console.log(`Récupération des articles pour ${targetLanguages.length} langues: ${targetLanguages.join(', ')}`);
    for (const lang of targetLanguages) {
      console.log(`  -> Langue: ${lang}`);
      let page = 1;
      const perPage = 50;
      let hasMore = true;
      let langCount = 0;

      while (hasMore) {
        try {
          const posts = await this.fetchPostsWithAuth(siteUrl, jwtToken, {
            page,
            perPage,
            status: 'publish',
            language: lang,
          });

          if (posts.length === 0) break;

          for (const post of posts) {
            const guid = post.guid?.rendered ?? '';
            if (!guid) continue;

            // Déterminer la clé de groupement (URL FR)
            let frUrl: string;
            if (lang === 'fr') {
              // Pour les articles FR, la clé est leur propre link
              frUrl = post.link;
            } else {
              // Pour les traductions, le guid pointe vers l'URL FR
              // Si le guid est au format ?p=ID, on skip (article orphelin)
              if (guid.includes('?p=')) {
                continue;
              }
              frUrl = guid;
            }

            // LOG DEBUG : afficher les 3 premiers articles de chaque langue pour debug
            if (langCount < 3) {
              console.log(`      [${lang}] Post "${post.title?.rendered?.substring(0, 40)}":`);
              console.log(`        - GUID: ${guid}`);
              console.log(`        - LINK: ${post.link}`);
              console.log(`        - FR URL (clé): ${frUrl}`);
            }

            if (!articlesByFrUrl.has(frUrl)) {
              articlesByFrUrl.set(frUrl, new Map());
            }
            articlesByFrUrl.get(frUrl)!.set(lang, post);
            langCount++;
          }

          page++;
          hasMore = posts.length === perPage;
        } catch (err) {
          errors.push(`Erreur récupération ${lang} page ${page}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
      console.log(`     ${langCount} articles trouvés`);
    }

    console.log(`Total: ${articlesByFrUrl.size} articles uniques (groupés par URL FR)`);

    // LOG DEBUG : afficher les langues disponibles pour les 3 premiers groupes
    let debugCount = 0;
    for (const [frUrl, postsByLang] of articlesByFrUrl.entries()) {
      if (debugCount < 3) {
        const langs = Array.from(postsByLang.keys()).join(', ');
        console.log(`  Groupe ${debugCount + 1}: ${frUrl.substring(0, 60)} => [${langs}]`);
        debugCount++;
      }
    }

    // 2. Pour chaque groupe d'articles (par URL FR), créer un ArticleRaw
    for (const [frUrl, postsByLang] of articlesByFrUrl.entries()) {
      try {
        // Utiliser la version FR comme référence
        const frPost = postsByLang.get('fr');
        if (!frPost) {
          errors.push(`Pas de version FR pour URL: ${frUrl.substring(0, 60)}`);
          continue;
        }

        // Construire urls_by_lang en mappant les links de chaque langue
        const urlsByLang: Record<string, string> = {};
        for (const [lang, post] of postsByLang.entries()) {
          urlsByLang[lang] = post.link;
        }

        const categoryNames = (frPost.categories ?? [])
          .map((id) => categoriesMap.get(id))
          .filter((n): n is string => n != null);
        const tagNames = (frPost.tags ?? [])
          .map((id) => tagsMap.get(id))
          .filter((n): n is string => n != null);

        // Extraire les URLs des images du HTML
        const htmlContent = frPost.content?.rendered ?? '';
        const imageUrls = extractImageUrls(htmlContent);
        
        // Convertir le HTML en Markdown pour l'aide IA
        const markdown = htmlToMarkdown(htmlContent);

        // Analyser les images si demandé
        let imagesAnalysis: ImageAnalysis[] = [];
        if (analyzeImages && analysisPrompt && imageUrls.length > 0 && this.imageAnalysisCallback) {
          console.log(`📸 Analyse de ${imageUrls.length} images pour "${frPost.title?.rendered?.substring(0, 40)}"`);
          try {
            imagesAnalysis = await this.imageAnalysisCallback(imageUrls, analysisPrompt);
            console.log(`✅ ${imagesAnalysis.length} images analysées`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ Erreur analyse images: ${msg}`);
            errors.push(`Erreur analyse images pour "${frPost.title?.rendered}": ${msg}`);
          }
        }

        const raw: Omit<ArticleRaw, '_id'> = {
          site_id: siteId,
          destination_ids: destinationIds,
          slug: frPost.slug,
          title: frPost.title?.rendered ?? '',
          html_brut: htmlContent,
          markdown: markdown,
          categories: categoryNames,
          tags: tagNames,
          urls_by_lang: urlsByLang,
          images: imageUrls,
          ...(imagesAnalysis.length > 0 && { images_analysis: imagesAnalysis }),
          updated_at: frPost.modified ?? frPost.date,
        };

        ArticleRawSchema.parse(raw);

        await this.articlesRawCollection.updateOne(
          { site_id: siteId, slug: frPost.slug },
          { $set: { ...raw, updated_at: new Date(frPost.modified || frPost.date) } },
          { upsert: true }
        );
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`URL FR ${frUrl.substring(0, 50)}: ${msg}`);
      }
    }

    return { count, errors };
  }

  /**
   * Récupérer un média depuis WordPress
   */
  async fetchMedia(
    siteUrl: string,
    mediaId: number
  ): Promise<WordPressMedia | null> {
    const url = `${siteUrl}/wp-json/wp/v2/media/${mediaId}`;

    try {
      const response = await this.httpClient(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(
          `Erreur HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();

      // Validation avec Zod
      return WordPressMediaSchema.parse(data);
    } catch (error) {
      console.error(
        `Erreur lors de la récupération du média ${mediaId} de ${siteUrl}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Ingérer un post dans MongoDB
   */
  async ingestPost(post: WordPressPost, siteUrl: string): Promise<void> {
    // Validation avant insertion
    const validatedPost = WordPressPostSchema.parse(post);

    const document = {
      ...validatedPost,
      sourceUrl: siteUrl,
      lastSyncAt: new Date(),
    };

    await this.postsCollection.updateOne(
      { id: validatedPost.id, sourceUrl: siteUrl },
      { $set: document },
      { upsert: true }
    );
  }

  /**
   * Ingérer un média dans MongoDB
   */
  async ingestMedia(media: WordPressMedia, siteUrl: string): Promise<void> {
    // Validation avant insertion
    const validatedMedia = WordPressMediaSchema.parse(media);

    const document = {
      ...validatedMedia,
      sourceUrl: siteUrl,
      lastSyncAt: new Date(),
    };

    await this.mediaCollection.updateOne(
      { id: validatedMedia.id, sourceUrl: siteUrl },
      { $set: document },
      { upsert: true }
    );
  }
}
