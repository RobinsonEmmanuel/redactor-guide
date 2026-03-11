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
import { parseLinkField } from '../utils/link-field.js';
import { COLLECTIONS } from '../config/collections.js';
import { DEFAULT_SETTINGS } from '../routes/settings.routes.js';

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

export interface OverflowWarning {
  page_id:        string;
  page_titre:     string;
  field_key:      string;
  lang:           string;
  current_length: number;
  max_chars:      number;
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
  ): Promise<{ translated: number; skipped: number; errors: number; overflow_warnings: OverflowWarning[] }> {
    const langName = LANGUAGE_NAMES[targetLang];
    if (!langName) throw new Error(`Langue inconnue : ${targetLang}`);

    // Charger les paramètres globaux (retry max)
    const settingsDoc = await db.collection(COLLECTIONS.settings).findOne({ _id: 'global' as any });
    const retryMax: number   = (settingsDoc as any)?.translation_retry_max ?? DEFAULT_SETTINGS.translation_retry_max;
    const alertEnabled: boolean = (settingsDoc as any)?.translation_overflow_alert ?? DEFAULT_SETTINGS.translation_overflow_alert;

    // 1. Récupérer le chemin de fer
    const cdf = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
    if (!cdf) throw new Error('Chemin de fer non trouvé');

    // 2. Récupérer uniquement les pages exportables (même filtre que l'export JSON)
    const EXPORTED_STATUSES = ['generee_ia', 'relue', 'validee', 'texte_coule', 'visuels_montes'];
    const allPages = await db
      .collection('pages')
      .find({ chemin_de_fer_id: cdf._id.toString() })
      .sort({ ordre: 1 })
      .toArray();
    const pages = allPages.filter((p: any) => EXPORTED_STATUSES.includes(p.statut_editorial));

    // Charger tous les templates distincts référencés par les pages (cache)
    const templateCache: Record<string, any> = {};
    for (const page of pages) {
      const tid = page.template_id?.toString();
      if (tid && !templateCache[tid]) {
        try {
          const t = await db.collection(COLLECTIONS.templates).findOne({ _id: new ObjectId(tid) });
          if (t) templateCache[tid] = t;
        } catch { /* ignore */ }
      }
    }

    const stats = { translated: 0, skipped: 0, errors: 0, overflow_warnings: [] as OverflowWarning[] };
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
          // Récupérer les contraintes max_chars depuis le template
          const template = templateCache[page.template_id?.toString()] ?? null;
          const fieldLimits = this.buildFieldLimits(template);

          const translated = await this.translateFieldsWithRetry(
            toTranslate,
            targetLang,
            langName,
            fieldLimits,
            retryMax
          );

          // Détecter les dépassements résiduels après tous les retries
          const pageOverflows: OverflowWarning[] = [];
          if (alertEnabled) {
            for (const [key, value] of Object.entries(translated)) {
              const limit = fieldLimits[key];
              if (limit && typeof value === 'string' && value.length > limit) {
                pageOverflows.push({
                  page_id:        page._id.toString(),
                  page_titre:     page.titre ?? page.template_name ?? page._id.toString(),
                  field_key:      key,
                  lang:           targetLang,
                  current_length: value.length,
                  max_chars:      limit,
                });
              }
            }
            stats.overflow_warnings.push(...pageOverflows);
          }

          // Sauvegarder sur la page
          await db.collection('pages').updateOne(
            { _id: new ObjectId(page._id) },
            {
              $set: {
                [`content_translations.${targetLang}.text`]:              translated,
                [`content_translations.${targetLang}.translated_at`]:     new Date(),
                [`content_translations.${targetLang}.overflow_warnings`]: pageOverflows,
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
   * Construit un dictionnaire fieldKey → max_chars depuis le template.
   * Utilisé pour détecter les dépassements post-traduction.
   */
  private buildFieldLimits(template: any | null): Record<string, number> {
    if (!template?.fields) return {};
    const limits: Record<string, number> = {};
    for (const field of template.fields) {
      if (!field.name) continue;
      if (field.max_chars) {
        limits[field.name] = field.max_chars;
        // Pour les listes : contrainte par puce si définie
        if (field.type === 'liste' && field.max_chars_per_item) {
          limits[`${field.name}__per_item`] = field.max_chars_per_item;
        }
      }
      // Pour les liens : le calibre de l'intitulé est sur link_label.max_chars
      if (field.type === 'lien' && field.link_label?.max_chars) {
        limits[field.name] = field.link_label.max_chars;
      }
      // Pour les répétitifs : calibre par sous-champ, indexé sur toutes les clés plates
      // Convention de extractTranslatableFields : "INSPIRATION_repetitif_1" → "INSPIRATION_1_nom_1"
      if (field.type === 'repetitif' && Array.isArray(field.sub_fields)) {
        const flatPrefix = (field.name as string).replace(/_repetitif_/g, '_');
        const maxSlots   = field.max_repetitions ?? 16;
        for (const sf of field.sub_fields) {
          if (sf.max_chars && sf.name) {
            for (let i = 1; i <= maxSlots; i++) {
              limits[`${flatPrefix}_${sf.name}_${i}`] = sf.max_chars;
            }
          }
        }
      }
    }
    return limits;
  }

  /**
   * Traduit un ensemble de champs avec boucle de retry en cas de dépassement.
   * Passe 1 : traduction standard avec consigne de condensation
   * Passe 2 : traduction avec pression explicite + longueur actuelle
   * Passe 3 : traduction minimaliste ultra-condensée
   * Si dépassement résiduel : retourne quand même (marqué OVERFLOW_MANUEL par translateGuide)
   */
  private async translateFieldsWithRetry(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    fieldLimits: Record<string, number>,
    retryMax: number
  ): Promise<Record<string, string>> {
    let result = await this.translateFields(fields, targetLang, langName, 1, null, fieldLimits);

    for (let pass = 2; pass <= retryMax; pass++) {
      // Identifier les champs qui dépassent encore
      const overflowing: Record<string, string> = {};
      for (const [key, value] of Object.entries(result)) {
        const limit = fieldLimits[key];
        if (limit && typeof value === 'string' && value.length > limit) {
          overflowing[key] = value;
        }
      }
      if (Object.keys(overflowing).length === 0) break; // tout est OK

      console.warn(`⚠️ [TRANSLATE] Pass ${pass} — ${Object.keys(overflowing).length} champs dépassent le calibre`);
      const corrected = await this.translateFields(fields, targetLang, langName, pass, overflowing, fieldLimits);
      Object.assign(result, corrected);
    }

    return result;
  }

  /**
   * Extrait les champs texte traduisibles depuis page.content.
   *
   * - Champs texte bruts (non-URL, non-JSON) → inclus tel quel
   * - Champs lien {label, url} (objet ou string JSON) → seul le label extrait sous la même clé
   * - Champs répétitifs (array JSON) → noms des cards extraits comme clés plates
   *   ex: "INSPIRATION_repetitif_1" → "INSPIRATION_1_nom_1", "INSPIRATION_1_nom_2", …
   * - URLs directes, champs sans label → exclus
   */
  private extractTranslatableFields(content: Record<string, any>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(content)) {
      if (value === null || value === undefined || value === '') continue;

      // Exclure les champs pictos (valeurs sémantiques de calques InDesign, pas du texte)
      if (/_picto_/i.test(key)) continue;

      // ── Champ lien {label, url} — objet MongoDB natif ou string JSON ──────────
      const link = parseLinkField(value);
      if (link !== null) {
        if (link.label.trim()) result[key] = link.label.trim();
        continue;
      }

      if (typeof value !== 'string') continue;

      const str = value.trim();
      if (!str) continue;

      // Exclure les URLs directes
      if (/^https?:\/\//i.test(str)) continue;

      // Exclure les strings JSON qui ne sont pas des liens (objets autres)
      if (str.startsWith('{')) continue;

      // ── Champ répétitif (array JSON) → extraire tous les sous-champs textuels ──
      // ex: "INSPIRATION_repetitif_1" → "INSPIRATION_1_nom_1", "INSPIRATION_1_hashtag_1", …
      if (str.startsWith('[')) {
        try {
          const cards = JSON.parse(str);
          if (Array.isArray(cards)) {
            const flatPrefix = key.replace(/_repetitif_/g, '_');
            cards.forEach((card: any, idx: number) => {
              if (!card || typeof card !== 'object') return;
              const n = idx + 1;
              for (const [subKey, subVal] of Object.entries(card)) {
                if (typeof subVal !== 'string' || !subVal.trim()) continue;
                // Exclure les URLs, les sentinelles numériques ('1'/''), les champs image/url
                if (/^https?:\/\//i.test(subVal)) continue;
                if (subKey === 'card' || subKey === 'image' || subKey === 'url_article' || subKey === 'url_maps') continue;
                result[`${flatPrefix}_${subKey}_${n}`] = subVal.trim();
              }
            });
          }
        } catch { /* JSON invalide → ignorer */ }
        continue;
      }

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
    langName: string,
    pass: number = 1,
    overflowingFields: Record<string, string> | null = null,
    fieldLimits: Record<string, number> = {}
  ): Promise<Record<string, string>> {
    // En passe 2+, ne retraduire QUE les champs qui débordent
    const toProcess = (pass > 1 && overflowingFields)
      ? overflowingFields
      : fields;

    const keys = Object.keys(toProcess);
    if (keys.length === 0) return {};

    const result: Record<string, string> = pass > 1 ? { ...fields } : {};

    for (let i = 0; i < keys.length; i += MAX_FIELDS_PER_CALL) {
      const batchKeys = keys.slice(i, i + MAX_FIELDS_PER_CALL);
      const batchInput: Record<string, string> = {};
      for (const k of batchKeys) batchInput[k] = toProcess[k];

      const batchResult = await this.translateBatch(batchInput, targetLang, langName, pass, fieldLimits);
      Object.assign(result, batchResult);
    }

    return result;
  }

  /**
   * Appel OpenAI pour traduire un batch de champs.
   * Le prompt varie selon la passe :
   *   Passe 1 : traduction standard avec consigne de condensation
   *   Passe 2 : pression explicite + longueurs actuelles communiquées
   *   Passe 3 : mode minimaliste ultra-condensé
   */
  private async translateBatch(
    fields: Record<string, string>,
    _targetLang: string,
    langName: string,
    pass: number = 1,
    fieldLimits: Record<string, number> = {}
  ): Promise<Record<string, string>> {
    const inputJson = JSON.stringify(fields, null, 2);

    // Construire les contraintes de longueur pour les champs qui ont un max_chars
    const limitLines: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      const limit = fieldLimits[key];
      if (limit) {
        const current = typeof value === 'string' ? value.length : 0;
        limitLines.push(`  "${key}": max ${limit} chars (currently ${current} chars in source/previous attempt)`);
      }
    }
    const limitBlock = limitLines.length > 0
      ? `\nCharacter limits per field (MUST respect — InDesign frame calibration):\n${limitLines.join('\n')}`
      : '';

    const condensationInstruction =
      pass === 1 ? '- If a field has a character limit, condense the translation to stay within it without losing essential meaning' :
      pass === 2 ? '- CRITICAL: The fields below EXCEED their character limits. Rewrite them more concisely. Remove secondary details while keeping the core meaning. You MUST stay under the limit.' :
                   '- ULTRA-CONDENSED MODE: Each field must be as short as possible while remaining meaningful. Cut all non-essential words. Strict compliance with character limits is mandatory.';

    const systemPrompt = `You are a professional travel guide translator.
Translate the JSON values from French to ${langName}.

Rules:
- Return ONLY a valid JSON object with the same keys
- Translate only the values, never the keys
- Preserve ALL formatting markers exactly as-is: **bold**, {orange}, ^number^, ~gras-orange~
- Preserve line breaks (\\n) in their exact positions
- Do NOT translate or modify URLs (starting with http)
- Keep proper nouns, brand names, and place names as appropriate for the target language
- Be natural and idiomatic, not literal
${condensationInstruction}${limitBlock}`;

    const userPrompt = `Translate to ${langName} (pass ${pass}):\n${inputJson}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: pass === 3 ? 0.1 : 0.2,
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        });

        const choice = response.choices[0];
        const content = choice?.message?.content;
        if (!content) throw new Error('Pas de réponse OpenAI');

        // Si la réponse a été tronquée par la limite de tokens, on force un retry
        if (choice.finish_reason === 'length') {
          throw new Error(`Réponse tronquée (finish_reason=length) — retry`);
        }

        const parsed = JSON.parse(content);

        const inputKeys = Object.keys(fields);
        const outputKeys = Object.keys(parsed);
        const missingKeys = inputKeys.filter(k => !outputKeys.includes(k));
        if (missingKeys.length > 0) {
          console.warn(`⚠️ [TRANSLATE] Clés manquantes (pass ${pass}): ${missingKeys.join(', ')} — utilisation du texte original`);
          for (const k of missingKeys) parsed[k] = fields[k];
        }

        return parsed as Record<string, string>;
      } catch (err: any) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    return fields;
  }
}
