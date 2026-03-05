// v2.2.0 — field services (2ème passe) + variant_layer résolu depuis field.option_layers
import { Db, ObjectId } from 'mongodb';
import {
  FIELD_LAYER_MAPPINGS,
  PICTO_LAYER_MAPPINGS,
  PICTO_VALUE_MAPPINGS,
  isPictoField,
  resolvePictoMapping,
  resolveFieldLayer,
  resolveVariantLayerFromMappings,
} from '../config/export-mappings.js';
import {
  FieldServiceRunner,
  explodeRepetitifField,
  type ExportedPageSnapshot,
} from './field-service-runner.service.js';

const EXPORTED_STATUSES = ['generee_ia', 'relue', 'validee', 'texte_coule', 'visuels_montes'];

export interface ExportOptions {
  language?: string;
}

export class ExportService {
  async buildGuideExport(guideId: string, db: Db, options: ExportOptions = {}) {
    const lang = options.language || 'fr';

    // ── 1. Récupérer le guide ──────────────────────────────────────────────
    const guide = await db.collection('guides').findOne({ _id: new ObjectId(guideId) });
    if (!guide) throw new Error('Guide non trouvé');

    // ── 2. Récupérer le chemin de fer ──────────────────────────────────────
    const cheminDeFer = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
    if (!cheminDeFer) throw new Error('Chemin de fer non trouvé');

    // ── 3. Récupérer toutes les pages avec leur contenu ────────────────────
    const allPages = await db
      .collection('pages')
      .find({ chemin_de_fer_id: cheminDeFer._id.toString() })
      .sort({ ordre: 1 })
      .toArray();

    const exportablePages = allPages.filter(p => EXPORTED_STATUSES.includes(p.statut_editorial));
    const draftPages      = allPages.filter(p => !EXPORTED_STATUSES.includes(p.statut_editorial));

    // ── 4. Récupérer tous les templates utilisés ───────────────────────────
    const templateIds = [...new Set(exportablePages.map(p => p.template_id).filter(Boolean))];
    const templates: Record<string, any> = {};
    for (const tid of templateIds) {
      if (ObjectId.isValid(tid)) {
        const tpl = await db.collection('templates').findOne({ _id: new ObjectId(tid) });
        if (tpl) templates[tid] = tpl;
      }
    }

    // ── 4b. Construire le resolver d'URLs par langue ───────────────────────
    // Pour lang !== 'fr' : remplace les URLs françaises par la version cible.
    // Source : articles_raw.urls_by_lang.{lang} ; fallback sur l'URL française.
    let urlResolver: (frUrl: string) => string = (u) => u; // identité pour FR
    if (lang !== 'fr') {
      const articles = await db
        .collection('articles_raw')
        .find(
          { [`urls_by_lang.${lang}`]: { $exists: true } },
          { projection: { 'urls_by_lang': 1 } }
        )
        .toArray();

      const urlMap = new Map<string, string>();
      for (const art of articles) {
        const frUrl  = art.urls_by_lang?.fr;
        const tgtUrl = art.urls_by_lang?.[lang];
        if (frUrl && tgtUrl) urlMap.set(frUrl, tgtUrl);
      }
      console.log(`🌐 [EXPORT][${lang}] URL resolver : ${urlMap.size} article(s) avec URL en ${lang}`);
      urlResolver = (frUrl: string) => urlMap.get(frUrl) ?? frUrl;
    }

    // ── 5. Construire les pages exportées — passe 1 ────────────────────────
    // Les champs avec service_id sont intentionnellement ignorés ici ;
    // ils seront calculés en passe 2, une fois toutes les pages connues.
    const pages: ExportedPageSnapshot[] = exportablePages.map((page, idx) => {
      const template = templates[page.template_id];
      const content  = page.content || {};
      const fields   = (template?.fields || []) as any[];

      const textFields:  Record<string, string>  = {};
      const imageFields: Record<string, { url: string; indesign_layer: string; local_filename: string; local_path: string }> = {};
      const pictoFields: Record<string, {
        value: string;
        picto_key: string | null;
        indesign_layer: string;
        variant_layer: string | null;
        label: string;
      }> = {};

      for (const field of fields) {
        // Les champs calculés par un service sont ignorés en passe 1
        if (field.service_id) continue;

        const value = content[field.name];
        if (value === undefined || value === null || value === '') continue;

        if (isPictoField(field.name)) {
          const strValue  = String(value);
          const mapping   = resolvePictoMapping(field.name, strValue);
          // variant_layer : source de vérité = field.option_layers (défini dans le template)
          // Fallback : PICTO_VARIANT_TABLE (rétrocompat templates sans option_layers)
          const variantLayer: string | null =
            field.option_layers?.[strValue] ??
            resolveVariantLayerFromMappings(field.name, strValue);
          pictoFields[field.name] = {
            value: strValue,
            picto_key: mapping.picto_key,
            indesign_layer: resolveFieldLayer(field.name, field.indesign_layer),
            variant_layer: variantLayer,
            label: mapping.label,
          };
        } else if (field.type === 'image') {
          const pageNum   = String(page.ordre || idx + 1).padStart(3, '0');
          const tplSlug   = (page.template_name || 'page').toLowerCase();
          const fieldSlug = field.name.toLowerCase();
          imageFields[field.name] = {
            url: String(value),
            indesign_layer: resolveFieldLayer(field.name, field.indesign_layer),
            local_filename: `p${pageNum}_${tplSlug}_${fieldSlug}.jpg`,
            local_path: `images/${tplSlug}/`,
          };
        } else {
          // Champ lien structuré {label, url} — conserver la représentation JSON
          // pour que le normaliseur et le script InDesign puissent l'interpréter.
          if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            ('url' in (value as object) || 'label' in (value as object))
          ) {
            textFields[field.name] = JSON.stringify(value);
          } else {
            textFields[field.name] = String(value);
          }
        }
      }

        // ── Overlay traduction : remplace les champs texte si une traduction existe ──
      if (lang !== 'fr') {
        const translatedText: Record<string, string> = page.content_translations?.[lang]?.text || {};
        for (const [k, v] of Object.entries(translatedText)) {
          if (!(k in textFields) || typeof v !== 'string' || !v.trim()) continue;

          const originalVal = textFields[k];
          // Si l'original est un JSON lien {label, url} et que la traduction
          // est un label seul (pas un JSON), on reconstruit le JSON avec le label traduit.
          // L'URL sera ensuite résolue par le step de résolution d'URLs ci-dessous.
          if (originalVal.startsWith('{') && !v.startsWith('{')) {
            try {
              const originalParsed = JSON.parse(originalVal);
              if (originalParsed && 'url' in originalParsed) {
                textFields[k] = JSON.stringify({ ...originalParsed, label: v });
                continue;
              }
            } catch { /* JSON invalide → fallback */ }
          }

          textFields[k] = v;
        }

      }

      // url_source : résolu en passe 3 (stocké séparément ici pour le return)
      const resolvedUrlSource = page.url_source || null;

      return {
        id: page._id.toString(),
        page_number: page.ordre,
        template: page.template_name || template?.name || 'UNKNOWN',
        section: page.section_id || null,
        titre: page.titre,
        status: page.statut_editorial,
        url_source: resolvedUrlSource,
        entity_meta: {
          page_type:          page.metadata?.page_type          ?? null,
          cluster_id:         page.metadata?.cluster_id         ?? null,
          cluster_name:       page.metadata?.cluster_name       ?? null,
          poi_id:             page.metadata?.poi_id             ?? null,
          poi_name:           page.metadata?.poi_name           ?? null,
          inspiration_id:     page.metadata?.inspiration_id     ?? null,
          inspiration_title:  page.metadata?.inspiration_title  ?? null,
          season:             page.metadata?.saison             ?? null,
        },
        content: {
          text:   textFields,
          images: imageFields,
          pictos: pictoFields,
        },
      } as ExportedPageSnapshot;
    });

