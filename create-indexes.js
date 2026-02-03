/**
 * Script pour créer les index MongoDB optimisés
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'redactor_guide';

async function createIndexes() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(DB_NAME);
    console.log(`📁 Base de données: ${DB_NAME}`);

    // Index pour articles_raw
    console.log('\n📋 Création des index pour articles_raw...');
    
    // Index principal : site_id (pour filtrer par guide)
    await db.collection('articles_raw').createIndex(
      { site_id: 1 },
      { name: 'idx_site_id' }
    );
    console.log('  ✅ Index créé : site_id');

    // Index composé : site_id + updated_at (pour tri optimisé)
    await db.collection('articles_raw').createIndex(
      { site_id: 1, updated_at: -1 },
      { name: 'idx_site_updated' }
    );
    console.log('  ✅ Index créé : site_id + updated_at');

    // Index pour pages (chemin de fer)
    console.log('\n📋 Création des index pour pages...');
    
    // Index : chemin_de_fer_id + ordre
    await db.collection('pages').createIndex(
      { chemin_de_fer_id: 1, ordre: 1 },
      { name: 'idx_cdf_ordre' }
    );
    console.log('  ✅ Index créé : chemin_de_fer_id + ordre');

    // Index pour chemins_de_fer
    console.log('\n📋 Création des index pour chemins_de_fer...');
    
    // Index : guide_id (unique)
    await db.collection('chemins_de_fer').createIndex(
      { guide_id: 1 },
      { name: 'idx_guide_id', unique: true }
    );
    console.log('  ✅ Index créé : guide_id (unique)');

    // Afficher les index créés
    console.log('\n📊 Index existants :');
    
    const articlesIndexes = await db.collection('articles_raw').listIndexes().toArray();
    console.log('\n  articles_raw:');
    articlesIndexes.forEach(idx => console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}`));

    const pagesIndexes = await db.collection('pages').listIndexes().toArray();
    console.log('\n  pages:');
    pagesIndexes.forEach(idx => console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}`));

    const cdfIndexes = await db.collection('chemins_de_fer').listIndexes().toArray();
    console.log('\n  chemins_de_fer:');
    cdfIndexes.forEach(idx => console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}`));

    console.log('\n🎉 Index créés avec succès !');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await client.close();
  }
}

createIndexes();
