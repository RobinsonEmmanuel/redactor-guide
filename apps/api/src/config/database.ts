import { MongoClient, Db } from 'mongodb';
import { env } from './env';

let client: MongoClient | null = null;
let db: Db | null = null;

/** Base de données source de vérité pour articles_raw (service-redaction). */
let articlesDb: Db | null = null;

/**
 * Connexion à MongoDB
 */
export async function connectDatabase(): Promise<Db> {
  if (db) {
    return db;
  }

  try {
    console.log('🔌 Connexion à MongoDB...');
    
    client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    });
    
    await client.connect();
    
    // Vérifier la connexion
    await client.db('admin').command({ ping: 1 });
    
    db = client.db(env.MONGODB_DB_NAME);
    
    console.log(`✅ Connecté à MongoDB: ${env.MONGODB_DB_NAME}`);
    
    return db;
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error);
    throw error;
  }
}

/**
 * Connexion à la base articles (service-redaction).
 * Réutilise le même MongoClient ; doit être appelé après connectDatabase().
 */
export async function connectArticlesDatabase(): Promise<Db> {
  if (articlesDb) {
    return articlesDb;
  }
  if (!client) {
    throw new Error('Appelez connectDatabase() avant connectArticlesDatabase().');
  }
  articlesDb = client.db(env.ARTICLES_DB_NAME);
  console.log(`✅ Base articles_raw : ${env.ARTICLES_DB_NAME}`);
  return articlesDb;
}

/**
 * Déconnexion de MongoDB
 */
export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    articlesDb = null;
    console.log('✅ Déconnecté de MongoDB');
  }
}

/**
 * Récupérer l'instance de la base de données principale
 */
export function getDatabase(): Db {
  if (!db) {
    throw new Error(
      'Base de données non connectée. Appelez connectDatabase() d\'abord.'
    );
  }
  return db;
}

/**
 * Récupérer la base de données articles_raw (service-redaction).
 * Utilisé par les routes et services qui lisent/écrivent dans articles_raw.
 */
export function getArticlesDatabase(): Db {
  if (!articlesDb) {
    throw new Error(
      'Base articles non connectée. Appelez connectArticlesDatabase() d\'abord.'
    );
  }
  return articlesDb;
}

/**
 * Gestion propre de l'arrêt
 */
process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectDatabase();
  process.exit(0);
});
