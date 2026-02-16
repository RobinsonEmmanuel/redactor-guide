import OpenAI from 'openai';

interface TranslationResult {
  success: boolean;
  translatedJson?: any;
  error?: string;
  stats: {
    totalFields: number;
    translatedFields: number;
    errors: number;
    retries: number;
  };
}

interface FieldToTranslate {
  path: string[];
  value: string;
}

export class JsonTranslatorService {
  private client: OpenAI;
  private readonly BATCH_SIZE = 10; // Traduire 10 champs à la fois
  private readonly MAX_RETRIES = 3;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Traduit tous les champs "value" d'un JSON en anglais
   */
  async translateJson(jsonData: any): Promise<TranslationResult> {
    const stats = {
      totalFields: 0,
      translatedFields: 0,
      errors: 0,
      retries: 0,
    };

    try {
      // 1. Extraire tous les champs "value" à traduire
      const fieldsToTranslate = this.extractValueFields(jsonData);
      stats.totalFields = fieldsToTranslate.length;

      console.log(`📋 ${stats.totalFields} champs "value" à traduire`);

      // 2. Traduire par batches
      const translatedValues = new Map<string, string>();
      
      for (let i = 0; i < fieldsToTranslate.length; i += this.BATCH_SIZE) {
        const batch = fieldsToTranslate.slice(i, i + this.BATCH_SIZE);
        const batchNum = Math.floor(i / this.BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(fieldsToTranslate.length / this.BATCH_SIZE);
        
        console.log(`🔄 Batch ${batchNum}/${totalBatches} (${batch.length} champs)`);

        // Traduire le batch avec retry
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
          try {
            const translations = await this.translateBatch(batch);
            
            // Stocker les traductions
            batch.forEach((field, idx) => {
              const pathKey = field.path.join('.');
              translatedValues.set(pathKey, translations[idx]);
            });
            
            stats.translatedFields += batch.length;
            if (attempt > 1) stats.retries += (attempt - 1);
            
            console.log(`✅ Batch ${batchNum} traduit (tentative ${attempt})`);
            break;
          } catch (error: any) {
            console.error(`❌ Erreur batch ${batchNum}, tentative ${attempt}:`, error.message);
            
            if (attempt === this.MAX_RETRIES) {
              stats.errors += batch.length;
              console.error(`⚠️ Batch ${batchNum} échoué après ${this.MAX_RETRIES} tentatives`);
            } else {
              // Attendre avant retry (backoff exponentiel)
              await this.sleep(1000 * attempt);
            }
          }
        }
      }

      // 3. Appliquer les traductions au JSON
      const translatedJson = this.applyTranslations(jsonData, translatedValues);

      // 4. Valider le JSON final
      const isValid = this.validateJsonStructure(jsonData, translatedJson);
      
      if (!isValid) {
        throw new Error('Validation échouée : structure JSON modifiée');
      }

      console.log('✅ Traduction terminée avec succès');
      console.log(`   Traduits: ${stats.translatedFields}/${stats.totalFields}`);
      console.log(`   Erreurs: ${stats.errors}`);
      console.log(`   Retries: ${stats.retries}`);

      return {
        success: true,
        translatedJson,
        stats,
      };
    } catch (error: any) {
      console.error('❌ Erreur traduction:', error);
      return {
        success: false,
        error: error.message,
        stats,
      };
    }
  }

