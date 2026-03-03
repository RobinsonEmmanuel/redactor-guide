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

  /**
   * Définition du champ template qui a déclenché ce service.
   * Donne accès à :
   *   - fieldDef.ai_instructions    : instructions globales du champ
   *   - fieldDef.sub_fields[]       : sous-champs (type repetitif), chacun avec ai_instructions
   *   - fieldDef.max_repetitions    : nombre max d'entrées répétées
   *   - fieldDef.service_options    : options de configuration (ex : label, provider)
   *
   * Permet aux services de respecter les instructions saisies dans l'éditeur de template
   * plutôt que d'utiliser des prompts codés en dur.
   */
  fieldDef?: Record<string, any>;
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
// Service inspiration_poi_cards
//
// Génère un tableau JSON de N cartes POI pour une page inspiration.
// Chaque entrée contient : image, nom, hashtag, lien_article, lien_maps.
//
// La valeur retournée (JSON array sérialisé) est stockée dans le champ
// repetitif du template, puis "explosée" en champs plats à l'export :
//   <PREFIX>_<SUBFIELD_NAME>_1, <PREFIX>_<SUBFIELD_NAME>_2, …
//
// Les instructions IA (nom, hashtag) proviennent de ctx.fieldDef.sub_fields,
// configurables dans l'éditeur de template — aucun prompt codé en dur.
// ─────────────────────────────────────────────────────────────────────────────

/** Appel OpenAI rapide pour générer du texte très court (nom, hashtag). */
async function miniAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) return '';
  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model:       'gpt-4o-mini',
    messages:    [{ role: 'user', content: prompt }],
    max_tokens:  60,
    temperature: 0.4,
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/** Meilleure image taguée pour un POI (iconic > forte relevance > première trouvée). */
async function findBestPoiImage(db: Db, poiName: string): Promise<string | null> {
  const docs = await db
    .collection('image_analyses')
    .find({ poi_names: poiName })
    .project({ url: 1, 'analysis.is_iconic_view': 1, 'analysis.editorial_relevance': 1 })
    .toArray();

  if (docs.length === 0) return null;

  docs.sort((a: any, b: any) => {
    const score = (d: any) => (d.analysis?.is_iconic_view ? 2 : 0) + (d.analysis?.editorial_relevance === 'forte' ? 1 : 0);
    return score(b) - score(a);
  });

  return (docs[0] as any).url ?? null;
}

/**
 * Résout les instructions d'un sous-champ depuis fieldDef.sub_fields.
 * Remplace les variables {{...}} avec les valeurs du contexte POI.
 * Retourne les instructions configurées dans le template, ou le fallback par défaut.
 *
 * Variables disponibles dans les instructions du sous-champ :
 *   {{POI_NOM}}          — nom brut du POI courant
 *   {{ANGLE_EDITORIAL}}  — angle éditorial de l'inspiration (depuis la collection inspirations)
 *   {{DESTINATION}}      — destination du guide (ex: "Tenerife")
 *   {{INSPIRATION_TITRE}} — titre/thème de la page inspiration
 *   {{INSPIRATION_NB_LIEUX}} — nombre total de POIs de la page
 *   {{INSPIRATION_LIEUX}} — liste des POIs séparés par virgule
 */
