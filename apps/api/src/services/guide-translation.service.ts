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

/**
 * Traductions forcées : bypasse le LLM pour des labels qui ont une valeur
 * corrigée connue (ex : label trop long après traduction automatique).
 * Structure : { [lang]: { [fieldKey]: { fr: valeur source, translation: valeur cible } } }
 * Le champ n'est substitué que si la valeur FR actuelle correspond à `fr`.
 */
const FORCED_TRANSLATIONS: Record<string, Record<string, { fr: string; translation: string }>> = {
  de: {
    POI_lien_1: { fr: 'HORAIRES, PRIX ET PHOTOS', translation: 'ÖFFNUNGSZEITEN PREISE BILDER' },
  },
  da: {
    POI_lien_1: { fr: 'HORAIRES, PRIX ET PHOTOS', translation: 'ÅBNINGSTIDER PRISER BILLEDER' },
  },
  nl: {
    POI_lien_1: { fr: 'HORAIRES, PRIX ET PHOTOS', translation: 'OPENINGSTIJDEN PRIJZEN FOTO' },
  },
};
import OpenAI from 'openai';
import { Db, ObjectId } from 'mongodb';
import { parseLinkField } from '../utils/link-field.js';
import { repairStrandedBoldMarkers } from '../utils/repair-style-markers.js';
import { COLLECTIONS } from '../config/collections.js';
import { DEFAULT_SETTINGS } from '../routes/settings.routes.js';
import { splitTranslatableFields } from '../translation/place-name-fields.js';
import {
  buildPageTranslationContext,
  buildPlaceNameNamingRules,
  formatPageContextBlock,
  getPageTextContent,
  type PageTranslationContext,
} from '../translation/page-translation-context.js';
import { resolveGuideDestination } from '../translation/place-naming-profiles.js';

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
const OPENAI_TIMEOUT_MS = 120_000;
const PAGE_TRANSLATION_TIMEOUT_MS = 8 * 60 * 1000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout ${label} (${Math.round(ms / 1000)}s)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    this.client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS });
  }

  /**
   * Traduit toutes les pages d'un guide dans la langue cible.
   * Sauvegarde le résultat dans pages.content_translations.{lang}.text
   */
  async translateGuide(
    guideId: string,
    targetLang: string,
    db: Db,
    onProgress?: (p: TranslationProgress) => Promise<void>,
    scope: 'geojson' | 'full' = 'full'
  ): Promise<{ translated: number; skipped: number; errors: number; overflow_warnings: OverflowWarning[] }> {
    const langName = LANGUAGE_NAMES[targetLang];
    if (!langName) throw new Error(`Langue inconnue : ${targetLang}`);

    // Charger les paramètres globaux (retry max)
    const settingsDoc = await db.collection(COLLECTIONS.settings).findOne({ _id: 'global' as any });
    const retryMax: number   = (settingsDoc as any)?.translation_retry_max ?? DEFAULT_SETTINGS.translation_retry_max;
    const alertEnabled: boolean = (settingsDoc as any)?.translation_overflow_alert ?? DEFAULT_SETTINGS.translation_overflow_alert;

    // 1. Récupérer le guide (destination pour profil toponymique)
    const guide = await db.collection(COLLECTIONS.guides).findOne(
      ObjectId.isValid(guideId) ? { _id: new ObjectId(guideId) } : { _id: guideId as any }
    );
    const guideDestination = resolveGuideDestination(guide as Record<string, unknown> | null);
    console.log(`🌍 [TRANSLATE] Destination: ${guideDestination || '(non renseignée)'}`);

    // 2. Récupérer le chemin de fer
    const cdf = await db.collection('chemins_de_fer').findOne({ guide_id: guideId });
    if (!cdf) throw new Error('Chemin de fer non trouvé');

    // 3. Récupérer uniquement les pages exportables (même filtre que l'export JSON)
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

    console.log(`🚀 [TRANSLATE] Début guide ${guideId} → ${targetLang} scope=${scope} (${total} pages exportables)`);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const rawContent = getPageTextContent(page as Record<string, unknown>);
      const pageContext = buildPageTranslationContext(
        page as Record<string, unknown>,
        guide as Record<string, unknown> | null,
        targetLang
      );

      // Extraire les champs texte traduisibles
      const allTranslatable = this.extractTranslatableFields(rawContent);

      // scope=geojson : seul POI_titre_1 est traduit (pour les labels GeoJSON)
      const toTranslate = scope === 'geojson'
        ? (allTranslatable['POI_titre_1'] ? { POI_titre_1: allTranslatable['POI_titre_1'] } : {})
        : allTranslatable;

      // Appliquer les traductions forcées (labels corrigés, bypass LLM)
      const forcedForLang = FORCED_TRANSLATIONS[targetLang] ?? {};
      const forcedApplied: Record<string, string> = {};
      for (const [fieldKey, { fr, translation }] of Object.entries(forcedForLang)) {
        if (toTranslate[fieldKey] === fr) {
          forcedApplied[fieldKey] = translation;
          delete (toTranslate as Record<string, string>)[fieldKey];
        }
      }

      const { placeNames, body } = splitTranslatableFields(toTranslate);
      const placeNameKeys = Object.keys(placeNames);
      const bodyKeys = Object.keys(body);
      console.log(
        `📋 [TRANSLATE] Page ${i + 1}/${total} ${page.template_name} (${page._id}) — ` +
        `${placeNameKeys.length} toponyme(s), ${bodyKeys.length} autre(s) champ(s)` +
        (scope === 'geojson' ? ' [geojson]' : '')
      );

      if (Object.keys(toTranslate).length === 0) {
        stats.skipped++;
      } else {
        try {
          // Récupérer les contraintes max_chars depuis le template
          const template = templateCache[page.template_id?.toString()] ?? null;
          const fieldLimits = this.buildFieldLimits(template);

          const translated = await withTimeout(
            this.translatePageFieldsWithRetry(
              toTranslate,
              targetLang,
              langName,
              fieldLimits,
              retryMax,
              pageContext
            ),
            PAGE_TRANSLATION_TIMEOUT_MS,
            `page ${page._id}`
          );

          // Détecter les dépassements résiduels (scope=full uniquement)
          const pageOverflows: OverflowWarning[] = [];
          if (scope === 'full' && alertEnabled) {
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

          // Fusionner les traductions forcées dans le résultat LLM
          const translatedFinal = { ...translated, ...forcedApplied };

          // Sauvegarder sur la page
          const setFields: Record<string, any> = {
            [`content_translations.${targetLang}.translated_at`]: new Date(),
            [`content_translations.${targetLang}.scope`]:         scope,
          };
          if (scope === 'geojson') {
            // Ne mettre à jour que POI_titre_1 pour ne pas écraser une traduction complète existante
            if (translatedFinal['POI_titre_1'] != null) {
              setFields[`content_translations.${targetLang}.text.POI_titre_1`] = translatedFinal['POI_titre_1'];
            }
          } else {
            setFields[`content_translations.${targetLang}.text`]              = translatedFinal;
            setFields[`content_translations.${targetLang}.overflow_warnings`] = pageOverflows;
          }

          await db.collection('pages').updateOne(
            { _id: new ObjectId(page._id) },
            { $set: setFields }
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
   * Traduit une page : passe dédiée toponymes + passe corps de texte.
   */
  private async translatePageFieldsWithRetry(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    fieldLimits: Record<string, number>,
    retryMax: number,
    pageContext: PageTranslationContext
  ): Promise<Record<string, string>> {
    const { placeNames, body } = splitTranslatableFields(fields);
    const result: Record<string, string> = {};

    if (Object.keys(placeNames).length > 0) {
      Object.assign(
        result,
        await this.translatePlaceNameFieldsWithRetry(
          placeNames,
          targetLang,
          langName,
          fieldLimits,
          retryMax,
          pageContext
        )
      );
    }

    if (Object.keys(body).length > 0) {
      Object.assign(
        result,
        await this.translateBodyFieldsWithRetry(
          body,
          targetLang,
          langName,
          fieldLimits,
          retryMax,
          pageContext
        )
      );
    }

    return result;
  }

  /**
   * Passe toponymes avec règles universelles + contexte page.
   */
  private async translatePlaceNameFieldsWithRetry(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    fieldLimits: Record<string, number>,
    retryMax: number,
    pageContext: PageTranslationContext
  ): Promise<Record<string, string>> {
    let result = await this.translatePlaceNameFields(
      fields,
      targetLang,
      langName,
      1,
      null,
      fieldLimits,
      pageContext
    );

    for (let pass = 2; pass <= retryMax; pass++) {
      const overflowing: Record<string, string> = {};
      for (const [key, value] of Object.entries(result)) {
        const limit = fieldLimits[key];
        if (limit && typeof value === 'string' && value.length > limit) {
          overflowing[key] = value;
        }
      }
      if (Object.keys(overflowing).length === 0) break;

      console.warn(`⚠️ [TRANSLATE] Toponyme pass ${pass} — ${Object.keys(overflowing).length} champ(s) dépassent le calibre`);
      const corrected = await this.translatePlaceNameFields(
        fields,
        targetLang,
        langName,
        pass,
        overflowing,
        fieldLimits,
        pageContext
      );
      Object.assign(result, corrected);
    }

    return result;
  }

  private async translatePlaceNameFields(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    pass: number = 1,
    overflowingFields: Record<string, string> | null = null,
    fieldLimits: Record<string, number> = {},
    pageContext: PageTranslationContext
  ): Promise<Record<string, string>> {
    const toProcess = (pass > 1 && overflowingFields) ? overflowingFields : fields;
    const keys = Object.keys(toProcess);
    if (keys.length === 0) return {};

    const result: Record<string, string> = {};

    for (let i = 0; i < keys.length; i += MAX_FIELDS_PER_CALL) {
      const batchKeys = keys.slice(i, i + MAX_FIELDS_PER_CALL);
      const batchInput: Record<string, string> = {};
      for (const k of batchKeys) batchInput[k] = toProcess[k];

      const batchResult = await this.translatePlaceNameBatch(
        batchInput,
        targetLang,
        langName,
        pass,
        fieldLimits,
        pageContext
      );
      Object.assign(result, batchResult);
    }

    return result;
  }

  /**
   * Traduit un ensemble de champs corps de texte avec boucle de retry.
   */
  private async translateBodyFieldsWithRetry(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    fieldLimits: Record<string, number>,
    retryMax: number,
    pageContext: PageTranslationContext
  ): Promise<Record<string, string>> {
    let result = await this.translateFields(
      fields,
      targetLang,
      langName,
      1,
      null,
      fieldLimits,
      pageContext
    );

    for (let pass = 2; pass <= retryMax; pass++) {
      const overflowing: Record<string, string> = {};
      for (const [key, value] of Object.entries(result)) {
        const limit = fieldLimits[key];
        if (limit && typeof value === 'string' && value.length > limit) {
          overflowing[key] = value;
        }
      }
      if (Object.keys(overflowing).length === 0) break;

      console.warn(`⚠️ [TRANSLATE] Pass ${pass} — ${Object.keys(overflowing).length} champs dépassent le calibre`);
      const corrected = await this.translateFields(
        fields,
        targetLang,
        langName,
        pass,
        overflowing,
        fieldLimits,
        pageContext
      );
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

      // Exclure les champs non-texte : pictos (calques InDesign), card (sentinelle) et images
      if (/_picto_/i.test(key) || /_card_/i.test(key) || /_image_/i.test(key)) continue;

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

      // Champ sommaire JSON (SommaireJsonV1) → extraire les titres uniques comme champs plats.
      // La clé utilise le nom du champ source pour éviter toute collision avec les champs
      // content existants (ex. SOMMAIRE_titre_1 = "Sommaire" est un champ template distinct).
      // Exemple : SOMMAIRE_texte_1 → SOMMAIRE_texte_1_entry_1, SOMMAIRE_texte_1_entry_2, …
      if (str.startsWith('{')) {
        try {
          const parsed = JSON.parse(str) as { schema_version?: number; entries?: Array<{ title?: string }> };
          if (parsed?.schema_version === 1 && Array.isArray(parsed.entries)) {
            const seen = new Set<string>();
            let idx = 0;
            for (const entry of parsed.entries) {
              const title = entry.title?.trim();
              if (title && !seen.has(title)) {
                seen.add(title);
                idx++;
                result[`${key}_entry_${idx}`] = title;
              }
            }
          }
        } catch { /* JSON invalide → ignorer */ }
        continue;
      }

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
    fieldLimits: Record<string, number> = {},
    pageContext: PageTranslationContext | null = null
  ): Promise<Record<string, string>> {
    // En passe 2+, ne retraduire QUE les champs qui débordent
    const toProcess = (pass > 1 && overflowingFields)
      ? overflowingFields
      : fields;

    const keys = Object.keys(toProcess);
    if (keys.length === 0) return {};

    // Pour pass > 1 on ne retourne QUE les champs retraduits (les overflows).
    // NE PAS initialiser avec { ...fields } (FR) qui écraserait les traductions DE du pass 1.
    const result: Record<string, string> = {};

    for (let i = 0; i < keys.length; i += MAX_FIELDS_PER_CALL) {
      const batchKeys = keys.slice(i, i + MAX_FIELDS_PER_CALL);
      const batchInput: Record<string, string> = {};
      for (const k of batchKeys) batchInput[k] = toProcess[k];

      const batchResult = await this.translateBatch(
        batchInput,
        targetLang,
        langName,
        pass,
        fieldLimits,
        pageContext
      );
      Object.assign(result, batchResult);
    }

    return result;
  }

  /**
   * Appel OpenAI — passe toponymes (POI_titre_1, noms inspiration, sommaire).
   */
  private async translatePlaceNameBatch(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    pass: number = 1,
    fieldLimits: Record<string, number> = {},
    pageContext: PageTranslationContext
  ): Promise<Record<string, string>> {
    const inputJson = JSON.stringify(fields, null, 2);
    const limitBlock = this.buildLimitBlock(fields, fieldLimits);
    const condensationInstruction = this.buildCondensationInstruction(pass);
    const contextBlock = formatPageContextBlock(pageContext);
    const namingRules = buildPlaceNameNamingRules(langName, pageContext, targetLang);

    const systemPrompt = `You are a professional travel guide toponymy localizer.
Localize place names from French editorial labels to ${langName}.

Rules:
- Return ONLY a valid JSON object with the same keys
- Localize only the values, never the keys
- Do NOT add explanations, comments, or extra fields
${namingRules}
${condensationInstruction}${limitBlock}`;

    const userPrompt = [
      contextBlock,
      '',
      `Localize these place names to ${langName} (pass ${pass}):`,
      inputJson,
    ].join('\n');

    return this.callOpenAiTranslation(systemPrompt, userPrompt, fields, pass, 'toponyme');
  }

  /**
   * Appel OpenAI pour traduire un batch de champs corps de texte.
   */
  private async translateBatch(
    fields: Record<string, string>,
    targetLang: string,
    langName: string,
    pass: number = 1,
    fieldLimits: Record<string, number> = {},
    pageContext: PageTranslationContext | null = null
  ): Promise<Record<string, string>> {
    const inputJson = JSON.stringify(fields, null, 2);
    const limitBlock = this.buildLimitBlock(fields, fieldLimits);
    const condensationInstruction = this.buildCondensationInstruction(pass);
    const localizationInstruction = this.buildLocalizationInstruction(targetLang, langName);
    const contextBlock = pageContext ? formatPageContextBlock(pageContext) : '';

    const systemPrompt = `You are a professional travel content localizer.
Translate/localize the JSON values from French to ${langName}.

Rules:
- Return ONLY a valid JSON object with the same keys
- Translate only the values, never the keys
- Preserve ALL formatting markers exactly as-is: **bold**, {orange}, ^number^, ~gras-orange~
- Bold markers must wrap COMPLETE words only (e.g. **to choose**), never split the first letter outside (never t**o choose** or h**elps**)
- Preserve line breaks (\\n) in their exact positions
- Do NOT translate or modify URLs (starting with http)
- Keep proper nouns, brand names, and place names as appropriate for the target language
- Be natural and idiomatic, not literal
- Do not add explanations, comments, or extra fields
- Preserve all factual information accurately
- Preserve lists, structure, and hierarchy
- Use the page context block (if provided) to disambiguate entities and places — do NOT translate the context itself
${localizationInstruction}
${condensationInstruction}${limitBlock}`;

    const userPromptParts = [
      contextBlock,
      contextBlock ? '' : null,
      `Translate to ${langName} (pass ${pass}):`,
      inputJson,
    ].filter((p): p is string => p !== null && p !== '');

    return this.callOpenAiTranslation(
      systemPrompt,
      userPromptParts.join('\n'),
      fields,
      pass,
      'body'
    );
  }

  private buildLimitBlock(
    fields: Record<string, string>,
    fieldLimits: Record<string, number>
  ): string {
    const limitLines: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      const limit = fieldLimits[key];
      if (limit) {
        const current = typeof value === 'string' ? value.length : 0;
        limitLines.push(`  "${key}": max ${limit} chars (currently ${current} chars in source/previous attempt)`);
      }
    }
    return limitLines.length > 0
      ? `\nCharacter limits per field (MUST respect — InDesign frame calibration):\n${limitLines.join('\n')}`
      : '';
  }

  private buildCondensationInstruction(pass: number): string {
    if (pass === 1) {
      return '- If a field has a character limit, condense the translation to stay within it without losing essential meaning';
    }
    if (pass === 2) {
      return '- CRITICAL: The fields below EXCEED their character limits. Rewrite them more concisely. Remove secondary details while keeping the core meaning. You MUST stay under the limit.';
    }
    return '- ULTRA-CONDENSED MODE: Each field must be as short as possible while remaining meaningful. Cut all non-essential words. Strict compliance with character limits is mandatory.';
  }

  private buildLocalizationInstruction(targetLang: string, langName: string): string {
    if (targetLang === 'en') {
      return `
English localization rules:
- You are a professional travel content localizer working for Region Lovers
- Do NOT translate literally from French to English
- Produce natural, fluent, native-level English travel content that feels written originally for an English-speaking traveler
- Prioritize clarity, usefulness, and natural English over literal fidelity
- Use conventions, vocabulary, and tone commonly found in premium English-language travel guides
- Avoid French sentence structures translated word-for-word
- Avoid awkward, overly formal, overly poetic, or promotional phrasing
- Prefer concise, immediately understandable wording
- Tone: clear, practical, warm but professional, easy to scan, informative without sounding promotional
- When translating labels, icons, UI elements, categories, badges, or practical information, prioritize standard tourism UX vocabulary
- Keep icon labels compact and intuitive
- Prefer wording commonly used in travel apps, guidebooks, and tourism websites
- Use sentence case unless the original design clearly requires title case
- Avoid unnecessary capitalization
- Do not keep French wording unless it is a proper noun, place name, brand name, or explicitly intended

Preferred English UX/localization examples:
- "Family" -> "Family-friendly"
- "Accessible for disabled" -> "Accessible"
- "Dining" -> "Food"
- "Paid" -> "For a fee"
- "Must see" -> "Nice to see"`;
    }

    return `
Localization rules:
- Do NOT translate literally if the result sounds unnatural in ${langName}
- Produce natural, fluent travel content that feels written originally for a traveler reading ${langName}
- Prioritize clarity, usefulness, and idiomatic wording over word-for-word fidelity
- Use standard travel-guide and tourism UX vocabulary in ${langName}
- Keep labels, icons, categories, badges, and practical information short, clear, and intuitive
- Avoid awkward, overly formal, overly poetic, or promotional phrasing
- Preserve the meaning, practical value, facts, structure, and hierarchy of the original content`;
  }

  private async callOpenAiTranslation(
    systemPrompt: string,
    userPrompt: string,
    fields: Record<string, string>,
    pass: number,
    batchKind: 'toponyme' | 'body'
  ): Promise<Record<string, string>> {
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
        const rawContent = choice?.message?.content;
        if (!rawContent) throw new Error('Pas de réponse OpenAI');

        console.log(
          `🤖 [TRANSLATE] ${batchKind} batch finish_reason=${choice.finish_reason} ` +
          `tokens=${response.usage?.total_tokens} input_keys=${Object.keys(fields).length}`
        );

        const parsed = JSON.parse(rawContent);

        const inputKeys = Object.keys(fields);
        const outputKeys = Object.keys(parsed);
        const missingKeys = inputKeys.filter(k => !outputKeys.includes(k));
        if (missingKeys.length > 0) {
          console.warn(`⚠️ [TRANSLATE] Clés manquantes (pass ${pass}): ${missingKeys.join(', ')}`);
          for (const k of missingKeys) parsed[k] = fields[k];
        } else {
          console.log(`✅ [TRANSLATE] Batch OK: toutes les ${outputKeys.length} clés présentes`);
        }

        for (const k of Object.keys(parsed)) {
          const val = (parsed as Record<string, unknown>)[k];
          if (typeof val === 'string') (parsed as Record<string, string>)[k] = repairStrandedBoldMarkers(val);
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
