import { Db } from 'mongodb';
import OpenAI from 'openai';
import { GeocodingService } from './geocoding.service.js';

/**
 * Contexte passé à chaque service lors de l'export.
 * Le service reçoit l'intégralité des informations disponibles au moment de l'exécution.
 */
export interface FieldServiceContext {
  /** ID du guide en cours d'export */
  guideId: string;

  /** Document guide complet (MongoDB) */
  guide: Record<string, any>;

  /** Page actuelle en cours de traitement (MongoDB raw) */
  currentPage: Record<string, any>;

  /**
   * Toutes les pages déjà construites lors de la passe 1 de l'export.
   * Triées par page_number (ordre du chemin de fer).
   * Contient : id, page_number, template, section, titre, entity_meta, content.
   */
  allExportedPages: ExportedPageSnapshot[];

  /** Connexion MongoDB (si le service a besoin de données complémentaires) */
  db: Db;
}

export interface ExportedPageSnapshot {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source?: string | null;
  entity_meta: {
    page_type: string | null;
    cluster_id: string | null;
    cluster_name: string | null;
    poi_id: string | null;
    poi_name: string | null;
    inspiration_id: string | null;
    inspiration_title: string | null;
    season: string | null;
  };
  content: {
    text: Record<string, string>;
    images: Record<string, any>;
    pictos: Record<string, any>;
  };
}

export interface FieldServiceResult {
  /** Valeur calculée à injecter dans le champ (texte ou JSON sérialisé) */
  value: string;
}

type FieldServiceHandler = (ctx: FieldServiceContext) => Promise<FieldServiceResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Implémentations des services
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Générateur de table des matières (Sommaire).
 *
 * Parcourt toutes les pages exportées dans l'ordre du chemin de fer,
 * reconstruit les sections et, pour la section "Clusters et lieux",
 * liste tous les clusters avec leur numéro de page.
 *
 * Structure de sortie (JSON sérialisé) :
 * {
 *   "sections": [
 *     { "titre": "Introduction",       "page": 2,  "clusters": [] },
 *     { "titre": "Clusters et lieux",  "page": 5,  "clusters": [
 *         { "nom": "Puerto de la Cruz", "page": 5  },
 *         { "nom": "Santa Cruz",        "page": 12 }
 *     ]},
 *     { "titre": "Inspirations",        "page": 20, "clusters": [] }
 *   ]
 * }
 */
async function generateSommaireContent(ctx: FieldServiceContext): Promise<FieldServiceResult> {
  const { allExportedPages } = ctx;

  interface SommaireSection {
    titre: string;
    page: number;
    clusters: Array<{ nom: string; page: number }>;
  }

  const sections: SommaireSection[] = [];
  let currentSection: SommaireSection | null = null;

  // Templates considérés comme des en-têtes de section
  const SECTION_TEMPLATES = new Set([
    'SECTION',
    'INTRODUCTION',
    'COUVERTURE',
    'EDITO',
    'PRATIQUE',
    'INSPIRATIONS_HEADER',
  ]);

  // Templates ou types de page considérés comme des pages cluster
  const CLUSTER_TEMPLATES = new Set(['CLUSTER', 'CLUSTER_LIEUX']);

  for (const page of allExportedPages) {
    const templateName = (page.template || '').toUpperCase();
    const pageType = (page.entity_meta?.page_type || '').toLowerCase();

    const isSection =
      SECTION_TEMPLATES.has(templateName) ||
      templateName.includes('SECTION') ||
      pageType === 'section_header';

    const isCluster =
      CLUSTER_TEMPLATES.has(templateName) ||
      pageType === 'cluster' ||
      pageType === 'cluster_header';

    if (isSection) {
      // Démarrer une nouvelle section
      const sectionTitre =
        page.content?.text?.['SECTION_titre_1'] ||
        page.content?.text?.['INTRODUCTION_titre_1'] ||
        page.titre ||
        `Section page ${page.page_number}`;

      currentSection = {
        titre: sectionTitre,
        page: page.page_number,
        clusters: [],
      };
      sections.push(currentSection);
    } else if (isCluster) {
      // Ajouter le cluster à la section courante
      const clusterNom =
        page.entity_meta?.cluster_name ||
        page.content?.text?.['CLUSTER_titre_1'] ||
        page.titre ||
        `Cluster page ${page.page_number}`;

      const clusterEntry = { nom: clusterNom, page: page.page_number };

      if (currentSection) {
        currentSection.clusters.push(clusterEntry);
      } else {
        // Cluster sans section parente — créer une section implicite
        currentSection = {
          titre: 'Clusters et lieux',
          page: page.page_number,
          clusters: [clusterEntry],
        };
        sections.push(currentSection);
      }
    }
  }

  const result = { sections };
  return { value: JSON.stringify(result, null, 2) };
}

// Singleton partagé entre les handlers (pas d'état, safe)
const _geocodingService = new GeocodingService();

