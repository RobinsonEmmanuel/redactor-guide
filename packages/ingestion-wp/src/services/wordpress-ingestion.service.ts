import { Db, Collection } from 'mongodb';
import {
  WordPressPostSchema,
  WordPressMediaSchema,
  type WordPressPost,
  type WordPressMedia,
} from '../schemas/wordpress-api.schema';

/**
 * Interface du service d'ingestion WordPress
 */
export interface IWordPressIngestionService {
  fetchPosts(siteUrl: string, params?: FetchPostsParams): Promise<WordPressPost[]>;
  fetchMedia(siteUrl: string, mediaId: number): Promise<WordPressMedia | null>;
  ingestPost(post: WordPressPost, siteUrl: string): Promise<void>;
  ingestMedia(media: WordPressMedia, siteUrl: string): Promise<void>;
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

  /**
   * Injection de dépendances via constructeur
   */
  constructor(
    private readonly db: Db,
    private readonly httpClient: typeof fetch = fetch
  ) {
    this.postsCollection = this.db.collection('wordpress_posts');
    this.mediaCollection = this.db.collection('wordpress_media');
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

      // Validation avec Zod
      const posts = data.map((post) => WordPressPostSchema.parse(post));

      return posts;
    } catch (error) {
      console.error(`Erreur lors de la récupération des posts de ${siteUrl}:`, error);
      throw error;
    }
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
