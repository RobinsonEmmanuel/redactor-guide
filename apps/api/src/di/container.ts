import { Db } from 'mongodb';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';

/**
 * Conteneur d'injection de dépendances
 * 
 * Centralise la création et la gestion des instances de services.
 * Permet de faciliter les tests et de gérer les dépendances de manière propre.
 */
export class DIContainer {
  private services = new Map<string, any>();

  constructor(public readonly db: Db) {}

  /**
   * Service d'ingestion WordPress
   */
  getWordPressIngestionService(): WordPressIngestionService {
    if (!this.services.has('WordPressIngestionService')) {
      this.services.set(
        'WordPressIngestionService',
        new WordPressIngestionService(this.db)
      );
    }
    return this.services.get('WordPressIngestionService');
  }

  /**
   * Nettoyer toutes les ressources
   */
  async dispose(): Promise<void> {
    this.services.clear();
  }
}
