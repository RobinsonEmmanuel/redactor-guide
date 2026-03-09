import { Db, Collection } from 'mongodb';
import { ArticleRawSchema, type ArticleRaw, type ImageAnalysis } from '@redactor-guide/core-model';
import {
  WordPressPostSchema,
  WordPressPostUrlMinSchema,
  WordPressMediaSchema,
  WordPressCategorySchema,
  WordPressTagSchema,
  type WordPressPost,
  type WordPressMedia,
} from '../schemas/wordpress-api.schema';
import { extractImageUrls, normalizeImageUrl } from '../utils/html.utils';
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
  /**
   * Synchronise uniquement les URLs de traduction (appel léger avec _fields)
   * pour un site déjà ingéré en FR. À appeler avant un export traduit.
   */
  syncTranslationUrls(
    siteId: string,
    siteUrl: string,
    jwtToken: string,
    languages: string[]
  ): Promise<{ updated: number; skipped: number; errors: string[] }>;
  /** Définir le callback pour l'analyse d'images via IA */
  setImageAnalysisCallback(callback: (imageUrls: string[], analysisPrompt: string) => Promise<ImageAnalysis[]>): void;
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
   * Ingère les articles WordPress dans articles_raw.
   *
   * Stratégie URL multi-langue (simplifiée) :
   * - On ne récupère QUE les articles en français.
   * - Chaque article FR contient `wpml_translations` qui liste les URLs de
   *   toutes ses traductions (en, es, de, it, da, sv, pt-pt, nl).
   * - On construit directement `urls_by_lang` depuis ce champ, sans aucun
   *   appel supplémentaire à l'API WordPress.
   * - Avantage : 1 seul appel API au lieu de 9, fiable même si le slug change
   *   d'une langue à l'autre (ex : "visite-musee" → "museum-visit").
   */
  async ingestArticlesToRaw(
    siteId: string,
    destinationIds: string[],
    siteUrl: string,
    jwtToken: string,
    _languages?: string[],   // conservé pour compatibilité, non utilisé
    analysisPrompt?: string,
    analyzeImages: boolean = false
  ): Promise<IngestArticlesResult> {
    const errors: string[] = [];
    let count = 0;

    // 1. Créer/mettre à jour le document dans la collection sites
    // _id dans $setOnInsert uniquement — MongoDB interdit de modifier _id via $set
    await this.sitesCollection.updateOne(
      { url: siteUrl },
      {
        $set: {
          url: siteUrl,
          name: new URL(siteUrl).hostname,
          updated_at: new Date(),
        },
        $setOnInsert: {
          _id: siteId,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`Site créé/mis à jour: ${siteUrl} (ID: ${siteId})`);

    const categoriesMap = await this.fetchCategoriesMap(siteUrl, jwtToken);
    const tagsMap = await this.fetchTagsMap(siteUrl, jwtToken);

    // 3. Récupérer UNIQUEMENT les articles FR (wpml_translations embarque les URLs)
    console.log(`Récupération des articles FR depuis ${siteUrl}...`);
    const frPosts: WordPressPost[] = [];
    let page = 1;
    const perPage = 50;

    while (true) {
      try {
        const posts = await this.fetchPostsWithAuth(siteUrl, jwtToken, {
          page,
          perPage,
          status: 'publish',
          language: 'fr',
        });
        if (posts.length === 0) break;
        frPosts.push(...posts);
        page++;
        if (posts.length < perPage) break;
      } catch (err) {
        errors.push(`Erreur récupération FR page ${page}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }

    console.log(`${frPosts.length} articles FR récupérés`);

    // Vérifier la présence de wpml_translations sur le premier article
    const haswpml = frPosts.length > 0 && (frPosts[0].wpml_translations?.length ?? 0) > 0;
    if (!haswpml && frPosts.length > 0) {
      console.warn('⚠️  wpml_translations absent ou vide sur les articles FR.');
      console.warn('    Les URLs de traduction ne seront pas disponibles.');
      console.warn('    Vérifiez que WPML expose bien ce champ dans la REST API.');
    } else if (frPosts.length > 0) {
      const sample = frPosts[0].wpml_translations!;
      console.log(`✅ wpml_translations présent — langues détectées sur le 1er article : ${sample.map(t => t.locale).join(', ')}`);
    }

    // 4. Ingérer chaque article FR
    for (const post of frPosts) {
      try {
        // ── Construire urls_by_lang depuis wpml_translations ──────────────────
        const urlsByLang: Record<string, string> = { fr: post.link };

        for (const translation of post.wpml_translations ?? []) {
          if (!translation.href) continue;
          const lang = wpmlLocaleToLang(translation.locale);
          if (lang && lang !== 'fr') {
            urlsByLang[lang] = translation.href;
          }
        }

        const langsCovered = Object.keys(urlsByLang).join(', ');

        // ── Catégories / tags ─────────────────────────────────────────────────
        const categoryNames = (post.categories ?? [])
          .map((id) => categoriesMap.get(id))
          .filter((n): n is string => n != null);
        const tagNames = (post.tags ?? [])
          .map((id) => tagsMap.get(id))
          .filter((n): n is string => n != null);

        // ── Images ────────────────────────────────────────────────────────────
        const htmlContent = post.content?.rendered ?? '';
        const rawImageUrls = extractImageUrls(htmlContent);
        const seenNormalized = new Map<string, string>();
        const imageUrls: string[] = [];

        for (const url of rawImageUrls) {
          const normalized = normalizeImageUrl(url);
          if (!seenNormalized.has(normalized)) {
            seenNormalized.set(normalized, url);
            imageUrls.push(url);
          }
        }

        // ── Analyse d'images (optionnel) ──────────────────────────────────────
        let imagesAnalysis: ImageAnalysis[] = [];
        if (analyzeImages && analysisPrompt && imageUrls.length > 0 && this.imageAnalysisCallback) {
          try {
            imagesAnalysis = await this.imageAnalysisCallback(imageUrls, analysisPrompt);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ Erreur analyse images pour "${post.title?.rendered}": ${msg}`);
            errors.push(`Erreur analyse images "${post.title?.rendered}": ${msg}`);
          }
        }

        const raw: Omit<ArticleRaw, '_id'> = {
          site_id: siteId,
          destination_ids: destinationIds,
          slug: post.slug,
          wp_id: post.id,
          title: post.title?.rendered ?? '',
          html_brut: htmlContent,
          markdown: htmlToMarkdown(htmlContent),
          categories: categoryNames,
          tags: tagNames,
          urls_by_lang: urlsByLang,
          images: imageUrls,
          ...(imagesAnalysis.length > 0 && { images_analysis: imagesAnalysis }),
          updated_at: post.modified ?? post.date,
        };

        ArticleRawSchema.parse(raw);

        // Skip si l'article existe déjà (même slug + même URL FR).
        // $setOnInsert : écriture uniquement lors d'une création (upsert).
        const upsertResult = await this.articlesRawCollection.updateOne(
          { 'urls_by_lang.fr': raw.urls_by_lang.fr },
          { $setOnInsert: { ...raw, updated_at: new Date(post.modified || post.date) } },
          { upsert: true }
        );

        if (upsertResult.upsertedCount > 0) {
          count++;
          if (count <= 3) {
            console.log(`  [+${count}] "${post.title?.rendered?.substring(0, 50)}" → [${langsCovered}]`);
          }
        }
        // article déjà présent → on ignore silencieusement
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`"${post.slug}": ${msg}`);
      }
    }

    console.log(`✅ Ingestion terminée : ${count} articles enregistrés`);
    if (errors.length > 0) {
      console.warn(`⚠️  ${errors.length} erreur(s) :`);
      errors.slice(0, 5).forEach(e => console.warn('  -', e));
    }

    // ── Synchronisation automatique des URLs de traduction ────────────────────
    // wpml_translations n'est pas toujours exposé par l'API WordPress.
    // On fait un second passage léger (?_fields=id,link,guid) pour chaque langue
    // afin de récupérer les URLs de traduction via le guid (qui pointe vers l'URL FR).
    const translationLangs = ['it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];
    console.log(`🌐 Synchronisation des URLs de traduction (${translationLangs.join(', ')})...`);
    try {
      const syncResult = await this.syncTranslationUrls(siteId, siteUrl, jwtToken, translationLangs);
      console.log(`🌐 URLs traductions : ${syncResult.updated} mises à jour, ${syncResult.skipped} ignorées`);
      if (syncResult.errors.length > 0) {
        syncResult.errors.slice(0, 3).forEach(e => console.warn('  ⚠️', e));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Sync traductions échouée : ${msg}`);
      errors.push(`Sync traductions : ${msg}`);
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
   * Synchronise uniquement les URLs de traduction pour un site déjà ingéré en FR.
   *
   * Pour chaque langue cible, fait un appel WP REST léger avec
   * ?_fields=id,link,guid,wpml_translations afin d'éviter de télécharger le
   * contenu complet. Pour chaque post trouvé on identifie l'article FR
   * correspondant via wpml_translations puis on met à jour uniquement
   * `urls_by_lang.{lang}` dans articles_raw.
   *
   * À appeler après une ingestion FR, ou à la demande avant un export traduit.
   */
  async syncTranslationUrls(
    siteId: string,
    siteUrl: string,
    jwtToken: string,
    languages: string[]
  ): Promise<{ updated: number; skipped: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;
    let skipped = 0;

    const nonFrLangs = languages.filter((l) => l !== 'fr');
    if (nonFrLangs.length === 0) return { updated, skipped, errors };

    console.log(`🌐 Sync URLs traductions — ${nonFrLangs.join(', ')} pour site ${siteId}`);

    for (const lang of nonFrLangs) {
      console.log(`  -> Langue : ${lang}`);
      let page = 1;
      const perPage = 100;
      let hasMore = true;
      let langUpdated = 0;

      while (hasMore) {
        try {
          const queryParams = new URLSearchParams({
            page: page.toString(),
            per_page: perPage.toString(),
            status: 'publish',
            lang,
            _fields: 'id,link,guid,wpml_translations',
          });
          const url = `${siteUrl}/wp-json/wp/v2/posts?${queryParams}`;
          const rawData = await this.getWithAuth<unknown[]>(url, jwtToken);

          if (rawData.length === 0) break;

          for (const raw of rawData) {
            const post = WordPressPostUrlMinSchema.parse(raw);

            // Trouver l'URL FR de référence via wpml_translations
            const frTranslation = post.wpml_translations?.find(
              (t) => t.locale.startsWith('fr') && t.href
            );
            const frUrl = frTranslation?.href ?? post.guid?.rendered;

            if (!frUrl || frUrl.includes('?p=')) {
              skipped++;
              continue;
            }

            // Chercher l'article FR en base uniquement par urls_by_lang.fr (indépendant du site_id).
            // Le guid WPML pointe toujours vers l'URL FR canonique → clé suffisamment unique.
            const frUrlNoSlash = frUrl.replace(/\/$/, '');
            const filter = {
              $or: [
                { 'urls_by_lang.fr': frUrl },
                { 'urls_by_lang.fr': frUrlNoSlash },
                { 'urls_by_lang.fr': frUrlNoSlash + '/' },
              ],
            };

            const result = await this.articlesRawCollection.updateOne(
              filter,
              { $set: { [`urls_by_lang.${lang}`]: post.link } }
            );

            if (result.matchedCount > 0) {
              langUpdated++;
            } else {
              skipped++;
            }
          }

          page++;
          hasMore = rawData.length === perPage;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`[${lang}] page ${page} : ${msg}`);
          break;
        }
      }

      updated += langUpdated;
      console.log(`     ${langUpdated} URLs mises à jour pour [${lang}]`);

      // ── Second passage : articles encore sans URL pour cette langue ──────────
      // Pour les articles dont le guid WP est numérique (?p=XXXX), la première
      // passe échoue. On utilise le redirect WPML /?p={wp_id}&lang={lang} qui
      // résout toujours l'URL traduite (ou fallback ?lang=XX si pas de slug dédié).
      const stillMissing = await this.articlesRawCollection.find(
        { wp_id: { $exists: true }, [`urls_by_lang.${lang}`]: { $exists: false } },
        { projection: { _id: 1, wp_id: 1, 'urls_by_lang.fr': 1 } }
      ).toArray();

      if (stillMissing.length > 0) {
        console.log(`     → ${stillMissing.length} article(s) sans [${lang}], résolution via redirect WPML...`);
        let redirectUpdated = 0;

        // Traiter par lots de 10 pour éviter de saturer le serveur
        const BATCH = 10;
        for (let i = 0; i < stillMissing.length; i += BATCH) {
          const batch = stillMissing.slice(i, i + BATCH);
          await Promise.all(batch.map(async (article) => {
            try {
              const redirectUrl = `${siteUrl}/?p=${article.wp_id}&lang=${lang}`;
              const resp = await fetch(redirectUrl, { redirect: 'follow' });
              const finalUrl = resp.url;
              // Ignorer si la réponse est une erreur ou si c'est le même que FR sans param lang
              if (resp.status < 400 && finalUrl && !finalUrl.includes('?p=')) {
                await this.articlesRawCollection.updateOne(
                  { _id: article._id },
                  { $set: { [`urls_by_lang.${lang}`]: finalUrl } }
                );
                redirectUpdated++;
              }
            } catch { /* ignore les timeouts individuels */ }
          }));
        }

        updated += redirectUpdated;
        console.log(`     → ${redirectUpdated} URL(s) résolues via redirect pour [${lang}]`);
      }
    }

    console.log(`✅ Sync terminé — ${updated} URLs mises à jour, ${skipped} ignorées`);
    return { updated, skipped, errors };
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


/**
 * Convertit une locale WPML (ex: "en_US", "pt_PT") vers le code de langue
 * utilisé dans urls_by_lang (ex: "en", "pt-pt").
 * Retourne null si la locale n'est pas reconnue.
 */
function wpmlLocaleToLang(locale: string): string | null {
  // Cas spéciaux d'abord
  const exact: Record<string, string> = {
    'pt_PT': 'pt-pt',
    'pt_BR': 'pt-br',
  };
  if (locale in exact) return exact[locale];

  // Préfixe 2 caractères → code lang
  const prefix = locale.split('_')[0].toLowerCase();
  const known: Record<string, string> = {
    fr: 'fr', en: 'en', it: 'it', es: 'es',
    de: 'de', da: 'da', sv: 'sv', nl: 'nl',
    pt: 'pt-pt', // fallback générique portugais
  };
  return known[prefix] ?? null;
}
