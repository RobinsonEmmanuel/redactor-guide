import { MongoClient, Db } from 'mongodb';
import { env } from './env.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDatabase(): Promise<Db> {
  if (db) return db;

  console.log('🔌 [ingestion-service] Connexion à MongoDB...');
  client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  await client.db('admin').command({ ping: 1 });
  db = client.db(env.MONGODB_DB_NAME);
  console.log(`✅ [ingestion-service] Connecté à MongoDB: ${env.MONGODB_DB_NAME}`);
  return db;
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

process.on('SIGINT', async () => { await disconnectDatabase(); process.exit(0); });
process.on('SIGTERM', async () => { await disconnectDatabase(); process.exit(0); });
