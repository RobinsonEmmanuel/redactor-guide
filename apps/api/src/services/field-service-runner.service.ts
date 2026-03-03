import { Db } from 'mongodb';
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

  const destination = guide.destination || guide.name || '';
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
