/**
 * Mapping des champs de template vers les noms de calques InDesign
 * et mapping des valeurs de picto vers les clés picto abstraites.
 *
 * Ces mappings sont inclus dans le JSON exporté afin que le script InDesign
 * puisse retrouver les calques/frames par leur nom sans connaître les conventions
 * internes du redactor-guide.
 */

// ─── Field → InDesign layer mapping ─────────────────────────────────────────

export const FIELD_LAYER_MAPPINGS: Record<string, string> = {
  // COUVERTURE
  COUVERTURE_titre_destination:      'txt_couverture_destination',
  COUVERTURE_titre_annee:            'txt_couverture_annee',
  COUVERTURE_image_hero:             'img_couverture_hero',
  COUVERTURE_texte_baseline:         'txt_couverture_baseline',

  // PRESENTATION_GUIDE
  PRESENTATION_GUIDE_titre_principal:       'txt_presguide_titre',
  PRESENTATION_GUIDE_texte_intro:           'txt_presguide_intro',
  PRESENTATION_GUIDE_texte_comment_utiliser:'txt_presguide_utiliser',
  PRESENTATION_GUIDE_liste_sections:        'txt_presguide_sections',
  PRESENTATION_GUIDE_image_illustration:    'img_presguide_illustration',

  // PRESENTATION_DESTINATION
  PRESENTATION_DESTINATION_titre_destination: 'txt_presdest_titre',
  PRESENTATION_DESTINATION_texte_intro:       'txt_presdest_intro',
  PRESENTATION_DESTINATION_image_hero:        'img_presdest_hero',
  PRESENTATION_DESTINATION_texte_histoire:    'txt_presdest_histoire',
  PRESENTATION_DESTINATION_texte_geographie:  'txt_presdest_geographie',
  PRESENTATION_DESTINATION_liste_highlights:  'txt_presdest_highlights',
  PRESENTATION_DESTINATION_meta_population:   'txt_presdest_population',
  PRESENTATION_DESTINATION_meta_superficie:   'txt_presdest_superficie',

  // CARTE_DESTINATION
  CARTE_DESTINATION_titre_principal: 'txt_carte_titre',
  CARTE_DESTINATION_image_carte:     'img_carte_principale',
  CARTE_DESTINATION_texte_legende:   'txt_carte_legende',
  CARTE_DESTINATION_liste_zones:     'txt_carte_zones',

  // CLUSTER (intro de section)
  CLUSTER_titre_nom:              'txt_cluster_nom',
  CLUSTER_texte_description:      'txt_cluster_description',
  CLUSTER_image_principale:       'img_cluster_principale',
  CLUSTER_texte_ambiance:         'txt_cluster_ambiance',
  CLUSTER_liste_incontournables:  'txt_cluster_incontournables',
  CLUSTER_meta_duree_visite:      'txt_cluster_duree',
  CLUSTER_texte_conseil_acces:    'txt_cluster_acces',

  // POI
  POI_titre_1:   'txt_poi_nom',
  POI_texte_1:   'txt_poi_desc_principale',
  POI_texte_2:   'txt_poi_desc_secondaire',
  POI_image_1:   'img_poi_grand_rond',
  POI_image_2:   'img_poi_petit_rond',
  POI_image_3:   'img_poi_banniere',
  POI_meta_duree:'txt_poi_duree',
  // pictos POI → voir PICTO_LAYER_MAPPINGS

  // INSPIRATION
  INSPIRATION_titre_theme:              'txt_inspi_titre',
  INSPIRATION_texte_angle_editorial:    'txt_inspi_angle',
  INSPIRATION_image_hero:               'img_inspi_hero',
  INSPIRATION_liste_lieux_1_6:          'txt_inspi_lieux',
  INSPIRATION_liste_descriptions_1_6:   'txt_inspi_descriptions',
  INSPIRATION_liste_images_1_6:         'img_inspi_lieux',

  // SAISON
  SAISON_titre_nom:                    'txt_saison_nom',
  SAISON_titre_periode:                'txt_saison_periode',
  SAISON_texte_description:            'txt_saison_description',
  SAISON_image_ambiance:               'img_saison_ambiance',
  SAISON_meta_temperature:             'txt_saison_temperature',
  SAISON_meta_precipitation:           'txt_saison_precipitation',
  SAISON_liste_activites_recommandees: 'txt_saison_activites',
  SAISON_texte_conseil:                'txt_saison_conseil',

  // SECTION_INTRO
  SECTION_INTRO_titre_section:       'txt_section_titre',
  SECTION_INTRO_texte_chapeau:       'txt_section_chapeau',
  SECTION_INTRO_image_hero:          'img_section_hero',
  SECTION_INTRO_texte_presentation:  'txt_section_presentation',
  SECTION_INTRO_liste_highlights:    'txt_section_highlights',
  SECTION_INTRO_texte_conseil:       'txt_section_conseil',

  // ALLER_PLUS_LOIN
  ALLER_PLUS_LOIN_titre_principal:     'txt_apl_titre',
  ALLER_PLUS_LOIN_texte_intro:         'txt_apl_intro',
  ALLER_PLUS_LOIN_liste_ressources:    'txt_apl_ressources',
  ALLER_PLUS_LOIN_liste_sites_officiels:'txt_apl_sites',
  ALLER_PLUS_LOIN_texte_apps_mobiles:  'txt_apl_apps',

  // A_PROPOS_RL
  A_PROPOS_RL_titre_principal:    'txt_rl_titre',
  A_PROPOS_RL_texte_presentation: 'txt_rl_presentation',
  A_PROPOS_RL_image_logo:         'img_rl_logo',
  A_PROPOS_RL_texte_mission:      'txt_rl_mission',
  A_PROPOS_RL_liste_valeurs:      'txt_rl_valeurs',
  A_PROPOS_RL_lien_site:          'lnk_rl_site',
  A_PROPOS_RL_lien_contact:       'lnk_rl_contact',
};

