/**
 * seed-field-services.js
 *
 * Enregistre les FieldServices natifs dans la collection `field_services`.
 * Utilise un upsert sur service_id → safe à rejouer plusieurs fois.
 *
 * Usage :
 *   MONGODB_URI="mongodb+srv://..." node scripts/seed-field-services.js
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

const SERVICES = [
  {
    service_id: 'sommaire_generator',
    label: 'Générateur de sommaire',
    description:
      'Construit automatiquement la table des matières du guide à partir du chemin de fer. ' +
      'Liste toutes les sections avec leur numéro de page, et pour chaque section de type ' +
      '"Clusters et lieux", liste tous les clusters avec leur numéro de page. ' +
      'La valeur produite est un JSON structuré, destiné à être parsé par le script InDesign.',
    output_type: 'json',
    context_keys: ['all_pages', 'guide'],
    implemented: true,
    active: true,
  },
  {
    service_id: 'geocoding_maps_link',
    label: 'Lien Google Maps (géocodage)',
    description:
      'Géocode le nom du POI via Photon (OpenStreetMap) et construit une URL Google Maps ' +
      'à partir des coordonnées trouvées. Produit un JSON structuré {label, url}.',
    output_type: 'json',
    context_keys: ['guide', 'current_page'],
    implemented: true,
    active: true,
  },
  {
    service_id: 'inspiration_poi_cards',
    label: 'Cartes POI — Page Inspiration',
    description:
      'Génère automatiquement les N cartes POI d\'une page inspiration thématique. ' +
      'Pour chaque POI : sélectionne la meilleure image (image_analyses), réécrit le nom ' +
      'via IA, génère un hashtag, injecte l\'URL de l\'article WordPress et construit ' +
      'les liens Google Maps via géocodage. Produit un tableau JSON de cartes.',
    output_type: 'json',
    context_keys: ['guide', 'current_page', 'inspiration_pois'],
    implemented: true,
    active: true,
  },
];

async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = MONGODB_DB_NAME ? client.db(MONGODB_DB_NAME) : client.db();

  console.log(`🔌 Connecté à MongoDB : ${db.databaseName}`);

  for (const service of SERVICES) {
    const { service_id, ...rest } = service;
    const now = new Date().toISOString();

    const result = await db.collection('field_services').updateOne(
      { service_id },
      {
        $set: { ...rest, service_id, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      console.log(`✅ Créé        : ${service_id} — ${service.label}`);
    } else if (result.modifiedCount > 0) {
      console.log(`🔄 Mis à jour  : ${service_id} — ${service.label}`);
    } else {
      console.log(`⏭️  Inchangé   : ${service_id} — ${service.label}`);
    }
  }

  await client.close();
  console.log('\n✅ Seed terminé.');
}

seed().catch((err) => {
  console.error('❌ Erreur seed:', err);
  process.exit(1);
});
