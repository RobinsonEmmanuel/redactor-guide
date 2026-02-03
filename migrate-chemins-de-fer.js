/**
 * Script de migration : Ajouter les chemins de fer manquants aux guides existants
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

async function migrate() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const dbName = process.env.MONGODB_DB_NAME || 'redactor_guide';
    const db = client.db(dbName);
    console.log(`📁 Base de données: ${dbName}`);

    // Récupérer tous les guides
    const guides = await db.collection('guides').find({}).toArray();
    console.log(`📋 ${guides.length} guides trouvés`);

    for (const guide of guides) {
      const guideId = guide._id.toString();

      // Vérifier si un chemin de fer existe déjà
      const existingCDF = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });

      if (existingCDF) {
        console.log(`⏭️  Guide "${guide.name}" a déjà un chemin de fer`);
        continue;
      }

      // Créer le chemin de fer
      const now = new Date().toISOString();
      const cheminDeFer = {
        guide_id: guideId,
        nom: guide.name,
        version: guide.version,
        nombre_pages: 0,
        created_at: now,
        updated_at: now,
      };

      await db.collection('chemins_de_fer').insertOne(cheminDeFer);
      console.log(`✅ Chemin de fer créé pour "${guide.name}"`);
    }

    console.log('\n🎉 Migration terminée !');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await client.close();
  }
}

migrate();
