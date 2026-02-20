/**
 * Migration : normalisation complète du template POI
 *
 * Ce script est la SOURCE DE VÉRITÉ pour le template POI.
 * Il fait deux choses :
 *   1. Met à jour le template dans MongoDB avec des noms sémantiques,
 *      indesign_layer explicite et option_layers sur chaque picto.
 *   2. Renomme les clés dans le contenu des pages existantes
 *      (POI_picto_1 → POI_picto_interet, POI_meta_1 → POI_meta_duree, etc.).
 *
 * Avec ce template à jour :
 *   - export.service.ts lit field.indesign_layer → pas de FIELD_LAYER_MAPPINGS nécessaire
 *   - export.service.ts lit field.option_layers  → variant_layer correct sans PICTO_VARIANT_TABLE
 *   - Le script InDesign lit _derived.pictos_active → aucun nom de champ JSON hardcodé
 *
 * Usage :
 *   MONGODB_URI=mongodb+srv://... node scripts/update-poi-template.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI
  || 'mongodb+srv://travmatter:MlojoS4FzEb4Ob7u@internalrl.pqxqt94.mongodb.net/?retryWrites=true&w=majority&appName=InternalRL';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

// ─── Définition canonique du template POI ────────────────────────────────────
//
// Règles de nommage :
//   name          : <TEMPLATE>_<TYPE>_<slug>  (ex: POI_titre_1, POI_picto_interet)
//   indesign_layer: label exact du bloc dans le gabarit InDesign
//   option_layers : valeur → label calque variant InDesign (null = picto masqué)

const POI_FIELDS = [
  // ── Textes ──────────────────────────────────────────────────────────────────
  {
    id: 'poi_titre_1',
    type: 'titre',
    name: 'POI_titre_1',
    label: 'Nom du lieu',
    indesign_layer: 'txt_poi_titre_1',
    order: 1,
    max_chars: 60,
    ai_instructions: "Nom exact et officiel du lieu, sans article ni ponctuation superflue.",
  },
  {
    id: 'poi_texte_1',
    type: 'texte',
    name: 'POI_texte_1',
    label: 'Description principale',
    indesign_layer: 'txt_poi_texte_1',
    order: 2,
    max_chars: 480,
    ai_instructions: "Description principale du lieu en 3-4 phrases. Factuelle, sans ton promotionnel. Peut inclure du gras avec **mot** pour les éléments clés.",
  },
  {
    id: 'poi_texte_2',
    type: 'texte',
    name: 'POI_texte_2',
    label: 'Informations pratiques (liste)',
    description: 'Chaque ligne devient une puce ronde dans InDesign',
    indesign_layer: 'txt_poi_texte_2',
    order: 3,
    max_chars: 300,
    ai_instructions: "Liste d'informations pratiques (horaires, tarifs, conseils d'accès). Chaque information sur une ligne séparée par \\n. Format court, factuel.",
  },

  // ── Images ──────────────────────────────────────────────────────────────────
  {
    id: 'poi_image_1',
    type: 'image',
    name: 'POI_image_1',
    label: 'Photo principale (grand rond)',
    indesign_layer: 'img_poi_grand_rond',
    order: 4,
  },
  {
    id: 'poi_image_2',
    type: 'image',
    name: 'POI_image_2',
    label: 'Photo secondaire (petit rond)',
    indesign_layer: 'img_poi_petit_rond',
    order: 5,
  },
  {
    id: 'poi_image_3',
    type: 'image',
    name: 'POI_image_3',
    label: 'Photo bas de page',
    indesign_layer: 'img_poi_bas_page',
    order: 6,
  },

  // ── Pictos ──────────────────────────────────────────────────────────────────
  // option_layers = source de vérité pour variant_layer dans l'export JSON
  {
    id: 'poi_picto_interet',
    type: 'picto',
    name: 'POI_picto_interet',
    label: 'Intérêt du lieu',
    description: 'Niveau d\'intérêt éditorial du lieu',
    indesign_layer: 'picto_interet',
    options: ['incontournable', 'interessant', 'a_voir'],
    option_layers: {
      incontournable: 'picto_interet_1',
      interessant:    'picto_interet_2',
      a_voir:         'picto_interet_3',
    },
    order: 7,
    ai_instructions: "Évaluer l'intérêt touristique du lieu. 'incontournable' : must-see absolu. 'interessant' : mérite la visite. 'a_voir' : agréable mais secondaire. Choisir UNE valeur exacte parmi : incontournable, interessant, a_voir",
  },
  {
    id: 'poi_picto_pmr',
    type: 'picto',
    name: 'POI_picto_pmr',
    label: 'Accessibilité PMR',
    description: 'Accessibilité aux personnes à mobilité réduite',
    indesign_layer: 'picto_pmr',
    options: ['100', '50', '0'],
    option_layers: {
      '100': 'picto_pmr_full',
      '50':  'picto_pmr_half',
      '0':   'picto_pmr_none',
    },
    order: 8,
    ai_instructions: "Accessibilité PMR. '100' : totalement accessible. '50' : partiellement. '0' : non accessible. Si non mentionné, répondre '50'. Choisir UNE valeur exacte parmi : 100, 50, 0",
  },
  {
    id: 'poi_picto_escaliers',
    type: 'picto',
    name: 'POI_picto_escaliers',
    label: 'Escaliers / Dénivelé',
    description: 'Présence d\'escaliers abrupts ou dénivelé important',
    indesign_layer: 'picto_escaliers',
    options: ['oui', 'non'],
    option_layers: { oui: 'picto_escaliers', non: null },
    order: 9,
    ai_instructions: "Le lieu comporte-t-il des escaliers abrupts ou un dénivelé significatif ? Choisir UNE valeur parmi : oui, non. Si non mentionné, répondre 'non'",
  },
  {
    id: 'poi_picto_toilettes',
    type: 'picto',
    name: 'POI_picto_toilettes',
    label: 'Toilettes disponibles',
    description: 'Présence de toilettes sur le site',
    indesign_layer: 'picto_toilettes',
    options: ['oui', 'non'],
    option_layers: { oui: 'picto_toilettes', non: null },
    order: 10,
    ai_instructions: "Y a-t-il des toilettes publiques disponibles ? Choisir UNE valeur parmi : oui, non. Si non mentionné, répondre 'non'",
  },
  {
    id: 'poi_picto_restauration',
    type: 'picto',
    name: 'POI_picto_restauration',
    label: 'Restauration sur place',
    description: 'Présence d\'un service de restauration',
    indesign_layer: 'picto_restauration',
    options: ['oui', 'non'],
    option_layers: { oui: 'picto_restauration', non: null },
    order: 11,
    ai_instructions: "Y a-t-il un service de restauration sur place (café, restaurant, snack) ? Choisir UNE valeur parmi : oui, non. Si non mentionné, répondre 'non'",
  },
  {
    id: 'poi_picto_famille',
    type: 'picto',
    name: 'POI_picto_famille',
    label: 'Activités familles / enfants',
    description: 'Présence d\'activités ou animations pour enfants',
    indesign_layer: 'picto_famille',
    options: ['oui', 'non'],
    option_layers: { oui: 'picto_famille', non: null },
    order: 12,
    ai_instructions: "Le lieu propose-t-il des activités spécifiques pour enfants/familles ? Choisir UNE valeur parmi : oui, non",
  },

  // ── Méta ────────────────────────────────────────────────────────────────────
  {
    id: 'poi_meta_duree',
    type: 'meta',
    name: 'POI_meta_duree',
    label: 'Durée de visite (minutes)',
    description: 'Fourchette de durée estimée',
    indesign_layer: 'txt_poi_duree',
    order: 13,
    max_chars: 10,
    ai_instructions: "Estimer la durée de visite en minutes sous forme de fourchette (ex: '30-60', '60-90'). Format : deux nombres séparés par un tiret.",
  },

  // ── Lien ────────────────────────────────────────────────────────────────────
  {
    id: 'poi_lien_1',
    type: 'lien',
    name: 'POI_lien_1',
    label: 'Lien bas de page',
    description: 'URL source de l\'article WordPress — texte statique dans le gabarit',
    indesign_layer: 'lnk_poi_1',
    order: 14,
  },
];

// ─── Table de renommage : anciens noms → nouveaux noms ───────────────────────
// Utilisée pour migrer le contenu des pages existantes.
const FIELD_RENAME_MAP = {
  POI_picto_1: 'POI_picto_interet',
  POI_picto_2: 'POI_picto_pmr',
  POI_picto_3: 'POI_picto_escaliers',
  POI_picto_4: 'POI_picto_toilettes',
  POI_picto_5: 'POI_picto_restauration',
  POI_picto_6: 'POI_picto_famille',
  POI_meta_1:  'POI_meta_duree',
};

// ─── Migration ────────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(process.env.MONGODB_DB_NAME || 'redactor_guide');

    // 1. Mettre à jour le template POI
    console.log('\n📋 Mise à jour du template POI...');
    const templatesCol = db.collection('templates');
    const poiTemplate  = await templatesCol.findOne({ name: 'POI' });

    if (!poiTemplate) {
      console.error('❌ Template POI introuvable en base');
      return;
    }
    console.log(`   Template trouvé : ${poiTemplate._id}`);
    console.log(`   Champs actuels : ${poiTemplate.fields.length}`);
    poiTemplate.fields.forEach(f => console.log(`     - [${f.type}] ${f.name}`));

    const templateResult = await templatesCol.updateOne(
      { name: 'POI' },
      { $set: { fields: POI_FIELDS, updated_at: new Date().toISOString() } }
    );
    console.log(`✅ Template mis à jour (${templateResult.modifiedCount} modifié)`);

    // 2. Migrer le contenu des pages
    console.log('\n📄 Migration du contenu des pages POI...');
    const pagesCol = db.collection('pages');
    const poiPages = await pagesCol
      .find({ template_name: 'POI', content: { $exists: true } })
      .toArray();

    console.log(`   ${poiPages.length} page(s) POI trouvée(s)`);
    let migratedCount = 0;

    for (const page of poiPages) {
      const content = page.content || {};
      const newContent = { ...content };
      let changed = false;

      for (const [oldKey, newKey] of Object.entries(FIELD_RENAME_MAP)) {
        if (oldKey in newContent && !(newKey in newContent)) {
          newContent[newKey] = newContent[oldKey];
          delete newContent[oldKey];
          changed = true;
          console.log(`   Page "${page.titre}" : ${oldKey} → ${newKey}`);
        }
      }

      if (changed) {
        await pagesCol.updateOne(
          { _id: page._id },
          { $set: { content: newContent, updated_at: new Date().toISOString() } }
        );
        migratedCount++;
      }
    }
    console.log(`✅ ${migratedCount} page(s) migrée(s)`);

    // 3. Vérification finale
    console.log('\n📋 Template POI après migration :');
    const updated = await templatesCol.findOne({ name: 'POI' });
    updated.fields.forEach(f => {
      const opts   = f.options ? ` [${f.options.join('/')}]` : '';
      const layer  = f.indesign_layer ? ` → ${f.indesign_layer}` : '';
      const vl     = f.option_layers  ? ` (variants: ${Object.values(f.option_layers).filter(Boolean).join(', ')})` : '';
      console.log(`   ${f.order}. [${f.type}] ${f.name}${opts}${layer}${vl}`);
    });

  } catch (err) {
    console.error('❌ Erreur:', err);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Connexion fermée');
  }
}

main();