  /**
   * Extrait tous les champs "value" du JSON avec leur chemin
   */
  private extractValueFields(obj: any, path: string[] = []): FieldToTranslate[] {
    const fields: FieldToTranslate[] = [];

    if (typeof obj !== 'object' || obj === null) {
      return fields;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        fields.push(...this.extractValueFields(item, [...path, index.toString()]));
      });
    } else {
      Object.entries(obj).forEach(([key, value]) => {
        if (key === 'value') {
          if (typeof value === 'string' && value.trim() && !this.isUrl(value)) {
            // Champ "value" string à traduire (sauf URLs)
            fields.push({ path: [...path, key], value });
          } else if (Array.isArray(value)) {
            // Champ "value" array : gérer strings et objets
            value.forEach((item, idx) => {
              if (typeof item === 'string' && item.trim() && !this.isUrl(item)) {
                // String à traduire (sauf URLs)
                fields.push({ 
                  path: [...path, key, idx.toString()], 
                  value: item 
                });
              } else if (typeof item === 'object' && item !== null) {
                // Objet dans l'array : extraire récursivement les strings
                fields.push(...this.extractValueFields(item, [...path, key, idx.toString()]));
              }
            });
          }
        } else if (typeof value === 'object') {
          // Continuer la récursion
          fields.push(...this.extractValueFields(value, [...path, key]));
        }
      });
    }

    return fields;
  }

  /**
   * Détecte si une chaîne est une URL
   */
  private isUrl(str: string): boolean {
    if (!str) return false;
    
    // Détection simple mais robuste des URLs
    const urlPattern = /^(https?:\/\/|www\.)/i;
    return urlPattern.test(str.trim());
  }

  /**
   * Traduit un batch de champs via ChatGPT
   */
  private async translateBatch(fields: FieldToTranslate[]): Promise<string[]> {
    // Construire le prompt avec tous les champs du batch
    const valuesToTranslate = fields.map((f, idx) => `${idx + 1}. ${f.value}`).join('\n');

    const prompt = `Tu es un traducteur professionnel français → anglais.

Traduis les phrases suivantes en anglais britannique.
Règles STRICTES:
- Conserve le format exact (durées, unités, etc.)
- Pour les durées: "30 min à 1h" → "30 min to 1h"
- Pour les unités: "4km2" → "4km2" (inchangé)
- Sois naturel et fluide
- Réponds UNIQUEMENT avec les traductions numérotées, rien d'autre

Phrases à traduire:
${valuesToTranslate}

Format de réponse attendu:
1. [traduction anglaise de la phrase 1]
2. [traduction anglaise de la phrase 2]
...`;

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un traducteur professionnel français → anglais. Tu réponds uniquement avec les traductions, ligne par ligne, numérotées.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Faible pour cohérence
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Pas de réponse de ChatGPT');
    }

    // Parser les traductions
    const translations = this.parseTranslations(content, fields.length);
    
    if (translations.length !== fields.length) {
      throw new Error(`Nombre de traductions incorrect: ${translations.length} au lieu de ${fields.length}`);
    }

    return translations;
  }

  /**
   * Parse les traductions depuis la réponse ChatGPT
   */
  private parseTranslations(content: string, _expectedCount: number): string[] {
    const lines = content.split('\n').filter(l => l.trim());
    const translations: string[] = [];

    for (const line of lines) {
      // Formats acceptés: "1. translation" ou "1) translation"
      const match = line.match(/^\d+[.)]\s*(.+)$/);
      if (match) {
        translations.push(match[1].trim());
      }
    }

    return translations;
  }

  /**
   * Applique les traductions au JSON original
   */
  private applyTranslations(obj: any, translations: Map<string, string>): any {
    return this.applyTranslationsRecursive(obj, [], translations);
  }

  private applyTranslationsRecursive(
    obj: any,
    path: string[],
    translations: Map<string, string>
  ): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item, index) =>
        this.applyTranslationsRecursive(item, [...path, index.toString()], translations)
      );
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'value') {
        if (typeof value === 'string') {
          // String simple : appliquer traduction directe (URLs restent inchangées)
          const pathKey = [...path, key].join('.');
          result[key] = translations.get(pathKey) || value;
        } else if (Array.isArray(value)) {
          // Array : appliquer traduction pour strings et récursion pour objets
          result[key] = value.map((item, idx) => {
            if (typeof item === 'string') {
              // String : appliquer traduction (URLs restent inchangées)
              const pathKey = [...path, key, idx.toString()].join('.');
              return translations.get(pathKey) || item;
            } else if (typeof item === 'object' && item !== null) {
              // Objet : appliquer récursivement les traductions
              return this.applyTranslationsRecursive(item, [...path, key, idx.toString()], translations);
            }
            return item;
          });
        } else {
          result[key] = value;
        }
      } else if (typeof value === 'object') {
        result[key] = this.applyTranslationsRecursive(value, [...path, key], translations);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Valide que la structure JSON n'a pas été modifiée
   */
  private validateJsonStructure(original: any, translated: any): boolean {
    try {
      // Vérifier que c'est du JSON valide
      JSON.stringify(translated);

      // Vérifier que le nombre de clés est identique
      const originalKeys = this.countKeys(original);
      const translatedKeys = this.countKeys(translated);

      if (originalKeys !== translatedKeys) {
        console.error(`❌ Nombre de clés différent: ${originalKeys} → ${translatedKeys}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ JSON invalide:', error);
      return false;
    }
  }

  private countKeys(obj: any): number {
    if (typeof obj !== 'object' || obj === null) return 0;
    
    let count = 0;
    if (Array.isArray(obj)) {
      obj.forEach(item => count += this.countKeys(item));
    } else {
      count += Object.keys(obj).length;
      Object.values(obj).forEach(value => count += this.countKeys(value));
    }
    
    return count;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
