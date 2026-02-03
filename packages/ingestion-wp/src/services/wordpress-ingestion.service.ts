import { Db, Collection } from 'mongodb';
import { ArticleRawSchema, type ArticleRaw } from '@redactor-guide/core-model';
import {
  WordPressPostSchema,
  WordPressMediaSchema,
  WordPressCategorySchema,
  WordPressTagSchema,
  type WordPressPost,
  type WordPressMedia,
} from '../schemas/wordpress-api.schema';
import { extractImageUrls } from '../utils/html.utils';

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
    jwtToken: string
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

  constructor(
    private readonly db: Db,
    private readonly httpClient: typeof fetch = fetch
  ) {
    this.postsCollection = this.db.collection('wordpress_posts');
    this.mediaCollection = this.db.collection('wordpress_media');
    this.articlesRawCollection = this.db.collection('articles_raw');
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
   */
  async ingestArticlesToRaw(
    siteId: string,
    destinationIds: string[],
    siteUrl: string,
    jwtToken: string
  ): Promise<IngestArticlesResult> {
    const errors: string[] = [];
    let count = 0;

    // Supprimer les anciens articles de ce site avant de réingérer
    const deleteResult = await this.articlesRawCollection.deleteMany({ site_id: siteId });
    console.log(`Supprimé ${deleteResult.deletedCount} articles existants pour le site ${siteId}`);

    const categoriesMap = await this.fetchCategoriesMap(siteUrl, jwtToken);
    const tagsMap = await this.fetchTagsMap(siteUrl, jwtToken);

    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const posts = await this.fetchPostsWithAuth(siteUrl, jwtToken, {
        page,
        perPage,
        status: 'publish',
        language: 'fr',
      });

      if (posts.length === 0) break;

      for (const post of posts) {
        try {
          const categoryNames = (post.categories ?? [])
            .map((id) => categoriesMap.get(id))
            .filter((n): n is string => n != null);
          const tagNames = (post.tags ?? [])
            .map((id) => tagsMap.get(id))
            .filter((n): n is string => n != null);

          const urlsByLang: Record<string, string> = {};
          urlsByLang.fr = post.link;
          if (post.wpml_translations) {
            for (const t of post.wpml_translations) {
              if (t.locale && t.href) urlsByLang[t.locale] = t.href;
            }
          }

          // Extraire les URLs des images du HTML
          const htmlContent = post.content?.rendered ?? '';
          const imageUrls = extractImageUrls(htmlContent);

          const raw: Omit<ArticleRaw, '_id'> = {
            site_id: siteId,
            destination_ids: destinationIds,
            slug: post.slug,
            title: post.title?.rendered ?? '',
            html_brut: htmlContent,
            categories: categoryNames,
            tags: tagNames,
            urls_by_lang: urlsByLang,
            images: imageUrls,
            updated_at: post.modified ?? post.date,
          };

          ArticleRawSchema.parse(raw);

          await this.articlesRawCollection.updateOne(
            { site_id: siteId, slug: post.slug },
            { $set: { ...raw, updated_at: new Date(post.modified || post.date) } },
            { upsert: true }
          );
          count++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Post ${post.slug}: ${msg}`);
        }
      }

      page++;
      hasMore = posts.length === perPage;
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
