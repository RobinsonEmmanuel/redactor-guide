import { connectDatabase, connectArticlesDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { createServer } from './server.js';

async function bootstrap() {
  try {
    console.log('🚀 Démarrage de Redactor Guide — Ingestion Service...');
    console.log(`📊 Environnement: ${env.NODE_ENV}`);
    console.log(`🔌 Port: ${env.PORT}`);

    const db = await connectDatabase();
    console.log(`📦 Base de données principale: ${db.databaseName}`);
    const articlesDb = await connectArticlesDatabase();
    console.log(`📦 Base articles_raw: ${articlesDb.databaseName}`);

    const server = await createServer(db, env.PORT);
    await server.listen({ port: env.PORT, host: '0.0.0.0' });

    console.log('');
    console.log('✨ Ingestion Service démarré avec succès !');
    console.log('');
    console.log('📍 Endpoints disponibles:');
    console.log(`   - http://localhost:${env.PORT}/health`);
    console.log(`   - http://localhost:${env.PORT}/api/v1/ingest`);
    console.log(`   - http://localhost:${env.PORT}/api/v1/ingest/enqueue`);
    console.log(`   - http://localhost:${env.PORT}/api/v1/ingest/single-url`);
    console.log('');
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    await disconnectDatabase();
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => { console.error('❌ Unhandled Rejection:', reason); process.exit(1); });
process.on('uncaughtException', (error) => { console.error('❌ Uncaught Exception:', error); process.exit(1); });

bootstrap();
