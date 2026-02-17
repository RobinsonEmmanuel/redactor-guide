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
  {
    name: 'COUVERTURE',
    description: 'Page de couverture du guide',
    fields: [
      { id: 'couv_1', type: 'titre', name: 'COUVERTURE_titre_destination', label: 'Nom de la destination', order: 0, max_chars: 100 },
      { id: 'couv_2', type: 'titre', name: 'COUVERTURE_titre_annee', label: 'Année du guide', order: 1, max_chars: 20 },
      { id: 'couv_3', type: 'image', name: 'COUVERTURE_image_hero', label: 'Image de couverture', order: 2 },
      { id: 'couv_4', type: 'texte', name: 'COUVERTURE_texte_baseline', label: 'Baseline marketing', order: 3, max_chars: 150 },
    ],
  },
  {
    name: 'PRESENTATION_GUIDE',
    description: 'Page de présentation du guide et de son utilisation',
    fields: [
      { id: 'pres_g_1', type: 'titre', name: 'PRESENTATION_GUIDE_titre_principal', label: 'Titre de la page', order: 0, max_chars: 80 },
      { id: 'pres_g_2', type: 'texte', name: 'PRESENTATION_GUIDE_texte_intro', label: 'Introduction', order: 1, max_chars: 400 },
      { id: 'pres_g_3', type: 'texte', name: 'PRESENTATION_GUIDE_texte_comment_utiliser', label: 'Comment utiliser ce guide', order: 2, max_chars: 500 },
      { id: 'pres_g_4', type: 'liste', name: 'PRESENTATION_GUIDE_liste_sections', label: 'Sections du guide', order: 3, list_size: 6 },
      { id: 'pres_g_5', type: 'image', name: 'PRESENTATION_GUIDE_image_illustration', label: 'Illustration', order: 4 },
    ],
  },
  {
    name: 'PRESENTATION_DESTINATION',
    description: 'Page de présentation générale de la destination',
    fields: [
      { id: 'pres_d_1', type: 'titre', name: 'PRESENTATION_DESTINATION_titre_destination', label: 'Nom de la destination', order: 0, max_chars: 100 },
      { id: 'pres_d_2', type: 'texte', name: 'PRESENTATION_DESTINATION_texte_intro', label: 'Introduction', order: 1, max_chars: 600 },
      { id: 'pres_d_3', type: 'image', name: 'PRESENTATION_DESTINATION_image_hero', label: 'Image principale', order: 2 },
      { id: 'pres_d_4', type: 'texte', name: 'PRESENTATION_DESTINATION_texte_histoire', label: 'Histoire et culture', order: 3, max_chars: 500 },
      { id: 'pres_d_5', type: 'texte', name: 'PRESENTATION_DESTINATION_texte_geographie', label: 'Géographie et climat', order: 4, max_chars: 400 },
      { id: 'pres_d_6', type: 'liste', name: 'PRESENTATION_DESTINATION_liste_highlights', label: 'Points forts', order: 5, list_size: 5 },
      { id: 'pres_d_7', type: 'meta', name: 'PRESENTATION_DESTINATION_meta_population', label: 'Population', order: 6, max_chars: 50 },
      { id: 'pres_d_8', type: 'meta', name: 'PRESENTATION_DESTINATION_meta_superficie', label: 'Superficie', order: 7, max_chars: 50 },
    ],
  },
  {
    name: 'CARTE_DESTINATION',
    description: 'Page avec la carte de la destination',
    fields: [
      { id: 'carte_1', type: 'titre', name: 'CARTE_DESTINATION_titre_principal', label: 'Titre', order: 0, max_chars: 80 },
      { id: 'carte_2', type: 'image', name: 'CARTE_DESTINATION_image_carte', label: 'Carte principale', order: 1 },
      { id: 'carte_3', type: 'texte', name: 'CARTE_DESTINATION_texte_legende', label: 'Légende de la carte', order: 2, max_chars: 300 },
      { id: 'carte_4', type: 'liste', name: 'CARTE_DESTINATION_liste_zones', label: 'Zones principales', order: 3, list_size: 8 },
    ],
  },
  {
    name: 'CLUSTER',
    description: 'Page de présentation d\'un cluster/zone géographique',
    fields: [
      { id: 'clust_1', type: 'titre', name: 'CLUSTER_titre_nom', label: 'Nom du cluster', order: 0, max_chars: 100 },
      { id: 'clust_2', type: 'texte', name: 'CLUSTER_texte_description', label: 'Description de la zone', order: 1, max_chars: 500 },
      { id: 'clust_3', type: 'image', name: 'CLUSTER_image_principale', label: 'Photo de la zone', order: 2 },
      { id: 'clust_4', type: 'texte', name: 'CLUSTER_texte_ambiance', label: 'Ambiance et caractère', order: 3, max_chars: 400 },
      { id: 'clust_5', type: 'liste', name: 'CLUSTER_liste_incontournables', label: 'Lieux incontournables', order: 4, list_size: 5 },
      { id: 'clust_6', type: 'meta', name: 'CLUSTER_meta_duree_visite', label: 'Durée de visite recommandée', order: 5, max_chars: 50 },
      { id: 'clust_7', type: 'texte', name: 'CLUSTER_texte_conseil_acces', label: 'Conseils d\'accès', order: 6, max_chars: 300 },
    ],
  },
  {
    name: 'INSPIRATION',
    description: 'Page d\'inspiration thématique avec 6 POIs',
    fields: [
      { id: 'insp_1', type: 'titre', name: 'INSPIRATION_titre_theme', label: 'Titre du thème', order: 0, max_chars: 100 },
      { id: 'insp_2', type: 'texte', name: 'INSPIRATION_texte_angle_editorial', label: 'Angle éditorial', order: 1, max_chars: 300 },
      { id: 'insp_3', type: 'image', name: 'INSPIRATION_image_hero', label: 'Image d\'ambiance', order: 2 },
      { id: 'insp_4', type: 'liste', name: 'INSPIRATION_liste_lieux_1_6', label: 'POIs 1-6 (noms)', order: 3, list_size: 6 },
      { id: 'insp_5', type: 'liste', name: 'INSPIRATION_liste_descriptions_1_6', label: 'Descriptions courtes 1-6', order: 4, list_size: 6 },
      { id: 'insp_6', type: 'liste', name: 'INSPIRATION_liste_images_1_6', label: 'Images 1-6', order: 5, list_size: 6 },
    ],
  },
  {
    name: 'SAISON',
    description: 'Page décrivant une saison dans la destination',
    fields: [
      { id: 'sais_1', type: 'titre', name: 'SAISON_titre_nom', label: 'Nom de la saison', order: 0, max_chars: 50 },
      { id: 'sais_2', type: 'titre', name: 'SAISON_titre_periode', label: 'Période', order: 1, max_chars: 80 },
      { id: 'sais_3', type: 'texte', name: 'SAISON_texte_description', label: 'Description de la saison', order: 2, max_chars: 500 },
      { id: 'sais_4', type: 'image', name: 'SAISON_image_ambiance', label: 'Image d\'ambiance', order: 3 },
      { id: 'sais_5', type: 'meta', name: 'SAISON_meta_temperature', label: 'Températures', order: 4, max_chars: 50 },
      { id: 'sais_6', type: 'meta', name: 'SAISON_meta_precipitation', label: 'Précipitations', order: 5, max_chars: 50 },
      { id: 'sais_7', type: 'liste', name: 'SAISON_liste_activites_recommandees', label: 'Activités recommandées', order: 6, list_size: 4 },
      { id: 'sais_8', type: 'texte', name: 'SAISON_texte_conseil', label: 'Conseil pratique', order: 7, max_chars: 300 },
    ],
  },
  {
    name: 'ALLER_PLUS_LOIN',
    description: 'Page de ressources et liens complémentaires',
    fields: [
      { id: 'lien_1', type: 'titre', name: 'ALLER_PLUS_LOIN_titre_principal', label: 'Titre', order: 0, max_chars: 80 },
      { id: 'lien_2', type: 'texte', name: 'ALLER_PLUS_LOIN_texte_intro', label: 'Introduction', order: 1, max_chars: 300 },
      { id: 'lien_3', type: 'liste', name: 'ALLER_PLUS_LOIN_liste_ressources', label: 'Ressources utiles', order: 2, list_size: 8 },
      { id: 'lien_4', type: 'liste', name: 'ALLER_PLUS_LOIN_liste_sites_officiels', label: 'Sites officiels', order: 3, list_size: 5 },
      { id: 'lien_5', type: 'texte', name: 'ALLER_PLUS_LOIN_texte_apps_mobiles', label: 'Applications mobiles recommandées', order: 4, max_chars: 300 },
    ],
  },
  {
    name: 'A_PROPOS_RL',
    description: 'Page à propos de Region Lovers',
    fields: [
      { id: 'rl_1', type: 'titre', name: 'A_PROPOS_RL_titre_principal', label: 'Titre', order: 0, max_chars: 80 },
      { id: 'rl_2', type: 'texte', name: 'A_PROPOS_RL_texte_presentation', label: 'Présentation Region Lovers', order: 1, max_chars: 600 },
      { id: 'rl_3', type: 'image', name: 'A_PROPOS_RL_image_logo', label: 'Logo Region Lovers', order: 2 },
      { id: 'rl_4', type: 'texte', name: 'A_PROPOS_RL_texte_mission', label: 'Notre mission', order: 3, max_chars: 400 },
      { id: 'rl_5', type: 'liste', name: 'A_PROPOS_RL_liste_valeurs', label: 'Nos valeurs', order: 4, list_size: 4 },
      { id: 'rl_6', type: 'lien', name: 'A_PROPOS_RL_lien_site', label: 'Site web', order: 5 },
      { id: 'rl_7', type: 'lien', name: 'A_PROPOS_RL_lien_contact', label: 'Contact', order: 6 },
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
