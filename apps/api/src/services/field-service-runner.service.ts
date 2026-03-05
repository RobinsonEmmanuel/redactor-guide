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
// Chaque entrée contient : image, nom, hashtag, url_article, url_maps.
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

interface PoiImageEntry {
  url: string;
  is_iconic_view: boolean;
  editorial_relevance: string;
  visual_clarity_score: number;
  summary: string;
}

/**
 * Charge toutes les images taguées pour un POI depuis image_analyses,
 * triées par pertinence (iconic > forte relevance > clarity).
 */
async function loadPoiImages(db: Db, poiName: string): Promise<PoiImageEntry[]> {
  const docs = await db
    .collection('image_analyses')
    .find({ poi_names: poiName })
    .project({
      url: 1,
      'analysis.is_iconic_view': 1,
      'analysis.editorial_relevance': 1,
      'analysis.visual_clarity_score': 1,
      'analysis.analysis_summary': 1,
    })
    .toArray();

  return docs
    .map((d: any) => ({
      url:                  String(d.url ?? ''),
      is_iconic_view:       d.analysis?.is_iconic_view === true,
      editorial_relevance:  d.analysis?.editorial_relevance ?? 'faible',
      visual_clarity_score: d.analysis?.visual_clarity_score ?? 0,
      summary:              d.analysis?.analysis_summary ?? '',
    }))
    .sort((a, b) => {
      const score = (x: PoiImageEntry) =>
        (x.is_iconic_view ? 4 : 0) +
        (x.editorial_relevance === 'forte' ? 2 : x.editorial_relevance === 'moyenne' ? 1 : 0) +
        (x.visual_clarity_score / 10);
      return score(b) - score(a);
    });
}

/**
 * Formate la liste des images POI en texte lisible pour un prompt IA.
 * Format identique à IMAGES_DESTINATION pour cohérence.
 */
function formatPoiImagesForPrompt(images: PoiImageEntry[]): string {
  if (images.length === 0) return '(aucune image disponible pour ce POI)';
  return images
    .map((img, i) =>
      `[${i + 1}] ${img.url}\n` +
      `    Iconique: ${img.is_iconic_view ? 'oui' : 'non'} | ` +
      `Pertinence: ${img.editorial_relevance} | ` +
      `Clarté: ${img.visual_clarity_score}/10` +
      (img.summary ? `\n    ${img.summary}` : '')
    )
    .join('\n');
}

/**
 * Mode de remplissage résolu depuis un sous-champ de fieldDef.
 *   'ai'      → ai_instructions (ou fallback si absent)
 *   'default' → default_value fixe
 *   'skip'    → skip_ai=true, valeur gérée par le service lui-même
 */
type SubFieldMode = 'ai' | 'default' | 'skip';

interface SubFieldResolved {
  mode: SubFieldMode;
  /** Instructions IA substituées (mode 'ai' uniquement) */
  instructions?: string;
  /** Valeur fixe (mode 'default' uniquement) */
  defaultValue?: string;
}

/**
 * Résout le mode + la valeur d'un sous-champ depuis fieldDef.sub_fields.
 * Applique la substitution {{VARIABLE}} sur ai_instructions et default_value.
 *
 * Priorité : skip_ai=true → 'skip' | default_value défini → 'default' | sinon → 'ai'
 *
 * Variables disponibles dans les textes du sous-champ :
 *   {{POI_NOM}}              — nom brut du POI courant
 *   {{POI_URL_ARTICLE}}      — URL de l'article source du POI (WordPress)
 *   {{ANGLE_EDITORIAL}}      — angle éditorial de l'inspiration
 *   {{DESTINATION}}          — destination du guide (ex: "Tenerife")
 *   {{INSPIRATION_TITRE}}    — titre/thème de la page inspiration
 *   {{INSPIRATION_NB_LIEUX}} — nombre total de POIs
 *   {{INSPIRATION_LIEUX}}    — liste des POIs séparés par virgule
 *   {{IMAGES_POI}}           — liste des images disponibles pour ce POI (sous-champ image uniquement)
 */