// ─── Picto layer mapping ─────────────────────────────────────────────────────

/** Mapping des champs picto vers les calques InDesign */
export const PICTO_LAYER_MAPPINGS: Record<string, string> = {
  POI_picto_interet:     'picto_interet',
  POI_picto_pmr:         'picto_pmr',
  POI_picto_escaliers:   'picto_escaliers',
  POI_picto_toilettes:   'picto_toilettes',
  POI_picto_restauration:'picto_restauration',
  POI_picto_famille:     'picto_famille',
};

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
  // ── Intérêt ─────────────────────────────────────────────────────────────
  'POI_picto_interet:incontournable': { picto_key: 'PICTO_SMILEY_INCONTOURNABLE', label: 'Incontournable' },
  'POI_picto_interet:interessant':    { picto_key: 'PICTO_SMILEY_INTERESSANT',    label: 'Intéressant'    },
  'POI_picto_interet:a_voir':         { picto_key: 'PICTO_SMILEY_A_VOIR',         label: 'À voir'         },

  // ── PMR ─────────────────────────────────────────────────────────────────
  'POI_picto_pmr:100': { picto_key: 'PICTO_PMR_FULL', label: 'Accessible 100%'        },
  'POI_picto_pmr:50':  { picto_key: 'PICTO_PMR_HALF', label: 'Partiellement accessible'},
  'POI_picto_pmr:0':   { picto_key: 'PICTO_PMR_NONE', label: 'Non accessible'          },

  // ── Escaliers ───────────────────────────────────────────────────────────
  'POI_picto_escaliers:oui': { picto_key: 'PICTO_ESCALIERS', label: 'Escaliers' },
  'POI_picto_escaliers:non': { picto_key: null,               label: ''          },

  // ── Toilettes ───────────────────────────────────────────────────────────
  'POI_picto_toilettes:oui': { picto_key: 'PICTO_TOILETTES', label: 'Toilettes disponibles' },
  'POI_picto_toilettes:non': { picto_key: null,               label: ''                      },

  // ── Restauration ────────────────────────────────────────────────────────
  'POI_picto_restauration:oui': { picto_key: 'PICTO_RESTAURATION', label: 'Restauration sur place' },
  'POI_picto_restauration:non': { picto_key: null,                  label: ''                       },

  // ── Famille ─────────────────────────────────────────────────────────────
  'POI_picto_famille:oui': { picto_key: 'PICTO_FAMILLE', label: 'Activités enfants/familles' },
  'POI_picto_famille:non': { picto_key: null,             label: ''                           },
};

/** Retourne le mapping picto pour un champ et sa valeur */
export function resolvePictoMapping(fieldName: string, value: string): PictoMapping {
  const key = `${fieldName}:${value}`;
  return PICTO_VALUE_MAPPINGS[key] ?? { picto_key: null, label: value };
}

/** Retourne vrai si un champ est de type picto */
export function isPictoField(fieldName: string): boolean {
  return fieldName.includes('_picto_');
}

/**
 * Dérive automatiquement le nom de calque InDesign depuis le nom de champ.
 *
 * Convention :
 *   POI_titre_1        → txt_poi_titre_1
 *   POI_texte_1        → txt_poi_texte_1
 *   POI_image_1        → img_poi_image_1
 *   POI_picto_interet  → picto_poi_interet
 *   POI_meta_duree     → txt_poi_meta_duree
 *   POI_liste_activ    → txt_poi_liste_activ
 *   POI_lien_site      → lnk_poi_lien_site
 *
 * Utilisé en fallback quand `field.indesign_layer` n'est pas renseigné.
 */
export function deriveLayerName(fieldName: string): string {
  // Pattern attendu : TEMPLATE_type_slug  (ex: POI_titre_1, CLUSTER_image_principale)
  const match = fieldName.match(/^([A-Z][A-Z0-9_]*)_(titre|texte|image|picto|meta|liste|lien)_(.+)$/i);

  if (!match) return fieldName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const [, template, typeRaw, slug] = match;
  const tpl  = template.toLowerCase();
  const type = typeRaw.toLowerCase();

  const prefix: Record<string, string> = {
    titre:  'txt',
    texte:  'txt',
    meta:   'txt',
    liste:  'txt',
    lien:   'lnk',
    image:  'img',
    picto:  'picto',
  };

  const p = prefix[type] ?? 'txt';
  return `${p}_${tpl}_${slug.toLowerCase()}`;
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
