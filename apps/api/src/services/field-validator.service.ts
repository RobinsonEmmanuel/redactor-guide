import type { TemplateField } from '@redactor-guide/core-model';

export interface ValidationError {
  field: string;
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Service de validation des champs selon les règles définies dans les templates
 */
export class FieldValidatorService {
  /**
   * Valide un contenu généré selon les règles du template
   */
  validateContent(
    content: Record<string, any>,
    fields: TemplateField[]
  ): ValidationResult {
    const errors: ValidationError[] = [];

    for (const field of fields) {
      if (!field.validation) {
        continue; // Pas de règles = validation passée
      }

      const fieldErrors = this.validateField(
        field.name,
        content[field.name],
        field.validation,
        field.type
      );

      if (fieldErrors.length > 0) {
        errors.push({
          field: field.name,
          errors: fieldErrors,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Valide un champ spécifique
   */
  private validateField(
    fieldName: string,
    value: any,
    rules: any,
    fieldType: string
  ): string[] {
    const errors: string[] = [];

    // Required
    if (rules.required && (!value || String(value).trim() === '')) {
      errors.push(
        rules.messages?.required || `Le champ ${fieldName} est obligatoire`
      );
      return errors; // Si requis et vide, pas besoin de tester autres règles
    }

    // Si le champ est vide et non requis, validation OK
    if (!value || String(value).trim() === '') {
      return errors;
    }

    const strValue = String(value);

    // Max length
    if (rules.max_length && strValue.length > rules.max_length) {
      errors.push(
        rules.messages?.max_length ||
          `Le champ ${fieldName} ne doit pas dépasser ${rules.max_length} caractères (actuel: ${strValue.length})`
      );
    }

    // Min length
    if (rules.min_length && strValue.length < rules.min_length) {
      errors.push(
        rules.messages?.min_length ||
          `Le champ ${fieldName} doit contenir au moins ${rules.min_length} caractères (actuel: ${strValue.length})`
      );
    }

    // Sentence count (pour les champs texte)
    if (rules.sentence_count && (fieldType === 'texte' || fieldType === 'titre')) {
      const sentenceCount = this.countSentences(strValue);
      if (sentenceCount !== rules.sentence_count) {
        errors.push(
          rules.messages?.sentence_count ||
            `Le champ ${fieldName} doit contenir exactement ${rules.sentence_count} phrase(s) (actuel: ${sentenceCount})`
        );
      }
    }

    // Forbidden words
    if (
      rules.forbidden_words &&
      Array.isArray(rules.forbidden_words) &&
      (fieldType === 'texte' || fieldType === 'titre')
    ) {
      const foundWords = this.findForbiddenWords(strValue, rules.forbidden_words);
      if (foundWords.length > 0) {
        errors.push(
          rules.messages?.forbidden_words ||
            `Le champ ${fieldName} contient des mots interdits: ${foundWords.join(', ')}`
        );
      }
    }

    // Forbidden patterns
    if (
      rules.forbidden_patterns &&
      Array.isArray(rules.forbidden_patterns) &&
      (fieldType === 'texte' || fieldType === 'titre')
    ) {
      const foundPatterns = this.findForbiddenPatterns(
        strValue,
        rules.forbidden_patterns
      );
      if (foundPatterns.length > 0) {
        errors.push(
          rules.messages?.forbidden_patterns ||
            `Le champ ${fieldName} contient des patterns interdits: ${foundPatterns.join(', ')}`
        );
      }
    }

    // Forbidden temporal terms
    if (
      rules.forbidden_temporal_terms &&
      Array.isArray(rules.forbidden_temporal_terms) &&
      (fieldType === 'texte' || fieldType === 'titre')
    ) {
      const foundTerms = this.findForbiddenWords(
        strValue,
        rules.forbidden_temporal_terms
      );
      if (foundTerms.length > 0) {
        errors.push(
          rules.messages?.forbidden_temporal_terms ||
            `Le champ ${fieldName} contient des termes temporels interdits: ${foundTerms.join(', ')}`
        );
      }
    }

    return errors;
  }

  /**
   * Compte le nombre de phrases dans un texte
   */
  private countSentences(text: string): number {
    // Détection de phrases par .?!
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.length;
  }

  /**
   * Trouve les mots interdits présents dans le texte
   */
  private findForbiddenWords(text: string, forbiddenWords: string[]): string[] {
    const lowerText = text.toLowerCase();
    return forbiddenWords.filter((word) =>
      lowerText.includes(word.toLowerCase())
    );
  }

  /**
   * Trouve les patterns interdits présents dans le texte
   */
  private findForbiddenPatterns(text: string, patterns: string[]): string[] {
    const found: string[] = [];
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(text)) {
          found.push(pattern);
        }
      } catch (err) {
        // Pattern regex invalide, test en tant que string simple
        if (text.includes(pattern)) {
          found.push(pattern);
        }
      }
    }
    return found;
  }

  /**
   * Formate les erreurs pour un prompt de retry
   */
  formatErrorsForRetry(errors: ValidationError[]): string {
    return errors
      .map((err) => {
        const fieldErrors = err.errors.map((e) => `  - ${e}`).join('\n');
        return `Champ "${err.field}":\n${fieldErrors}`;
      })
      .join('\n\n');
  }

  /**
   * Extrait les noms des champs en erreur
   */
  getFailedFields(errors: ValidationError[]): string[] {
    return errors.map((err) => err.field);
  }
}