function subFieldInstructions(
  fieldDef: Record<string, any> | undefined,
  subFieldName: string,
  fallback: string,
  vars: Record<string, string> = {}
): string {
  const sf = (fieldDef?.sub_fields ?? []).find((s: any) => s.name === subFieldName);
  const raw = sf?.ai_instructions?.trim() || fallback;
  // Substitution {{VARIABLE}} → valeur
  return raw.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Service inspiration_poi_cards
 *
 * Pour chaque POI de page.metadata.inspiration_pois, génère une entrée :
 *   { image, nom, hashtag, lien_article, lien_maps }
 *
 * Retourne un JSON array sérialisé, stocké dans le champ repetitif.
 * À l'export, ce tableau est "explosé" en champs plats par explodeRepetitifField().
 *
 * Instructions IA configurables dans l'éditeur de template via
 * fieldDef.sub_fields[{name:'nom', ai_instructions:'...'}].
 */
async function generateInspirationPoiCards(ctx: FieldServiceContext): Promise<FieldServiceResult> {
  const { currentPage, guide, db, fieldDef } = ctx;

  const inspirationPois: Array<{ poi_id?: string; nom: string; url_source: string | null }> =
    currentPage.metadata?.inspiration_pois ?? [];

  if (inspirationPois.length === 0) {
    console.warn('[inspiration_poi_cards] Aucun POI dans metadata.inspiration_pois');
    return { value: '[]' };
  }

  // Angle éditorial de l'inspiration (contexte commun à tous les POIs)
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

  // Variables de substitution communes à tous les POIs de la page
  const pageVars: Record<string, string> = {
    ANGLE_EDITORIAL:      angleEditorial,
    DESTINATION:          destination,
    INSPIRATION_TITRE:    currentPage.metadata?.inspiration_title ?? currentPage.titre ?? '',
    INSPIRATION_NB_LIEUX: String(inspirationPois.length),
    INSPIRATION_LIEUX:    inspirationPois.map((p) => p.nom).join(', '),
  };

  const cards: Array<Record<string, string>> = [];

  for (let i = 0; i < inspirationPois.length; i++) {
    const poi = inspirationPois[i];
    console.log(`[inspiration_poi_cards] POI ${i + 1}/${inspirationPois.length} : "${poi.nom}"`);

    // Variables spécifiques à ce POI (enrichissent pageVars)
    const poiVars: Record<string, string> = { ...pageVars, POI_NOM: poi.nom };

    // ── image ─────────────────────────────────────────────────────────────────
    const imageUrl = await findBestPoiImage(db, poi.nom);

    // ── nom (instructions depuis le template, variables substituées) ──────────
    const nomInstructions = subFieldInstructions(
      fieldDef, 'nom',
      `Réécris ce nom de lieu pour une carte de guide touristique. Angle éditorial : "{{ANGLE_EDITORIAL}}". Réponds uniquement avec le nom court (sans ponctuation finale, sans guillemets).`,
      poiVars
    );
    let nom = poi.nom;
    try {
      const aiNom = await miniAI(`${nomInstructions}\nLieu : "${poi.nom}"`);
      if (aiNom) nom = aiNom;
    } catch { /* fallback : nom brut */ }

    // ── hashtag (instructions depuis le template, variables substituées) ──────
    const hashtagInstructions = subFieldInstructions(
      fieldDef, 'hashtag',
      `Génère un seul hashtag (avec #) court, sans espace, en français ou langue locale. Angle éditorial : "{{ANGLE_EDITORIAL}}". Réponds uniquement avec le hashtag.`,
      poiVars
    );
    let hashtag = '';
    try {
      hashtag = await miniAI(`${hashtagInstructions}\nLieu : "${poi.nom}"`);
    } catch { hashtag = ''; }

    // ── lien article ──────────────────────────────────────────────────────────
    const articleLinkLabel = subFieldInstructions(fieldDef, 'lien_article', 'En savoir plus', poiVars);
    const lienArticle = poi.url_source
      ? JSON.stringify({ label: articleLinkLabel, url: poi.url_source })
      : '';

    // ── lien google maps ──────────────────────────────────────────────────────
    const mapsLinkLabel = subFieldInstructions(fieldDef, 'lien_maps', 'Voir sur Google Maps', poiVars);
    let lienMaps = '';
    try {
      const enrichedQuery = destination ? `${poi.nom}, ${destination}` : poi.nom;
      const geo = await _geocodingService.resolve(enrichedQuery, country);
      if (geo) lienMaps = JSON.stringify({ label: mapsLinkLabel, url: geo.urls.google_maps });
    } catch { lienMaps = ''; }

    cards.push({ image: imageUrl ?? '', nom, hashtag, lien_article: lienArticle, lien_maps: lienMaps });

    if (i < inspirationPois.length - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log(`[inspiration_poi_cards] ${cards.length} carte(s) générée(s)`);
  return { value: JSON.stringify(cards) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaire d'explosion d'un champ repetitif en champs plats InDesign
//
// Entrée  : fieldName = "INSPIRATION_repetitif_poi_cards"
//           value     = '[{"nom":"A","image":"x",...},...]'
// Sortie  : { "INSPIRATION_poi_cards_nom_1":"A", "INSPIRATION_poi_cards_image_1":"x", ... }
//
// Convention de nommage :
//   - Préfixe  = partie avant "_repetitif_"        → "INSPIRATION"
//   - Groupe   = partie après  "_repetitif_"        → "poi_cards"
//   - Calque   = "<Préfixe>_<groupe>_<subfield>_<N>"
// ─────────────────────────────────────────────────────────────────────────────
export function explodeRepetitifField(
  fieldName: string,
  value: string
): Record<string, string> {
  const SEP = '_repetitif_';
  const sepIdx = fieldName.indexOf(SEP);
  if (sepIdx === -1) return {};

  const prefix = fieldName.substring(0, sepIdx);           // "INSPIRATION"
  const group  = fieldName.substring(sepIdx + SEP.length); // "poi_cards"

  let entries: Array<Record<string, string>>;
  try {
    entries = JSON.parse(value);
    if (!Array.isArray(entries)) return {};
  } catch {
    return {};
  }

  const flat: Record<string, string> = {};
  for (let i = 0; i < entries.length; i++) {
    const n = i + 1;
    for (const [subKey, subVal] of Object.entries(entries[i])) {
      flat[`${prefix}_${group}_${subKey}_${n}`] = String(subVal ?? '');
    }
  }
  return flat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registre des services disponibles
// Clé = service_id (doit correspondre à la valeur en base dans field_services)
// ─────────────────────────────────────────────────────────────────────────────

export const REGISTERED_SERVICES: Record<string, FieldServiceHandler> = {
  sommaire_generator:    generateSommaireContent,
  geocoding_maps_link:   generateMapsLink,
  inspiration_poi_cards: generateInspirationPoiCards,
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
