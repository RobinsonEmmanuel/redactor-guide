import { MongoClient } from 'mongodb';
import { env } from '../src/config/env';

/**
 * Script pour créer l'index unique sur la collection image_analyses
 * Garantit qu'une URL d'image ne peut être analysée qu'une seule fois
 */
async function createIndexes() {
  console.log('🔧 Connexion à MongoDB...');
  const client = await MongoClient.connect(env.MONGODB_URI);
  const db = client.db(env.MONGODB_DB_NAME);

  console.log('📊 Création des index pour image_analyses...');

  try {
    // Index unique sur l'URL
    await db.collection('image_analyses').createIndex(
      { url: 1 },
      { 
        unique: true,
        name: 'url_unique'
      }
    );
    console.log('✅ Index unique créé sur "url"');

    // Index sur analyzed_at pour tri chronologique
    await db.collection('image_analyses').createIndex(
      { analyzed_at: -1 },
      { name: 'analyzed_at_desc' }
    );
    console.log('✅ Index créé sur "analyzed_at"');

    // Index sur reuse_count pour statistiques
    await db.collection('image_analyses').createIndex(
      { reuse_count: -1 },
      { name: 'reuse_count_desc' }
    );
    console.log('✅ Index créé sur "reuse_count"');

    // Afficher les statistiques
    const totalImages = await db.collection('image_analyses').countDocuments();
    const reusedImages = await db.collection('image_analyses').countDocuments({ 
      reuse_count: { $gt: 0 } 
    });

    console.log('');
    console.log('📊 Statistiques:');
    console.log(`   Total images en cache: ${totalImages}`);
    console.log(`   Images réutilisées: ${reusedImages}`);
    
    if (totalImages > 0) {
      const savings = reusedImages * 0.005;
      console.log(`   Économie estimée: $${savings.toFixed(3)}`);
    }

  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('');
    console.log('✅ Terminé !');
  }
}

createIndexes().catch(console.error);
