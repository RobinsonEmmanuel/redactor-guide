import { Db, Collection } from 'mongodb';
import { Guide, GuideSchema } from '@redactor-guide/core-model';

/**
 * Interface du service de construction de guides
 */
export interface IGuideBuilderService {
  buildGuide(guideId: string): Promise<Guide>;
  getGuideStatus(guideId: string): Promise<string>;
}

/**
 * Service de construction de guides
 * 
 * Responsabilités :
 * - Assembler les contenus pour créer un guide
 * - Gérer les étapes de construction
 * - Orchestrer les différents services (traduction, validation, export)
 * 
 * Note : Implémentation de base, à compléter avec la logique métier
 */
export class GuideBuilderService implements IGuideBuilderService {
  private guidesCollection: Collection<Guide>;

  /**
   * Injection de dépendances via constructeur
   */
  constructor(private readonly db: Db) {
    this.guidesCollection = this.db.collection<Guide>('guides');
  }

  /**
   * Construire un guide
   */
  async buildGuide(guideId: string): Promise<Guide> {
    const guide = await this.guidesCollection.findOne({ _id: guideId });

    if (!guide) {
      throw new Error(`Guide ${guideId} introuvable`);
    }

    // Validation avec Zod
    const validatedGuide = GuideSchema.parse(guide);

    // TODO: Logique de construction du guide
    // - Récupérer les destinations
    // - Appliquer les traductions
    // - Assembler le contenu
    // - Valider

    return validatedGuide;
  }

  /**
   * Obtenir le statut d'un guide
   */
  async getGuideStatus(guideId: string): Promise<string> {
    const guide = await this.guidesCollection.findOne(
      { _id: guideId },
      { projection: { status: 1 } }
    );

    if (!guide) {
      throw new Error(`Guide ${guideId} introuvable`);
    }

    return guide.status;
  }
}
