/**
 * Script de seed pour créer des templates par défaut
 * Usage: node seed-templates.js
 */

const { MongoClient } = require('mongodb');

// Configuration MongoDB (à adapter selon votre environnement)
const MONGO_URL = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'redactor-guide';

// Templates par défaut
const DEFAULT_TEMPLATES = [
  {
    name: 'POI',
    description: 'Point d\'intérêt générique (monument, lieu culturel, etc.)',
    fields: [
      { id: 'poi_1', type: 'titre', name: 'POI_titre_principal', label: 'Nom du POI', order: 0, max_chars: 80 },
      { id: 'poi_2', type: 'texte', name: 'POI_texte_description', label: 'Description principale', order: 1, max_chars: 500 },
      { id: 'poi_3', type: 'image', name: 'POI_image_principale', label: 'Photo principale', order: 2 },
      { id: 'poi_4', type: 'meta', name: 'POI_meta_adresse', label: 'Adresse', order: 3, max_chars: 150 },
      { id: 'poi_5', type: 'meta', name: 'POI_meta_horaires', label: 'Horaires', order: 4, max_chars: 100 },
      { id: 'poi_6', type: 'meta', name: 'POI_meta_tarif', label: 'Tarif', order: 5, max_chars: 80 },
      { id: 'poi_7', type: 'lien', name: 'POI_lien_site', label: 'Site web', order: 6 },
    ],
  },
  {
    name: 'RESTAURANT',
    description: 'Restaurant, bar ou établissement de restauration',
    fields: [
      { id: 'resto_1', type: 'titre', name: 'RESTAURANT_titre_nom', label: 'Nom du restaurant', order: 0, max_chars: 80 },
      { id: 'resto_2', type: 'texte', name: 'RESTAURANT_texte_description', label: 'Description', order: 1, max_chars: 400 },
      { id: 'resto_3', type: 'image', name: 'RESTAURANT_image_facade', label: 'Photo façade/intérieur', order: 2 },
      { id: 'resto_4', type: 'meta', name: 'RESTAURANT_meta_cuisine', label: 'Type de cuisine', order: 3, max_chars: 50 },
      { id: 'resto_5', type: 'meta', name: 'RESTAURANT_meta_prix', label: 'Gamme de prix', order: 4, max_chars: 50 },
      { id: 'resto_6', type: 'meta', name: 'RESTAURANT_meta_adresse', label: 'Adresse', order: 5, max_chars: 150 },
      { id: 'resto_7', type: 'meta', name: 'RESTAURANT_meta_tel', label: 'Téléphone', order: 6, max_chars: 30 },
      { id: 'resto_8', type: 'lien', name: 'RESTAURANT_lien_reservation', label: 'Lien réservation', order: 7 },
    ],
  },
  {
    name: 'PLAGE',
    description: 'Plage, crique ou zone de baignade',
    fields: [
      { id: 'plage_1', type: 'titre', name: 'PLAGE_titre_nom', label: 'Nom de la plage', order: 0, max_chars: 80 },
      { id: 'plage_2', type: 'texte', name: 'PLAGE_texte_description', label: 'Description', order: 1, max_chars: 400 },
      { id: 'plage_3', type: 'image', name: 'PLAGE_image_vue', label: 'Photo de la plage', order: 2 },
      { id: 'plage_4', type: 'meta', name: 'PLAGE_meta_acces', label: 'Accès', order: 3, max_chars: 100 },
      { id: 'plage_5', type: 'meta', name: 'PLAGE_meta_services', label: 'Services (parasols, snack...)', order: 4, max_chars: 150 },
      { id: 'plage_6', type: 'meta', name: 'PLAGE_meta_type', label: 'Type (sable, galets, rochers)', order: 5, max_chars: 50 },
      { id: 'plage_7', type: 'texte', name: 'PLAGE_texte_conseil', label: 'Conseil pratique', order: 6, max_chars: 200 },
    ],
  },
  {
    name: 'HEBERGEMENT',
    description: 'Hôtel, appartement, auberge ou hébergement touristique',
    fields: [
      { id: 'heb_1', type: 'titre', name: 'HEBERGEMENT_titre_nom', label: 'Nom de l\'hébergement', order: 0, max_chars: 80 },
      { id: 'heb_2', type: 'texte', name: 'HEBERGEMENT_texte_description', label: 'Description', order: 1, max_chars: 500 },
      { id: 'heb_3', type: 'image', name: 'HEBERGEMENT_image_principale', label: 'Photo principale', order: 2 },
      { id: 'heb_4', type: 'meta', name: 'HEBERGEMENT_meta_categorie', label: 'Catégorie (étoiles)', order: 3, max_chars: 30 },
      { id: 'heb_5', type: 'meta', name: 'HEBERGEMENT_meta_prix', label: 'Tarifs indicatifs', order: 4, max_chars: 100 },
      { id: 'heb_6', type: 'meta', name: 'HEBERGEMENT_meta_adresse', label: 'Adresse', order: 5, max_chars: 150 },
      { id: 'heb_7', type: 'liste', name: 'HEBERGEMENT_liste_equipements', label: 'Équipements', order: 6, list_size: 5 },
      { id: 'heb_8', type: 'lien', name: 'HEBERGEMENT_lien_booking', label: 'Lien réservation', order: 7 },
    ],
  },
  {
    name: 'ACTIVITE',
    description: 'Activité sportive, culturelle ou de loisirs',
    fields: [
      { id: 'act_1', type: 'titre', name: 'ACTIVITE_titre_nom', label: 'Nom de l\'activité', order: 0, max_chars: 80 },
      { id: 'act_2', type: 'texte', name: 'ACTIVITE_texte_description', label: 'Description', order: 1, max_chars: 500 },
      { id: 'act_3', type: 'image', name: 'ACTIVITE_image_action', label: 'Photo d\'action', order: 2 },
      { id: 'act_4', type: 'meta', name: 'ACTIVITE_meta_duree', label: 'Durée', order: 3, max_chars: 50 },
      { id: 'act_5', type: 'meta', name: 'ACTIVITE_meta_difficulte', label: 'Niveau de difficulté', order: 4, max_chars: 50 },
      { id: 'act_6', type: 'meta', name: 'ACTIVITE_meta_tarif', label: 'Tarif', order: 5, max_chars: 80 },
      { id: 'act_7', type: 'meta', name: 'ACTIVITE_meta_reservation', label: 'Réservation requise ?', order: 6, max_chars: 50 },
      { id: 'act_8', type: 'lien', name: 'ACTIVITE_lien_info', label: 'Plus d\'infos', order: 7 },
    ],
  },
  {
    name: 'SECTION_INTRO',
    description: 'Page d\'introduction de section thématique',
    fields: [
      { id: 'sec_1', type: 'titre', name: 'SECTION_INTRO_titre_section', label: 'Titre de la section', order: 0, max_chars: 100 },
      { id: 'sec_2', type: 'texte', name: 'SECTION_INTRO_texte_chapeau', label: 'Texte chapeau', order: 1, max_chars: 300 },
      { id: 'sec_3', type: 'image', name: 'SECTION_INTRO_image_hero', label: 'Image hero', order: 2 },
      { id: 'sec_4', type: 'texte', name: 'SECTION_INTRO_texte_presentation', label: 'Présentation générale', order: 3, max_chars: 800 },
      { id: 'sec_5', type: 'liste', name: 'SECTION_INTRO_liste_highlights', label: 'Points clés', order: 4, list_size: 4 },
      { id: 'sec_6', type: 'texte', name: 'SECTION_INTRO_texte_conseil', label: 'Conseil pratique', order: 5, max_chars: 300 },
    ],
  },
];

