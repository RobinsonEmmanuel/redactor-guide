/**
 * Script de migration : ajout des pictos au template POI
 * Exécuter avec : node add-poi-pictos.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant dans .env');
  process.exit(1);
}

const PICTO_FIELDS = [
  {
    id: 'poi_picto_1',
    type: 'picto',
    name: 'POI_picto_interet',
    label: 'Intérêt du lieu',
    description: 'Niveau d\'intérêt éditorial du lieu',
    options: ['incontournable', 'interessant', 'a_voir'],
    order: 7,
    ai_instructions: "Évaluer l'intérêt touristique du lieu selon le contenu de l'article. 'incontournable' : lieu emblématique, exceptionnel, must-see absolu de la destination. 'interessant' : lieu méritant clairement une visite, bon rapport qualité/expérience. 'a_voir' : lieu agréable mais secondaire, à voir si le temps le permet. Choisir UNE valeur exacte parmi : incontournable, interessant, a_voir",
  },
  {
    id: 'poi_picto_2',
    type: 'picto',
    name: 'POI_picto_pmr',
    label: 'Accessibilité PMR',
    description: 'Accessibilité aux personnes à mobilité réduite',
    options: ['100', '50', '0'],
    order: 8,
    ai_instructions: "Accessibilité aux personnes à mobilité réduite (PMR). '100' : totalement accessible (rampes, ascenseurs, sans obstacles). '50' : partiellement accessible (certaines zones accessibles). '0' : non accessible (nombreux escaliers, terrain accidenté, etc.). Si l'article ne mentionne pas l'accessibilité, répondre '50'. Choisir UNE valeur exacte parmi : 100, 50, 0",
  },
  {
    id: 'poi_picto_3',
    type: 'picto',
    name: 'POI_picto_escaliers',
    label: 'Escaliers / Dénivelé',
    description: 'Présence d\'escaliers abrupts ou dénivelé important',
    options: ['oui', 'non'],
    order: 9,
    ai_instructions: "Le lieu comporte-t-il des escaliers abrupts, des marches importantes ou un dénivelé significatif à parcourir ? Choisir UNE valeur exacte parmi : oui, non. Si non mentionné dans l'article, répondre 'non'",
  },
  {
    id: 'poi_picto_4',
    type: 'picto',
    name: 'POI_picto_toilettes',
    label: 'Toilettes disponibles',
    description: 'Présence de toilettes sur le site',
    options: ['oui', 'non'],
    order: 10,
    ai_instructions: "Y a-t-il des toilettes publiques disponibles sur le lieu de visite ? Choisir UNE valeur exacte parmi : oui, non. Si non mentionné dans l'article, répondre 'non'",
  },
  {
    id: 'poi_picto_5',
    type: 'picto',
    name: 'POI_picto_restauration',
    label: 'Restauration sur place',
    description: 'Présence d\'un service de restauration (café, restaurant, snack)',
    options: ['oui', 'non'],
    order: 11,
    ai_instructions: "Y a-t-il un service de restauration sur le lieu de visite (café, restaurant, snack-bar, buvette) ? Choisir UNE valeur exacte parmi : oui, non. Si non mentionné dans l'article, répondre 'non'",
  },
  {
    id: 'poi_picto_6',
    type: 'picto',
    name: 'POI_picto_famille',
    label: 'Activités familles / enfants',
    description: 'Présence d\'activités ou animations pour enfants',
    options: ['oui', 'non'],
    order: 12,
    ai_instructions: "Le lieu propose-t-il des activités spécifiques pour les enfants ou les familles (livret découverte, parcours jeux, animations, ateliers pédagogiques) ? Choisir UNE valeur exacte parmi : oui, non",
  },
  {
    id: 'poi_picto_7',
    type: 'meta',
    name: 'POI_meta_duree',
    label: 'Durée de visite (minutes)',
    description: 'Fourchette de durée estimée pour la visite',
    order: 13,
    max_chars: 10,
    ai_instructions: "Estimer la durée de visite en minutes sous forme de fourchette (ex: '30-60', '60-90', '90-120', '120-180'). Baser l'estimation sur le type de lieu et les activités décrites dans l'article. Format obligatoire : deux nombres séparés par un tiret (ex: 45-90)",
  },
];

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(process.env.MONGODB_DB_NAME || 'redactor_guide');
    const collection = db.collection('templates');

    // Trouver le template POI
    const poiTemplate = await collection.findOne({ name: 'POI' });

    if (!poiTemplate) {
      console.error('❌ Template POI introuvable');
      return;
    }

    console.log(`📋 Template POI trouvé : ${poiTemplate._id}`);
    console.log(`   Champs existants : ${poiTemplate.fields.length}`);

    // Vérifier si les pictos sont déjà présents
    const existingPictoNames = poiTemplate.fields
      .filter((f) => f.type === 'picto' || f.name.includes('picto'))
      .map((f) => f.name);

    if (existingPictoNames.length > 0) {
      console.log(`⚠️  Pictos déjà présents : ${existingPictoNames.join(', ')}`);
      console.log('   Suppression des anciens pictos et remplacement...');
      
      // Retirer les anciens pictos et la durée si elle existe déjà
      const cleanedFields = poiTemplate.fields.filter(
        (f) => !f.type === 'picto' && !f.name.includes('picto') && f.name !== 'POI_meta_duree'
      );
      
      const result = await collection.updateOne(
        { name: 'POI' },
        {
          $set: {
            fields: [...cleanedFields, ...PICTO_FIELDS],
            updated_at: new Date().toISOString(),
          },
        }
      );
      console.log(`✅ Template POI mis à jour : ${result.modifiedCount} document(s) modifié(s)`);
    } else {
      // Ajouter les pictos aux champs existants
      const result = await collection.updateOne(
        { name: 'POI' },
        {
          $push: { fields: { $each: PICTO_FIELDS } },
          $set: { updated_at: new Date().toISOString() },
        }
      );
      console.log(`✅ ${PICTO_FIELDS.length} pictos ajoutés au template POI`);
      console.log(`   Documents modifiés : ${result.modifiedCount}`);
    }

    // Vérification finale
    const updatedTemplate = await collection.findOne({ name: 'POI' });
    console.log(`\n📋 Template POI après mise à jour :`);
    updatedTemplate.fields.forEach((f) => {
      const opts = f.options ? ` [${f.options.join('/')}]` : '';
      console.log(`   ${f.order}. [${f.type}] ${f.name}${opts}`);
    });

  } catch (err) {
    console.error('❌ Erreur:', err);
  } finally {
    await client.close();
    console.log('\n🔌 Connexion fermée');
  }
}

main();
