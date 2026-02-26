/**
 * Mapping des champs de template vers les noms de calques InDesign
 * et mapping des valeurs de picto vers les clés picto abstraites.
 *
 * Ces mappings sont inclus dans le JSON exporté afin que le script InDesign
 * puisse retrouver les calques/frames par leur nom sans connaître les conventions
 * internes du redactor-guide.
 */

// ─── Field → InDesign layer mapping ─────────────────────────────────────────
//
// Ce tableau est désormais vide : le nom du calque InDesign est identique au
// nom du champ de template (ex: POI_titre_1 → frame nommée "POI_titre_1").
// Utilise `indesign_layer` sur un champ de template uniquement pour un cas
// exceptionnel (gabarit InDesign hérité avec des noms non conformes).

export const FIELD_LAYER_MAPPINGS: Record<string, string> = {};

// ─── Picto layer mapping ─────────────────────────────────────────────────────

/**
 * Mapping des champs picto vers le calque InDesign de base.
 * Vide : le calque InDesign est identique au nom du champ (ex: POI_picto_interet).
 * Nomme tes frames picto InDesign exactement comme tes champs de template.
 */
export const PICTO_LAYER_MAPPINGS: Record<string, string> = {};

// ─── Picto value → abstract key mapping ─────────────────────────────────────

export interface PictoMapping {
  /** Clé abstraite à utiliser côté InDesign (null = picto non affiché) */
  picto_key: string | null;
  /** Label lisible pour debug/contrôle */
  label: string;
}

/**
 * Mapping composite : "nomDuChampPicto:valeur" → clé InDesign abstraite
 * Les valeurs "non" ou "0" pour les booléens retournent picto_key: null
 * (le script InDesign masque le calque).
 */
export const PICTO_VALUE_MAPPINGS: Record<string, PictoMapping> = {
  // ── Intérêt (noms sémantiques ET numérotés) ──────────────────────────────
  'POI_picto_interet:incontournable': { picto_key: 'PICTO_SMILEY_INCONTOURNABLE', label: 'Incontournable' },
  'POI_picto_interet:interessant':    { picto_key: 'PICTO_SMILEY_INTERESSANT',    label: 'Intéressant'    },
  'POI_picto_interet:a_voir':         { picto_key: 'PICTO_SMILEY_A_VOIR',         label: 'À voir'         },
  'POI_picto_1:incontournable':       { picto_key: 'PICTO_SMILEY_INCONTOURNABLE', label: 'Incontournable' },
  'POI_picto_1:interessant':          { picto_key: 'PICTO_SMILEY_INTERESSANT',    label: 'Intéressant'    },
  'POI_picto_1:a_voir':               { picto_key: 'PICTO_SMILEY_A_VOIR',         label: 'À voir'         },

  // ── PMR ─────────────────────────────────────────────────────────────────
  'POI_picto_pmr:100': { picto_key: 'PICTO_PMR_FULL', label: 'Accessible 100%'        },
  'POI_picto_pmr:50':  { picto_key: 'PICTO_PMR_HALF', label: 'Partiellement accessible'},
  'POI_picto_pmr:0':   { picto_key: 'PICTO_PMR_NONE', label: 'Non accessible'          },
  'POI_picto_2:100':   { picto_key: 'PICTO_PMR_FULL', label: 'Accessible 100%'        },
  'POI_picto_2:50':    { picto_key: 'PICTO_PMR_HALF', label: 'Partiellement accessible'},
  'POI_picto_2:0':     { picto_key: 'PICTO_PMR_NONE', label: 'Non accessible'          },

  // ── Escaliers ───────────────────────────────────────────────────────────
  'POI_picto_escaliers:oui': { picto_key: 'PICTO_ESCALIERS', label: 'Escaliers' },
  'POI_picto_escaliers:non': { picto_key: null,               label: ''          },
  'POI_picto_3:oui':         { picto_key: 'PICTO_ESCALIERS', label: 'Escaliers' },
  'POI_picto_3:non':         { picto_key: null,               label: ''          },

  // ── Toilettes ───────────────────────────────────────────────────────────
  'POI_picto_toilettes:oui': { picto_key: 'PICTO_TOILETTES', label: 'Toilettes disponibles' },
  'POI_picto_toilettes:non': { picto_key: null,               label: ''                      },
  'POI_picto_4:oui':         { picto_key: 'PICTO_TOILETTES', label: 'Toilettes disponibles' },
  'POI_picto_4:non':         { picto_key: null,               label: ''                      },

  // ── Restauration ────────────────────────────────────────────────────────
  'POI_picto_restauration:oui': { picto_key: 'PICTO_RESTAURATION', label: 'Restauration sur place' },
  'POI_picto_restauration:non': { picto_key: null,                  label: ''                       },
  'POI_picto_5:oui':            { picto_key: 'PICTO_RESTAURATION', label: 'Restauration sur place' },
  'POI_picto_5:non':            { picto_key: null,                  label: ''                       },

  // ── Famille ─────────────────────────────────────────────────────────────
  'POI_picto_famille:oui': { picto_key: 'PICTO_FAMILLE', label: 'Activités enfants/familles' },
  'POI_picto_famille:non': { picto_key: null,             label: ''                           },
  'POI_picto_6:oui':       { picto_key: 'PICTO_FAMILLE', label: 'Activités enfants/familles' },
  'POI_picto_6:non':       { picto_key: null,             label: ''                           },
};