async function seedTemplates() {
  const client = new MongoClient(MONGO_URL);

  try {
    console.log('🔗 Connexion à MongoDB...');
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(DB_NAME);
    const templatesCollection = db.collection('templates');

    // Vérifier combien de templates existent déjà
    const existingCount = await templatesCollection.countDocuments();
    console.log(`📊 Templates existants : ${existingCount}`);

    if (existingCount > 0) {
      console.log('⚠️  Des templates existent déjà. Voulez-vous continuer ?');
      console.log('   Les templates avec le même nom seront ignorés.');
    }

    let created = 0;
    let skipped = 0;

    for (const template of DEFAULT_TEMPLATES) {
      // Vérifier si le template existe déjà
      const existing = await templatesCollection.findOne({ name: template.name });

      if (existing) {
        console.log(`⏭️  Template "${template.name}" existe déjà, ignoré`);
        skipped++;
        continue;
      }

      // Créer le template
      const now = new Date().toISOString();
      const templateDoc = {
        ...template,
        created_at: now,
        updated_at: now,
      };

      await templatesCollection.insertOne(templateDoc);
      console.log(`✅ Template "${template.name}" créé avec ${template.fields.length} champs`);
      created++;
    }

    console.log('\n📊 Résumé :');
    console.log(`   ✅ ${created} templates créés`);
    console.log(`   ⏭️  ${skipped} templates ignorés (déjà existants)`);
    console.log(`   📦 Total dans la base : ${await templatesCollection.countDocuments()}`);

  } catch (error) {
    console.error('❌ Erreur lors du seed :', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Connexion fermée');
  }
}

// Exécuter le seed
seedTemplates();
