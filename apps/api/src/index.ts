import { connectDatabase, connectArticlesDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { createServer } from './server';

/**
 * Point d'entrée principal de l'application
 */
async function bootstrap() {
  try {
    console.log('🚀 Démarrage de Redactor Guide API...');
    console.log(`📊 Environnement: ${env.NODE_ENV}`);
    console.log(`🔌 Port: ${env.PORT}`);
    
    // Connexion à la base de données principale
    const db = await connectDatabase();
    console.log(`📦 Base de données: ${db.databaseName}`);

    // Connexion à la base articles_raw (service-redaction)
    await connectArticlesDatabase();
    
    // Créer et démarrer le serveur Fastify
    const server = await createServer(db, env.PORT);
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
    
    console.log('');
    console.log('✨ API démarrée avec succès !');
    console.log('');
    console.log('📍 Endpoints disponibles:');
    console.log(`   - http://localhost:${env.PORT}/`);
    console.log(`   - http://localhost:${env.PORT}/health`);
    console.log(`   - http://localhost:${env.PORT}/api/v1/guides`);
    console.log(`   - http://localhost:${env.PORT}/api/v1/destinations`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    await disconnectDatabase();
    process.exit(1);
  }
}

// Gestion des erreurs non catchées
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Démarrage
bootstrap();
