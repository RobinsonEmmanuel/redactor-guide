import { Db } from 'mongodb';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';
import { ImageAnalysisService } from '../services/image-analysis.service';
import { env } from '../config/env';

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
      const wpService = new WordPressIngestionService(this.db);
      
      // Injecter le callback d'analyse d'images
      const openaiApiKey = env.OPENAI_API_KEY;
      if (openaiApiKey) {
        const imageAnalysisService = new ImageAnalysisService(openaiApiKey);
        wpService.setImageAnalysisCallback(
          (imageUrls, analysisPrompt) => imageAnalysisService.analyzeImages(imageUrls, analysisPrompt)
        );
      }
      
      this.services.set('WordPressIngestionService', wpService);
    }
    return this.services.get('WordPressIngestionService');
  }

  /**
   * Service d'analyse d'images
   */
  getImageAnalysisService(): ImageAnalysisService | null {
    const openaiApiKey = env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return null;
    }
    
    if (!this.services.has('ImageAnalysisService')) {
      this.services.set(
        'ImageAnalysisService',
        new ImageAnalysisService(openaiApiKey)
      );
    }
    return this.services.get('ImageAnalysisService');
  }

  /**
   * Nettoyer toutes les ressources
   */
  async dispose(): Promise<void> {
    this.services.clear();
  }
}
