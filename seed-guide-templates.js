/**
 * Script de seed pour créer les templates de guides par défaut
 * Usage: node seed-guide-templates.js
 */

const { MongoClient } = require('mongodb');

// Configuration MongoDB (à adapter selon votre environnement)
const MONGO_URL = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'redactor-guide';

// Template par défaut : Guide Complet
const DEFAULT_GUIDE_TEMPLATES = [
  {
    name: 'Guide Complet',
    slug: 'guide-complet',
    description: 'Guide complet avec toutes les sections : couverture, présentation, lieux par zones, inspirations, saisons, et pages finales',
    is_default: true,
    structure: [
      // Pages fixes de début
      { type: 'fixed_page', template_name: 'COUVERTURE', ordre: 1 },
      { type: 'fixed_page', template_name: 'PRESENTATION_GUIDE', ordre: 2 },
      { type: 'fixed_page', template_name: 'PRESENTATION_DESTINATION', ordre: 3 },
      { type: 'fixed_page', template_name: 'CARTE_DESTINATION', ordre: 4 },
      
      // Section dynamique : Lieux par zones (clusters)
      {
        type: 'section',
        name: 'lieux_par_zones',
        ordre: 5,
        source: 'clusters',
        section_title: 'Lieux par zones',
        description: 'Présentation des lieux organisés par zones géographiques (clusters). Pour chaque cluster : 1 page intro + 1 page par POI.',
      },
      
      // Section dynamique : Inspirations
      {
        type: 'section',
        name: 'inspirations',
        ordre: 6,
        source: 'inspirations',
        pois_per_page: 6,
        section_title: 'Inspirations',
        description: 'Idées de visite thématiques avec 6 POIs par page.',
      },
      
      // Section fixe : Les saisons
      {
        type: 'section',
        name: 'saisons',
        ordre: 7,
        source: 'none',
        pages_count: 4,
        template_name: 'SAISON',
        section_title: 'Les saisons de la destination',
        description: 'Présentation des 4 saisons (printemps, été, automne, hiver).',
      },
      
      // Pages fixes de fin
      { type: 'fixed_page', template_name: 'ALLER_PLUS_LOIN', ordre: 8 },
      { type: 'fixed_page', template_name: 'A_PROPOS_RL', ordre: 9 },
    ],
  },
  {
    name: 'Guide Compact',
    slug: 'guide-compact',
    description: 'Guide compact sans la section saisons, idéal pour les destinations à climat constant',
    is_default: false,
    structure: [
      // Pages fixes de début
      { type: 'fixed_page', template_name: 'COUVERTURE', ordre: 1 },
      { type: 'fixed_page', template_name: 'PRESENTATION_GUIDE', ordre: 2 },
      { type: 'fixed_page', template_name: 'PRESENTATION_DESTINATION', ordre: 3 },
      { type: 'fixed_page', template_name: 'CARTE_DESTINATION', ordre: 4 },
      
      // Section dynamique : Lieux par zones (clusters)
      {
        type: 'section',
        name: 'lieux_par_zones',
        ordre: 5,
        source: 'clusters',
        section_title: 'Lieux par zones',
        description: 'Présentation des lieux organisés par zones géographiques (clusters). Pour chaque cluster : 1 page intro + 1 page par POI.',
      },
      
      // Section dynamique : Inspirations
      {
        type: 'section',
        name: 'inspirations',
        ordre: 6,
        source: 'inspirations',
        pois_per_page: 6,
        section_title: 'Inspirations',
        description: 'Idées de visite thématiques avec 6 POIs par page.',
      },
      
      // Pages fixes de fin
      { type: 'fixed_page', template_name: 'ALLER_PLUS_LOIN', ordre: 7 },
      { type: 'fixed_page', template_name: 'A_PROPOS_RL', ordre: 8 },
    ],
  },
  {
    name: 'Guide Thématique',
    slug: 'guide-thematique',
    description: 'Guide focalisé sur les inspirations, sans organisation par zones géographiques',
    is_default: false,
    structure: [
      // Pages fixes de début
      { type: 'fixed_page', template_name: 'COUVERTURE', ordre: 1 },
      { type: 'fixed_page', template_name: 'PRESENTATION_GUIDE', ordre: 2 },
      { type: 'fixed_page', template_name: 'PRESENTATION_DESTINATION', ordre: 3 },
      { type: 'fixed_page', template_name: 'CARTE_DESTINATION', ordre: 4 },
      
      // Section dynamique : Inspirations (uniquement)
      {
        type: 'section',
        name: 'inspirations',
        ordre: 5,
        source: 'inspirations',
        pois_per_page: 6,
        section_title: 'Inspirations',
        description: 'Idées de visite thématiques avec 6 POIs par page.',
      },
      
      // Pages fixes de fin
      { type: 'fixed_page', template_name: 'ALLER_PLUS_LOIN', ordre: 6 },
      { type: 'fixed_page', template_name: 'A_PROPOS_RL', ordre: 7 },
    ],
  },
];

async function seedGuideTemplates() {
  const client = new MongoClient(MONGO_URL);

  try {
    console.log('🔗 Connexion à MongoDB...');
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(DB_NAME);
    const guideTemplatesCollection = db.collection('guide_templates');

    // Vérifier combien de templates existent déjà
    const existingCount = await guideTemplatesCollection.countDocuments();
    console.log(`📊 Templates de guides existants : ${existingCount}`);

    if (existingCount > 0) {
      console.log('⚠️  Des templates de guides existent déjà. Voulez-vous continuer ?');
      console.log('   Les templates avec le même slug seront ignorés.');
    }

    let created = 0;
    let skipped = 0;

    for (const template of DEFAULT_GUIDE_TEMPLATES) {
      // Vérifier si le template existe déjà
      const existing = await guideTemplatesCollection.findOne({ slug: template.slug });

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

      await guideTemplatesCollection.insertOne(templateDoc);
      console.log(`✅ Template "${template.name}" créé avec ${template.structure.length} blocs`);
      created++;
    }

    console.log('\n📊 Résumé :');
    console.log(`   ✅ ${created} templates de guides créés`);
    console.log(`   ⏭️  ${skipped} templates ignorés (déjà existants)`);
    console.log(`   📦 Total dans la base : ${await guideTemplatesCollection.countDocuments()}`);

  } catch (error) {
    console.error('❌ Erreur lors du seed :', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Connexion fermée');
  }
}

// Exécuter le seed
seedGuideTemplates();
