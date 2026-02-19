import { Db, ObjectId } from 'mongodb';
import {
  FIELD_LAYER_MAPPINGS,
  PICTO_LAYER_MAPPINGS,
  PICTO_VALUE_MAPPINGS,
  isPictoField,
  resolvePictoMapping,
  resolveLayerName,
} from '../config/export-mappings.js';

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

    // ── 5. Construire les pages exportées ──────────────────────────────────
    const pages = exportablePages.map((page, idx) => {
      const template = templates[page.template_id];
      const content  = page.content || {};
      const fields   = template?.fields || [];

      const textFields:  Record<string, string>  = {};
      const imageFields: Record<string, { url: string; local_filename: string; local_path: string }> = {};
      const pictoFields: Record<string, { value: string; picto_key: string | null; indesign_layer: string; label: string }> = {};

      for (const field of fields) {
        const value = content[field.name];
        if (value === undefined || value === null || value === '') continue;

        if (isPictoField(field.name)) {
          const mapping = resolvePictoMapping(field.name, String(value));
          pictoFields[field.name] = {
            value: String(value),
            picto_key: mapping.picto_key,
            indesign_layer: PICTO_LAYER_MAPPINGS[field.name] ?? field.name.toLowerCase(),
            label: mapping.label,
          };
        } else if (field.type === 'image') {
          const pageNum   = String(page.ordre || idx + 1).padStart(3, '0');
          const tplSlug   = (page.template_name || 'page').toLowerCase();
          const fieldSlug = field.name.toLowerCase().replace(/_/g, '_');
          imageFields[field.name] = {
            url: String(value),
            local_filename: `p${pageNum}_${tplSlug}_${fieldSlug}.jpg`,
            local_path: `images/${tplSlug}/`,
          };
        } else {
          textFields[field.name] = String(value);
        }
      }

      return {
        id: page._id.toString(),
        page_number: page.ordre,
        template: page.template_name || template?.name || 'UNKNOWN',
        section: page.section_id || null,
        titre: page.titre,
        status: page.statut_editorial,
        url_source: page.url_source || null,
        content: {
          text:   textFields,
          images: imageFields,
          pictos: pictoFields,
        },
      };
    });

    // ── 6. Construire le JSON final ────────────────────────────────────────
    return {
      meta: {
        guide_id:     guideId,
        guide_name:   guide.name,
        destination:  guide.destination ?? guide.destinations?.[0] ?? '',
        year:         guide.year,
        language:     lang,
        version:      guide.version || '1.0.0',
        exported_at:  new Date().toISOString(),
        stats: {
          total_pages:     allPages.length,
          exported:        exportablePages.length,
          excluded_draft:  draftPages.length,
          excluded_statuses: [...new Set(draftPages.map(p => p.statut_editorial))],
        },
      },

      mappings: {
        fields: FIELD_LAYER_MAPPINGS,
        picto_layers: PICTO_LAYER_MAPPINGS,
        picto_values: Object.fromEntries(
          Object.entries(PICTO_VALUE_MAPPINGS).map(([k, v]) => [k, v])
        ),
      },

      pages,
    };
  }
}