function resolveSubField(
  fieldDef: Record<string, any> | undefined,
  subFieldName: string,
  fallbackInstructions: string,
  vars: Record<string, string> = {}
): SubFieldResolved {
  const sf = (fieldDef?.sub_fields ?? []).find((s: any) => s.name === subFieldName);

  const sub = (str: string) =>
    str.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? `{{${k}}}`);

  if (sf?.skip_ai) {
    return { mode: 'skip' };
  }
  if (sf?.default_value !== undefined && sf.default_value !== null) {
    return { mode: 'default', defaultValue: sub(String(sf.default_value)) };
  }
  const raw = sf?.ai_instructions?.trim() || fallbackInstructions;
  return { mode: 'ai', instructions: sub(raw) };
}


/**
 * Service inspiration_poi_cards
 *
 * Pour chaque POI de page.metadata.inspiration_pois, génère une entrée :
 *   { image, nom, hashtag, url_article, url_maps }
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

  // Lire les cartes déjà sauvegardées manuellement (images choisies par l'utilisateur)
  // pour les préserver lors d'une régénération export, sans les écraser.
  const fieldName: string = fieldDef?.name ?? '';
  let savedCards: Array<Record<string, string>> = [];
  try {
    const rawSaved = currentPage.content?.[fieldName];
    savedCards = Array.isArray(rawSaved)
      ? rawSaved
      : typeof rawSaved === 'string'
        ? JSON.parse(rawSaved)
        : [];
  } catch { savedCards = []; }

  const cards: Array<Record<string, string>> = [];

  for (let i = 0; i < inspirationPois.length; i++) {
    const poi = inspirationPois[i];
    console.log(`[inspiration_poi_cards] POI ${i + 1}/${inspirationPois.length} : "${poi.nom}"`);

    // Image manuellement choisie par l'utilisateur pour cette entrée (priorité absolue)
    const savedImage: string | undefined = savedCards[i]?.image;
    const hasManualImage = typeof savedImage === 'string' && savedImage.startsWith('http');

    // Charger les images disponibles pour ce POI (une seule requête DB, réutilisée)
    // Saut possible si l'image manuelle est déjà définie et que le mode n'est pas IA
    const poiImages = hasManualImage ? [] : await loadPoiImages(db, poi.nom);
    const imagesPoiText = formatPoiImagesForPrompt(poiImages);

    // Variables spécifiques à ce POI (enrichissent pageVars)
    const poiVars: Record<string, string> = {
      ...pageVars,
      POI_NOM:         poi.nom,
      POI_URL_ARTICLE: poi.url_source ?? '',
      IMAGES_POI:      imagesPoiText,
    };

    // ── image ─────────────────────────────────────────────────────────────────
    // Priorité : image manuelle sauvegardée > mode service > IA > auto (meilleure rankée)
    let imageUrl: string | null = hasManualImage
      ? savedImage!
      : poiImages[0]?.url ?? null;

    if (!hasManualImage) {
      const imgResolved = resolveSubField(
        fieldDef, 'image',
        '',   // pas de fallback : sélection auto si pas d'instructions IA
        poiVars
      );

      if (imgResolved.mode === 'default') {
        imageUrl = imgResolved.defaultValue || null;
      } else if (imgResolved.mode === 'ai' && imgResolved.instructions) {
        // Charger les images si besoin (non chargées ci-dessus car hasManualImage=false mais poiImages peut être vide)
        const imgs = poiImages.length > 0 ? poiImages : await loadPoiImages(db, poi.nom);
        if (imgs.length > 0) {
          try {
            const prompt =
              `${imgResolved.instructions}\n\n` +
              `Images disponibles pour "${poi.nom}" :\n${formatPoiImagesForPrompt(imgs)}\n\n` +
              `Réponds UNIQUEMENT avec l'URL complète de l'image choisie (https://…), sans aucun texte autour.`;
            const aiUrl = (await miniAI(prompt)).trim();
            if (aiUrl.startsWith('http')) imageUrl = aiUrl;
          } catch { /* fallback : meilleure image rankée */ }
        }
      }
    }
    // mode 'skip' ou image manuelle → imageUrl est déjà défini

    // ── nom ───────────────────────────────────────────────────────────────────
    const nomResolved = resolveSubField(
      fieldDef, 'nom',
      `Réécris ce nom de lieu pour une carte de guide touristique. Angle éditorial : "{{ANGLE_EDITORIAL}}". Réponds uniquement avec le nom court (sans ponctuation finale, sans guillemets).`,
      poiVars
    );
    let nom = poi.nom;
    if (nomResolved.mode === 'default') {
      nom = nomResolved.defaultValue ?? poi.nom;
    } else if (nomResolved.mode === 'ai' && nomResolved.instructions) {
      try {
        const aiNom = await miniAI(`${nomResolved.instructions}\nLieu : "${poi.nom}"`);
        if (aiNom) nom = aiNom;
      } catch { /* fallback : nom brut */ }
    }
    // mode 'skip' → nom brut conservé

    // ── hashtag ───────────────────────────────────────────────────────────────
    const hashResolved = resolveSubField(
      fieldDef, 'hashtag',
      `Génère un seul hashtag (avec #) court, sans espace, en français ou langue locale. Angle éditorial : "{{ANGLE_EDITORIAL}}". Réponds uniquement avec le hashtag.`,
      poiVars
    );
    let hashtag = '';
    if (hashResolved.mode === 'default') {
      hashtag = hashResolved.defaultValue ?? '';
    } else if (hashResolved.mode === 'ai' && hashResolved.instructions) {
      try { hashtag = await miniAI(`${hashResolved.instructions}\nLieu : "${poi.nom}"`); } catch { hashtag = ''; }
    }
    // mode 'skip' → hashtag vide (géré ailleurs)

    // ── url_article (URL brute de l'article source) ───────────────────────────
    // Mode auto/ai → poi.url_source | default → valeur fixe | manual (skip_ai) → vide
    const urlArtResolved = resolveSubField(fieldDef, 'url_article', '', poiVars);
    const urlArticle = urlArtResolved.mode === 'skip'    ? ''
      : urlArtResolved.mode === 'default' ? (urlArtResolved.defaultValue ?? poi.url_source ?? '')
      : (poi.url_source ?? '');

    // ── url_maps (URL brute Google Maps pour picto carte InDesign) ───────────
    let urlMaps = '';
    const urlMapsResolved = resolveSubField(fieldDef, 'url_maps', '', poiVars);
    if (urlMapsResolved.mode !== 'skip') {
      try {
        const enrichedQuery = destination ? `${poi.nom}, ${destination}` : poi.nom;
        const geo = await _geocodingService.resolve(enrichedQuery, country);
        if (geo) {
          urlMaps = geo.urls.google_maps;
        }
      } catch { urlMaps = ''; }
    }

    cards.push({
      card:         '1',         // sentinelle : '1' = groupe visible, '' = groupe masqué
      image:        imageUrl ?? '',
      nom,
      hashtag,
      // Champ fusionné pour InDesign : un seul cadre texte avec style paragraphe sur le hashtag
      nom_hashtag:  hashtag ? `${nom}\r${hashtag}` : nom,
      url_article:  urlArticle,  // URL brute → picto lien InDesign
      url_maps:     urlMaps,     // URL brute → picto carte InDesign
    });

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
  value: string,
  maxRepetitions?: number
): Record<string, string> {
  const SEP = '_repetitif_';
  const sepIdx = fieldName.indexOf(SEP);
  if (sepIdx === -1) return {};

  const prefix = fieldName.substring(0, sepIdx);           // "INSPIRATION"
  const group  = fieldName.substring(sepIdx + SEP.length); // "1"

  let entries: Array<Record<string, string>>;
  try {
    entries = JSON.parse(value);
    if (!Array.isArray(entries)) return {};
  } catch {
    return {};
  }

  // Noms des sous-champs déduits du premier item (pour générer les slots vides)
  const subKeys = entries.length > 0 ? Object.keys(entries[0]) : [];
  // Nombre total de slots à produire : au moins le nombre d'entrées réelles,
  // au plus max_repetitions si fourni (pour masquer les cadres vides dans InDesign)
  const totalSlots = Math.max(entries.length, maxRepetitions ?? 0);

  const flat: Record<string, string> = {};
  for (let i = 0; i < totalSlots; i++) {
    const n = i + 1;
    if (i < entries.length) {
      // Slot avec données
      for (const [subKey, subVal] of Object.entries(entries[i])) {
        flat[`${prefix}_${group}_${subKey}_${n}`] = String(subVal ?? '');
      }
    } else {
      // Slot vide → chaîne vide pour que le script InDesign masque le cadre
      for (const subKey of subKeys) {
        flat[`${prefix}_${group}_${subKey}_${n}`] = '';
      }
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