/**
 * Lien Google Maps géocodé pour un POI.
 *
 * Utilise le nom du POI (entity_meta.poi_name ou titre de la page) et
 * la destination du guide pour interroger Nominatim, puis retourne un
 * lien structuré {"label":"...","url":"https://maps.google.com/?q=lat,lon"}.
 *
 * Configurable via field.service_options dans le template :
 *   label         : texte du lien (défaut : "Voir sur Google Maps")
 *   map_provider  : "google_maps" | "openstreetmap" | "geo" (défaut : "google_maps")
 *   query_field   : nom du champ texte à utiliser comme requête de géocodage
 *                   (ex: "POI_titre_1" — défaut : poi_name ou titre de la page)
 */
async function generateMapsLink(ctx: FieldServiceContext): Promise<FieldServiceResult> {
  const { currentPage, guide } = ctx;

  // Options configurables depuis le template (field.service_options)
  const options: Record<string, string> = (currentPage as any)._serviceOptions ?? {};
  const labelText   = options['label']        ?? 'Voir sur Google Maps';
  const provider    = options['map_provider'] ?? 'google_maps';
  const queryField  = options['query_field']  ?? null;

  // Construire la requête de géocodage
  let query: string =
    currentPage.entity_meta?.poi_name ||
    currentPage.titre                 ||
    '';

  // Si query_field est précisé, utiliser la valeur de ce champ texte
  if (queryField && currentPage.content?.text?.[queryField]) {
    query = String(currentPage.content.text[queryField]);
  }

  if (!query) {
    console.warn('[geocoding_maps_link] Impossible de déterminer le nom du lieu');
    return { value: JSON.stringify({ label: labelText, url: '' }) };
  }

  // guide.destination (legacy) ou guide.destinations[0] (schema actuel)
  const destination: string = guide.destination ?? guide.destinations?.[0] ?? guide.name ?? '';
  const country = destination ? _geocodingService.getCountryFromDestination(destination) : undefined;

  // Enrichir la requête avec la destination (ex: "Cathédrale de La Laguna, Tenerife, Spain")
  // → précision bien supérieure à un simple pays ("Spain") seul
  const enrichedQuery = destination ? `${query}, ${destination}` : query;

  console.log(`[geocoding_maps_link] Géocodage : "${enrichedQuery}" (${country ?? 'pays inconnu'})`);

  const result = await _geocodingService.resolve(enrichedQuery, country);

  if (!result) {
    console.warn(`[geocoding_maps_link] Aucun résultat pour "${query}"`);
    return { value: JSON.stringify({ label: labelText, url: '' }) };
  }

  const url = result.urls[provider as keyof typeof result.urls] ?? result.urls.google_maps;

  return {
    value: JSON.stringify({ label: labelText, url }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Service spécial : inspiration_poi_cards
// Génère les champs indexés pour chaque POI d'une page inspiration :
//   INSPIRATION_poi_image_N, _nom_N, _hashtag_N, _lien_article_N, _lien_maps_N
// Retourne un Record<fieldName, value> qui doit être mergé dans page.content.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appel OpenAI minimaliste (modèle rapide) pour générer du texte court.
 */
async function miniAI(openaiApiKey: string, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: openaiApiKey });
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 60,
    temperature: 0.4,
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Recherche la meilleure image associée à un POI dans image_analyses.
 * Priorité : is_iconic_view=true > editorial_relevance='forte' > première trouvée.
 * Retourne une URL ou null si aucune image n'est taguée.
 */
async function findBestPoiImage(db: Db, poiName: string): Promise<string | null> {
  const docs = await db
    .collection('image_analyses')
    .find({ poi_names: poiName })
    .project({ url: 1, 'analysis.is_iconic_view': 1, 'analysis.editorial_relevance': 1 })
    .toArray();

  if (docs.length === 0) return null;

  const ranked = docs.sort((a: any, b: any) => {
    const aIconic = a.analysis?.is_iconic_view ? 2 : 0;
    const bIconic = b.analysis?.is_iconic_view ? 2 : 0;
    const aRel = a.analysis?.editorial_relevance === 'forte' ? 1 : 0;
    const bRel = b.analysis?.editorial_relevance === 'forte' ? 1 : 0;
    return (bIconic + bRel) - (aIconic + aRel);
  });

  return (ranked[0] as any).url ?? null;
}

/**
 * Génère les champs de cartes POI pour une page inspiration.
 *
 * Pour chaque POI de page.metadata.inspiration_pois (indexé de 1 à N) :
 *   INSPIRATION_poi_image_N       → URL image la plus emblématique (vide si aucune)
 *   INSPIRATION_poi_nom_N         → Nom court généré par IA
 *   INSPIRATION_poi_hashtag_N     → #Hashtag lié au POI et à l'angle éditorial
 *   INSPIRATION_poi_lien_article_N → JSON {"label":"...","url":"..."} vers l'article
 *   INSPIRATION_poi_lien_maps_N   → JSON {"label":"...","url":"..."} Google Maps
 *
 * Appelé directement depuis workers.routes.ts (pas via le loop field-by-field standard).
 */
export async function runInspirationPoiCards(
  ctx: FieldServiceContext,
  openaiApiKey: string
): Promise<Record<string, string>> {
  const { currentPage, guide, db } = ctx;

  const inspirationPois: Array<{ poi_id?: string; nom: string; url_source: string | null }> =
    currentPage.metadata?.inspiration_pois ?? [];

  if (inspirationPois.length === 0) {
    console.warn('[inspiration_poi_cards] Aucun POI dans metadata.inspiration_pois');
    return {};
  }

  // Récupérer l'angle éditorial depuis la collection inspirations
  const inspirationId: string | undefined = currentPage.metadata?.inspiration_id;
  let angleEditorial = '';
  if (inspirationId) {
    const inspDoc = await db.collection('inspirations').findOne({ guide_id: ctx.guideId });
    const inspItem = (inspDoc?.inspirations ?? []).find(
      (i: any) => i.theme_id === inspirationId || i.inspiration_id === inspirationId
    );
    angleEditorial = inspItem?.angle_editorial ?? '';
  }

  const destination: string = guide.destinations?.[0] ?? guide.destination ?? '';
  const country = destination ? _geocodingService.getCountryFromDestination(destination) : undefined;

  const result: Record<string, string> = {};

  for (let i = 0; i < inspirationPois.length; i++) {
    const poi = inspirationPois[i];
    const idx = i + 1;

    console.log(`[inspiration_poi_cards] POI ${idx}/${inspirationPois.length} : "${poi.nom}"`);

    // ── 1. IMAGE ──────────────────────────────────────────────────────────────
    const imageUrl = await findBestPoiImage(db, poi.nom);
    result[`INSPIRATION_poi_image_${idx}`] = imageUrl ?? '';

    // ── 2. NOM (réécriture courte par IA) ────────────────────────────────────
    let nomCourt = poi.nom;
    try {
      const nomPrompt =
        `Réécris ce nom de lieu pour une carte de guide touristique : "${poi.nom}".` +
        (angleEditorial ? ` Angle de la page : "${angleEditorial}".` : '') +
        ' Réponds uniquement avec le nom court (sans ponctuation finale, sans guillemets).';
      const aiNom = await miniAI(openaiApiKey, nomPrompt);
      if (aiNom) nomCourt = aiNom;
    } catch {
      // Fallback : nom brut
    }
    result[`INSPIRATION_poi_nom_${idx}`] = nomCourt;

    // ── 3. HASHTAG ────────────────────────────────────────────────────────────
    let hashtag = '';
    try {
      const hashPrompt =
        `Génère un seul hashtag (avec #) pour le lieu "${poi.nom}"` +
        (angleEditorial ? ` dans le contexte de l'inspiration "${angleEditorial}"` : '') +
        '. Le hashtag doit être court, en français ou en langue locale, sans espace. ' +
        'Réponds uniquement avec le hashtag.';
      hashtag = await miniAI(openaiApiKey, hashPrompt);
    } catch {
      hashtag = '';
    }
    result[`INSPIRATION_poi_hashtag_${idx}`] = hashtag;

    // ── 4. LIEN ARTICLE ───────────────────────────────────────────────────────
    result[`INSPIRATION_poi_lien_article_${idx}`] = poi.url_source
      ? JSON.stringify({ label: 'En savoir plus', url: poi.url_source })
      : '';

    // ── 5. LIEN GOOGLE MAPS ───────────────────────────────────────────────────
    try {
      const enrichedQuery = destination ? `${poi.nom}, ${destination}` : poi.nom;
      const geoResult = await _geocodingService.resolve(enrichedQuery, country);
      result[`INSPIRATION_poi_lien_maps_${idx}`] = geoResult
        ? JSON.stringify({ label: 'Voir sur Google Maps', url: geoResult.urls.google_maps })
        : '';
    } catch {
      result[`INSPIRATION_poi_lien_maps_${idx}`] = '';
    }

    // Délai poli entre POIs pour éviter le rate-limiting
    if (i < inspirationPois.length - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log(`[inspiration_poi_cards] ${inspirationPois.length} POI(s) traité(s) → ${Object.keys(result).length} champs générés`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registre des services disponibles
// Clé = service_id (doit correspondre à la valeur en base dans field_services)
// ─────────────────────────────────────────────────────────────────────────────

export const REGISTERED_SERVICES: Record<string, FieldServiceHandler> = {
  sommaire_generator:  generateSommaireContent,
  geocoding_maps_link: generateMapsLink,
};

// ─────────────────────────────────────────────────────────────────────────────
// Runner principal
// ─────────────────────────────────────────────────────────────────────────────

export class FieldServiceRunner {
  /**
   * Exécute un service enregistré et retourne la valeur calculée.
   *
   * @throws Error si le service_id n'est pas enregistré dans REGISTERED_SERVICES
   */
  async run(serviceId: string, ctx: FieldServiceContext): Promise<FieldServiceResult> {
    const handler = REGISTERED_SERVICES[serviceId];
    if (!handler) {
      throw new Error(
        `FieldService "${serviceId}" non implémenté. Services disponibles : ${Object.keys(REGISTERED_SERVICES).join(', ')}`
      );
    }
    return handler(ctx);
  }

  /**
   * Liste les service_id implémentés (pour diagnostic).
   */
  listImplemented(): string[] {
    return Object.keys(REGISTERED_SERVICES);
  }
}