/** Retourne le mapping picto pour un champ et sa valeur */
export function resolvePictoMapping(fieldName: string, value: string): PictoMapping {
  const key = `${fieldName}:${value}`;
  return PICTO_VALUE_MAPPINGS[key] ?? { picto_key: null, label: value };
}

/**
 * Table de fallback : résout le variant_layer depuis le nom de champ + valeur.
 * Utilisé uniquement quand le template ne définit pas option_layers.
 * Les templates récents ont option_layers → cette table n'est plus le chemin principal.
 */
const VARIANT_LAYER_FALLBACK: Record<string, string | null> = {
  'POI_picto_interet:incontournable': 'picto_interet_1',
  'POI_picto_interet:interessant':    'picto_interet_2',
  'POI_picto_interet:a_voir':         'picto_interet_3',
  'POI_picto_1:incontournable':       'picto_interet_1',
  'POI_picto_1:interessant':          'picto_interet_2',
  'POI_picto_1:a_voir':               'picto_interet_3',
  'POI_picto_pmr:100': 'picto_pmr_full',
  'POI_picto_pmr:50':  'picto_pmr_half',
  'POI_picto_pmr:0':   'picto_pmr_none',
  'POI_picto_2:100':   'picto_pmr_full',
  'POI_picto_2:50':    'picto_pmr_half',
  'POI_picto_2:0':     'picto_pmr_none',
  'POI_picto_escaliers:oui':    'picto_escaliers',
  'POI_picto_escaliers:non':    null,
  'POI_picto_3:oui':            'picto_escaliers',
  'POI_picto_3:non':            null,
  'POI_picto_toilettes:oui':    'picto_toilettes',
  'POI_picto_toilettes:non':    null,
  'POI_picto_4:oui':            'picto_toilettes',
  'POI_picto_4:non':            null,
  'POI_picto_restauration:oui': 'picto_restauration',
  'POI_picto_restauration:non': null,
  'POI_picto_5:oui':            'picto_restauration',
  'POI_picto_5:non':            null,
  'POI_picto_famille:oui':      'picto_famille',
  'POI_picto_famille:non':      null,
  'POI_picto_6:oui':            'picto_famille',
  'POI_picto_6:non':            null,
};

/** Résout variant_layer depuis le mapping de fallback (quand option_layers absent du template) */
export function resolveVariantLayerFromMappings(fieldName: string, value: string): string | null {
  const key = `${fieldName}:${value}`;
  return VARIANT_LAYER_FALLBACK[key] ?? null;
}

/** Retourne vrai si un champ est de type picto */
export function isPictoField(fieldName: string): boolean {
  return fieldName.includes('_picto_');
}

/**
 * Retourne le nom du calque InDesign pour un champ donné.
 *
 * Convention : le nom du calque InDesign est identique au nom du champ de template.
 *   POI_titre_1        → POI_titre_1
 *   COUVERTURE_image_1 → COUVERTURE_image_1
 *
 * Nomme donc tes frames InDesign exactement comme tes champs de template.
 * Utilisé en fallback quand `field.indesign_layer` n'est pas renseigné.
 */
export function deriveLayerName(fieldName: string): string {
  return fieldName;
}

/**
 * Résout le nom du calque InDesign pour un champ donné.
 * Priorité : field.indesign_layer > FIELD_LAYER_MAPPINGS > PICTO_LAYER_MAPPINGS > deriveLayerName()
 *
 * À utiliser dans export.service.ts plutôt que resolveLayerName() hardcodée.
 */
export function resolveFieldLayer(fieldName: string, explicitLayer?: string): string {
  return (
    explicitLayer ??
    FIELD_LAYER_MAPPINGS[fieldName] ??
    PICTO_LAYER_MAPPINGS[fieldName] ??
    deriveLayerName(fieldName)
  );
}

/** @deprecated Utiliser resolveFieldLayer() à la place */
export function resolveLayerName(fieldName: string): string {
  return resolveFieldLayer(fieldName);
}
