/**
 * seed-indesign-layers.js
 *
 * Migration one-shot : lit FIELD_LAYER_MAPPINGS et PICTO_LAYER_MAPPINGS depuis
 * export-mappings.ts (via le JSON hardcodé ci-dessous) et écrit indesign_layer
 * sur chaque champ de template en base MongoDB.
 *
 * À exécuter UNE SEULE FOIS après le déploiement qui ajoute indesign_layer au schema.
 * Ensuite, toute modification de template devra renseigner indesign_layer manuellement
 * dans l'UI ou via l'API — la dérivation automatique (deriveLayerName) couvre le reste.
 *
 * Usage :
 *   MONGODB_URI=... MONGODB_DB_NAME=redactor_guide node scripts/seed-indesign-layers.js
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

// ─── Copie des mappings depuis export-mappings.ts ────────────────────────────
// (Ne pas importer directement le TS — ce script tourne en Node.js pur)

const FIELD_LAYER_MAPPINGS = {
  // COUVERTURE
  COUVERTURE_titre_destination:      'txt_couverture_destination',
  COUVERTURE_titre_annee:            'txt_couverture_annee',
  COUVERTURE_image_hero:             'img_couverture_hero',
  COUVERTURE_texte_baseline:         'txt_couverture_baseline',
  // PRESENTATION_GUIDE
  PRESENTATION_GUIDE_titre_principal:        'txt_presguide_titre',
  PRESENTATION_GUIDE_texte_intro:            'txt_presguide_intro',
  PRESENTATION_GUIDE_texte_comment_utiliser: 'txt_presguide_utiliser',
  PRESENTATION_GUIDE_liste_sections:         'txt_presguide_sections',
  PRESENTATION_GUIDE_image_illustration:     'img_presguide_illustration',
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
  // CLUSTER
  CLUSTER_titre_nom:             'txt_cluster_nom',
  CLUSTER_texte_description:     'txt_cluster_description',
  CLUSTER_image_principale:      'img_cluster_principale',
  CLUSTER_texte_ambiance:        'txt_cluster_ambiance',
  CLUSTER_liste_incontournables: 'txt_cluster_incontournables',
  CLUSTER_meta_duree_visite:     'txt_cluster_duree',
  CLUSTER_texte_conseil_acces:   'txt_cluster_acces',
  // POI
  POI_titre_1:    'txt_poi_nom',
  POI_texte_1:    'txt_poi_desc_principale',
  POI_texte_2:    'txt_poi_desc_secondaire',
  POI_image_1:    'img_poi_grand_rond',
  POI_image_2:    'img_poi_petit_rond',
  POI_image_3:    'img_poi_banniere',
  POI_meta_duree: 'txt_poi_duree',
  // INSPIRATION
  INSPIRATION_titre_theme:             'txt_inspi_titre',
  INSPIRATION_texte_angle_editorial:   'txt_inspi_angle',
  INSPIRATION_image_hero:              'img_inspi_hero',
  INSPIRATION_liste_lieux_1_6:         'txt_inspi_lieux',
  INSPIRATION_liste_descriptions_1_6:  'txt_inspi_descriptions',
  INSPIRATION_liste_images_1_6:        'img_inspi_lieux',
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
  SECTION_INTRO_titre_section:      'txt_section_titre',
  SECTION_INTRO_texte_chapeau:      'txt_section_chapeau',
  SECTION_INTRO_image_hero:         'img_section_hero',
  SECTION_INTRO_texte_presentation: 'txt_section_presentation',
  SECTION_INTRO_liste_highlights:   'txt_section_highlights',
  SECTION_INTRO_texte_conseil:      'txt_section_conseil',
  // ALLER_PLUS_LOIN
  ALLER_PLUS_LOIN_titre_principal:      'txt_apl_titre',
  ALLER_PLUS_LOIN_texte_intro:          'txt_apl_intro',
  ALLER_PLUS_LOIN_liste_ressources:     'txt_apl_ressources',
  ALLER_PLUS_LOIN_liste_sites_officiels:'txt_apl_sites',
  ALLER_PLUS_LOIN_texte_apps_mobiles:   'txt_apl_apps',
  // A_PROPOS_RL
  A_PROPOS_RL_titre_principal:    'txt_rl_titre',
  A_PROPOS_RL_texte_presentation: 'txt_rl_presentation',
  A_PROPOS_RL_image_logo:         'img_rl_logo',
  A_PROPOS_RL_texte_mission:      'txt_rl_mission',
  A_PROPOS_RL_liste_valeurs:      'txt_rl_valeurs',
  A_PROPOS_RL_lien_site:          'lnk_rl_site',
  A_PROPOS_RL_lien_contact:       'lnk_rl_contact',
};

const PICTO_LAYER_MAPPINGS = {
  POI_picto_interet:     'picto_interet',
  POI_picto_pmr:         'picto_pmr',
  POI_picto_escaliers:   'picto_escaliers',
  POI_picto_toilettes:   'picto_toilettes',
  POI_picto_restauration:'picto_restauration',
  POI_picto_famille:     'picto_famille',
};

const ALL_MAPPINGS = { ...FIELD_LAYER_MAPPINGS, ...PICTO_LAYER_MAPPINGS };

// ─── Migration ────────────────────────────────────────────────────────────────

async function run() {
  const uri    = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'redactor_guide';

  if (!uri) {
    console.error('❌ MONGODB_URI manquant dans .env');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`📦 Connecté à ${dbName}`);

  const templates = await db.collection('templates').find({}).toArray();
  console.log(`📋 ${templates.length} template(s) trouvé(s)`);

  let totalFields = 0;
  let updatedFields = 0;
  let derivedFields = 0;

  for (const template of templates) {
    const updatedFieldsList = [];
    let templateChanged = false;

    for (const field of (template.fields ?? [])) {
      totalFields++;

      // Ne pas écraser une valeur déjà saisie manuellement
      if (field.indesign_layer) {
        updatedFieldsList.push(field);
        continue;
      }

      const mappedLayer = ALL_MAPPINGS[field.name];
      if (mappedLayer) {
        field.indesign_layer = mappedLayer;
        updatedFields++;
        templateChanged = true;
        console.log(`  ✅ ${field.name} → ${mappedLayer}`);
      } else {
        // Dériver automatiquement selon la convention
        const derived = deriveLayerName(field.name);
        field.indesign_layer = derived;
        derivedFields++;
        templateChanged = true;
        console.log(`  🔧 ${field.name} → ${derived} (dérivé)`);
      }

      updatedFieldsList.push(field);
    }

    if (templateChanged) {
      await db.collection('templates').updateOne(
        { _id: template._id },
        { $set: { fields: updatedFieldsList, updated_at: new Date().toISOString() } }
      );
      console.log(`✅ Template "${template.name}" mis à jour`);
    }
  }

  await client.close();

  console.log('\n─── Résumé ───────────────────────────────');
  console.log(`Templates traités    : ${templates.length}`);
  console.log(`Champs totaux        : ${totalFields}`);
  console.log(`Depuis mapping       : ${updatedFields}`);
  console.log(`Dérivés auto         : ${derivedFields}`);
  console.log(`Déjà renseignés      : ${totalFields - updatedFields - derivedFields}`);
  console.log('──────────────────────────────────────────');
}

// ─── Convention de dérivation (miroir de deriveLayerName dans export-mappings.ts)

function deriveLayerName(fieldName) {
  const match = fieldName.match(/^([A-Z][A-Z0-9_]*)_(titre|texte|image|picto|meta|liste|lien)_(.+)$/i);
  if (!match) return fieldName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const [, template, typeRaw, slug] = match;
  const tpl  = template.toLowerCase();
  const type = typeRaw.toLowerCase();

  const prefix = { titre:'txt', texte:'txt', meta:'txt', liste:'txt', lien:'lnk', image:'img', picto:'picto' };
  const p = prefix[type] ?? 'txt';
  return `${p}_${tpl}_${slug.toLowerCase()}`;
}

run().catch(err => { console.error('❌ Erreur:', err); process.exit(1); });
