import { Guide, GuideSchema } from '@redactor-guide/core-model';
import { z } from 'zod';

/**
 * Résultat de validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Interface du validateur de guides
 */
export interface IGuideValidator {
  validate(guide: Guide): Promise<ValidationResult>;
  validateStructure(guide: unknown): ValidationResult;
}

/**
 * Validateur métier de guides
 * 
 * Responsabilités :
 * - Valider la structure avec Zod
 * - Valider les règles métier
 * - Retourner des messages d'erreur clairs
 */
export class GuideValidator implements IGuideValidator {
  constructor() {}

  /**
   * Validation complète d'un guide
   */
  async validate(guide: Guide): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // Validation de structure
    const structureValidation = this.validateStructure(guide);
    if (!structureValidation.isValid) {
      return structureValidation;
    }

    // Règles métier
    this.validateBusinessRules(guide, result);

    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Validation de structure avec Zod
   */
  validateStructure(guide: unknown): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      GuideSchema.parse(guide);
    } catch (error) {
      if (error instanceof z.ZodError) {
        result.isValid = false;
        result.errors = error.errors.map(
          (err) => `${err.path.join('.')}: ${err.message}`
        );
      } else {
        result.isValid = false;
        result.errors = ['Erreur de validation inconnue'];
      }
    }

    return result;
  }

  /**
   * Validation des règles métier
   */
  private validateBusinessRules(
    guide: Guide,
    result: ValidationResult
  ): void {
    // Règle : un guide doit avoir au moins une destination
    if (guide.destinations.length === 0) {
      result.errors.push('Le guide doit contenir au moins une destination');
    }

    // Règle : l'année ne peut pas être dans le futur de plus de 2 ans
    const maxYear = new Date().getFullYear() + 2;
    if (guide.year > maxYear) {
      result.errors.push(
        `L'année du guide ne peut pas dépasser ${maxYear}`
      );
    }

    // Warning : un guide en statut published devrait avoir une date de publication
    if (guide.status === 'published' && !guide.publishedAt) {
      result.warnings.push(
        'Un guide publié devrait avoir une date de publication'
      );
    }
  }
}
