/**
 * GuideTranslationService
 * Traduit les champs content.text de toutes les pages d'un guide
 * et les sauvegarde dans content_translations.{lang} sur chaque page.
 *
 * Architecture :
 *  - 1 appel OpenAI par page (tous les champs texte de la page en un seul JSON)
 *  - Batching si une page a > MAX_FIELDS_PER_CALL champs
 *  - Les marqueurs de style (**..**, {..}, ^..^, ~..~) sont préservés
 *  - Les URLs ne sont pas traduites
 *  - La progression est rapportée via callback après chaque page
 */
import OpenAI from 'openai';
import { Db, ObjectId } from 'mongodb';

const LANGUAGE_NAMES: Record<string, string> = {
  en:     'English (British)',
  de:     'Deutsch',
  it:     'Italiano',
  es:     'Español (castellano)',
  'pt-pt':'Português europeu',
  nl:     'Nederlands',
  da:     'Dansk',
  sv:     'Svenska',
};

const MAX_FIELDS_PER_CALL = 20;

export interface TranslationProgress {
  done: number;
  total: number;
}

export class GuideTranslationService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Traduit toutes les pages d'un guide dans la langue cible.
   * Sauvegarde le résultat dans pages.content_translations.{lang}.text
   */
  async translateGuide(
    guideId: string,
    targetLang: string,
    db: Db,
    onProgress?: (p: TranslationProgress) => Promise<void>
  ): Promise<{ translated: number; skipped: number; errors: number }> {
    const langName = LANGUAGE_NAMES[targetLang];
    if (!langName) throw new Error(`Langue inconnue : ${targetLang}`);

    // 1. Récupérer le chemin de fer
    const cdf = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
    if (!cdf) throw new Error('Chemin de fer non trouvé');

    // 2. Récupérer toutes les pages exportables
    const pages = await db
      .collection('pages')
      .find({ chemin_de_fer_id: cdf._id.toString() })
      .sort({ ordre: 1 })
      .toArray();

    const stats = { translated: 0, skipped: 0, errors: 0 };
    const total = pages.length;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const rawContent = page.content || {};

      // Extraire les champs texte traduisibles
      const toTranslate = this.extractTranslatableFields(rawContent);

      if (Object.keys(toTranslate).length === 0) {
        stats.skipped++;
      } else {
        try {
          const translated = await this.translateFields(toTranslate, targetLang, langName);
          // Sauvegarder sur la page
          await db.collection('pages').updateOne(
            { _id: new ObjectId(page._id) },
            {
              $set: {
                [`content_translations.${targetLang}.text`]: translated,
                [`content_translations.${targetLang}.translated_at`]: new Date(),
              },
            }
          );
          stats.translated++;
        } catch (err: any) {
          console.error(`❌ [TRANSLATE] Erreur page ${page._id}:`, err.message);
          stats.errors++;
        }
      }

      if (onProgress) {
        await onProgress({ done: i + 1, total }).catch(() => {});
      }
    }

    return stats;
  }

  /**
   * Extrait les champs texte traduisibles depuis page.content.
   *
   * - Champs texte bruts (non-URL, non-JSON) → inclus tel quel
   * - Champs JSON lien {label, url} → seul le label est extrait sous la même clé
   *   (l'URL est préservée ; elle sera résolue à l'export par urlResolver)
   * - URLs directes, tableaux JSON, champs non-string → exclus
   */
  private extractTranslatableFields(content: Record<string, any>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(content)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value !== 'string') continue;

      const str = value.trim();
      if (!str) continue;

      // Exclure les URLs directes
      if (/^https?:\/\//i.test(str)) continue;

      // Champ JSON lien structuré {label, url} → extraire le label
      if (str.startsWith('{')) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed.label === 'string' && parsed.label.trim()) {
            result[key] = parsed.label.trim();
          }
        } catch { /* JSON invalide → ignorer */ }
        continue;
      }

      // Exclure les tableaux JSON (repetitif sérialisé…)
      if (str.startsWith('[')) continue;

      result[key] = str;
    }

    return result;
  }

  /**
   * Traduit un dictionnaire de champs via OpenAI.
   * Si le nombre de champs dépasse MAX_FIELDS_PER_CALL, découpe en batches.
   */
  private async translateFields(
    fields: Record<string, string>,
    targetLang: string,
    langName: string
  ): Promise<Record<string, string>> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return {};

    const result: Record<string, string> = {};

    // Traiter par chunks si trop de champs
    for (let i = 0; i < keys.length; i += MAX_FIELDS_PER_CALL) {
      const batchKeys = keys.slice(i, i + MAX_FIELDS_PER_CALL);
      const batchInput: Record<string, string> = {};
      for (const k of batchKeys) batchInput[k] = fields[k];

      const batchResult = await this.translateBatch(batchInput, targetLang, langName);
      Object.assign(result, batchResult);
    }

    return result;
  }

  /**
   * Appel OpenAI pour traduire un batch de champs.
   * Format : JSON in → JSON out (mêmes clés, valeurs traduites).
   */
  private async translateBatch(
    fields: Record<string, string>,
    _targetLang: string,
    langName: string
  ): Promise<Record<string, string>> {
    const inputJson = JSON.stringify(fields, null, 2);

    const systemPrompt = `You are a professional travel guide translator. 
Translate the JSON values from French to ${langName}.

Rules:
- Return ONLY a valid JSON object with the same keys
- Translate only the values, never the keys
- Preserve ALL formatting markers exactly as-is: **bold**, {orange}, ^number^, ~gras-orange~
- Preserve line breaks (\\n) in their exact positions
- Do NOT translate or modify URLs (starting with http)
- Keep proper nouns, brand names, and place names as appropriate for the target language
- Be natural and idiomatic, not literal`;

    const userPrompt = `Translate to ${langName}:\n${inputJson}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('Pas de réponse OpenAI');

        const parsed = JSON.parse(content);

        // Vérifier que les clés correspondent
        const inputKeys = Object.keys(fields);
        const outputKeys = Object.keys(parsed);
        const missingKeys = inputKeys.filter(k => !outputKeys.includes(k));
        if (missingKeys.length > 0) {
          console.warn(`⚠️ [TRANSLATE] Clés manquantes: ${missingKeys.join(', ')} — utilisation du texte original`);
          for (const k of missingKeys) parsed[k] = fields[k];
        }

        return parsed as Record<string, string>;
      } catch (err: any) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    return fields; // fallback : retourner l'original si tout échoue
  }
}