    // ── 5b. Passe 2 : calculer les champs service ──────────────────────────
    // On a maintenant la liste complète des pages construites → on peut
    // appeler chaque service avec le contexte global.
    const runner = new FieldServiceRunner();

    for (let i = 0; i < exportablePages.length; i++) {
      const rawPage  = exportablePages[i];
      const template = templates[rawPage.template_id];
      const fields   = (template?.fields || []) as any[];

      const serviceFields = fields.filter((f: any) => !!f.service_id);
      if (serviceFields.length === 0) continue;

      for (const field of serviceFields) {
        try {
          const result = await runner.run(field.service_id, {
            guideId,
            guide,
            currentPage:      rawPage,
            allExportedPages: pages,
            db,
            fieldDef:         field,
          });
          // Injecter la valeur calculée dans le champ texte de la page
          pages[i].content.text[field.name] = result.value;

          // Si le champ est de type repetitif, exploser le tableau JSON en champs plats
          // pour que le script InDesign trouve des calques nommés individuellement.
          // Les sous-champs _image_N sont routés vers content.images (format { url, local })
          // car le script InDesign injecte les images depuis content.images uniquement.
          if (field.type === 'repetitif' && result.value) {
            const flat = explodeRepetitifField(field.name, result.value, field.max_repetitions);
            for (const [k, v] of Object.entries(flat)) {
              if (k.includes('_image_') && typeof v === 'string' && v.startsWith('http')) {
                pages[i].content.images[k] = {
                  url: v,
                  indesign_layer: k,
                  local_filename: `${k.toLowerCase()}.jpg`,
                  local_path: 'images/inspiration/',
                };
              } else {
                pages[i].content.text[k] = v;
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ExportService] Service "${field.service_id}" error on page ${rawPage._id}: ${msg}`);
          pages[i].content.text[field.name] = '';
        }
      }
    }

    // ── 5c. Passe 3 : résolution des URLs vers la langue cible ────────────────
    // Appliquée APRÈS la passe 2 car les champs url_article / url_maps des blocs
    // répétitifs (INSPIRATION, ALLER_PLUS_LOIN…) sont injectés par le FieldServiceRunner.
    // Couvre : URLs brutes, JSON lien {label,url}, url_source de la page.
    if (lang !== 'fr') {
      let resolvedCount = 0;
      let fallbackCount = 0;

      for (const page of pages) {
        for (const k of Object.keys(page.content.text)) {
          const v = page.content.text[k];
          if (!v || typeof v !== 'string') continue;

          if (/^https?:\/\//i.test(v)) {
            const resolved = urlResolver(v);
            if (resolved !== v) resolvedCount++;
            else fallbackCount++;
            page.content.text[k] = resolved;
          } else if (v.startsWith('{')) {
            try {
              const parsed = JSON.parse(v);
              if (parsed && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
                const resolved = urlResolver(parsed.url);
                if (resolved !== parsed.url) resolvedCount++;
                else fallbackCount++;
                parsed.url = resolved;
                page.content.text[k] = JSON.stringify(parsed);
              }
            } catch { /* JSON invalide → laisser tel quel */ }
          }
        }
      }

      // Résolution de url_source sur chaque page
      for (const page of pages) {
        if (page.url_source && /^https?:\/\//i.test(page.url_source)) {
          const resolved = urlResolver(page.url_source);
          if (resolved !== page.url_source) resolvedCount++;
          else fallbackCount++;
          (page as any).url_source = resolved;
        }
      }

      console.log(`🌐 [EXPORT][${lang}] URLs résolues : ${resolvedCount} ✅  |  fallback FR : ${fallbackCount} ⚠️`);
    }

    // ── 6. Construire le mapping field→calque depuis les templates réels ──────
    // Priorité : field.indesign_layer > FIELD_LAYER_MAPPINGS > PICTO_LAYER_MAPPINGS > deriveLayerName()
    const dynamicFieldLayers: Record<string, string> = {};
    const bulletListFields: string[] = [];

    for (const tpl of Object.values(templates)) {
      for (const field of (tpl.fields ?? [])) {
        dynamicFieldLayers[field.name] = resolveFieldLayer(field.name, field.indesign_layer);
        if (field.type === 'liste') {
          bulletListFields.push(field.name);
        }
      }
    }
    // Compléter avec les champs du mapping statique non couverts (rétrocompat)
    for (const [k, v] of Object.entries(FIELD_LAYER_MAPPINGS)) {
      if (!dynamicFieldLayers[k]) dynamicFieldLayers[k] = v;
    }

    // ── 7. Construire le JSON final ────────────────────────────────────────
    return {
      meta: {
        guide_id:     guideId,
        guide_name:   guide.name,
        destination:  guide.destinations?.[0] ?? guide.destination ?? '',
        year:         guide.year,
        language:     lang,
        version:      guide.version || '1.0.0',
        exported_at:  new Date().toISOString(),
        api_build:    'v2.2.0-field_services',
        stats: {
          total_pages:     allPages.length,
          exported:        exportablePages.length,
          excluded_draft:  draftPages.length,
          excluded_statuses: [...new Set(draftPages.map(p => p.statut_editorial))],
        },
      },

      mappings: {
        // Mapping dynamique construit depuis les templates réels — toujours à jour
        fields: dynamicFieldLayers,
        // Noms de tous les champs de type 'liste' — le script InDesign les traite en puces
        bullet_fields: bulletListFields,
        picto_layers: PICTO_LAYER_MAPPINGS,
        picto_values: Object.fromEntries(
          Object.entries(PICTO_VALUE_MAPPINGS).map(([k, v]) => [k, v])
        ),
      },

      pages,
    };
  }
}
