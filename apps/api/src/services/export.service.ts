// v2.2.0 — field services (2ème passe) + variant_layer résolu depuis field.option_layers
import { Db, ObjectId } from 'mongodb';
import {
  isPictoField,
  resolveFieldLayer,
  resolveVariantLayer,
} from '../config/export-mappings.js';
import {
  FieldServiceRunner,
  explodeRepetitifField,
  narrowSommaireJsonForPageExport,
  type ExportedPageSnapshot,
} from './field-service-runner.service.js';
import { COLLECTIONS } from '../config/collections.js';
import { getArticlesDatabase } from '../config/database.js';
import {
  parseLinkField,
  buildLinkField,
  normalizeArticleUrl,
  isGoogleMapsUrl,
  isRootUrl,
  slugify,
  stripUrlFragment,
  getUrlFragment,
  parseAnchorLeadingIndex,
} from '../utils/link-field.js';
import { repairStrandedBoldMarkers } from '../utils/repair-style-markers.js';

const EXPORTED_STATUSES = ['generee_ia', 'relue', 'validee', 'texte_coule', 'visuels_montes'];

export interface ExportOptions {
  language?: string;
}

export interface RedirectPair {
  /** URL normalisée stable : https://{host}/guide/{lang}/{slug}/ */
  normalized: string;
  /** URL destination réelle (vers laquelle pointer la redirection côté hébergeur) */
  destination: string;
}

export class ExportService {
  async buildGuideExport(guideId: string, db: Db, options: ExportOptions = {}) {
    const lang = options.language || 'fr';

    // ── 1. Récupérer le guide ──────────────────────────────────────────────
    const guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
    if (!guide) throw new Error('Guide non trouvé');

    // ── 2. Récupérer le chemin de fer ──────────────────────────────────────
    const cheminDeFer = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guideId });
    if (!cheminDeFer) throw new Error('Chemin de fer non trouvé');

    // ── 3. Récupérer toutes les pages avec leur contenu ────────────────────
    const allPages = await db
      .collection(COLLECTIONS.pages)
      .find({ chemin_de_fer_id: cheminDeFer._id.toString() })
      .sort({ ordre: 1 })
      .toArray();

    const exportablePages = allPages.filter(p => EXPORTED_STATUSES.includes(p.statut_editorial));
    const draftPages      = allPages.filter(p => !EXPORTED_STATUSES.includes(p.statut_editorial));

    // ── 4. Récupérer tous les templates utilisés ───────────────────────────
    const templateIds = [...new Set(exportablePages.map(p => p.template_id).filter(Boolean))];
    const templates: Record<string, any> = {};
    for (const tid of templateIds) {
      if (ObjectId.isValid(tid)) {
        const tpl = await db.collection(COLLECTIONS.templates).findOne({ _id: new ObjectId(tid) });
        if (tpl) templates[tid] = tpl;
      }
    }

    // ── 4b. Construire le resolver d'URLs par langue ───────────────────────
    // Pour lang !== 'fr' : remplace les URLs françaises par la version cible.
    // Source : articles_raw.urls_by_lang.{lang} depuis la base articles dédiée.
    let urlResolver: (frUrl: string) => string = (u) => u; // identité pour FR
    // Maps étendues pour résoudre les destinations CSV STRICTEMENT depuis la base :
    // - clé URL FR exacte
    // - clé canonique FR (/guide/fr/slug/)
    // - clé slug FR (dernier segment URL)
    // Ancres : même indice #N_ entre langues → URL cible complète si présente dans urls_by_lang[lang].
    const urlCanonicalMap = new Map<string, string>();
    const urlSlugMap = new Map<string, string>();
    const anchorByFrCanonAndIndex = new Map<string, string>();
    /** Ancres type « Jour_2_… » / « Day_2_… » : même numéro de jour entre langues. */
    const anchorByFrCanonAndDay = new Map<string, string>();
    if (lang !== 'fr') {
      const articleProjection = { 'urls_by_lang': 1, 'heading_anchors_by_lang': 1 };
      const articleFilter = { [`urls_by_lang.${lang}`]: { $exists: true } };
      const articlesFromConfiguredDb = await getArticlesDatabase()
        .collection(COLLECTIONS.articles_raw)
        .find(articleFilter, { projection: articleProjection })
        .toArray();

      const urlMap = new Map<string, string>();
      const slugFromUrl = (u: string): string | null => {
        try {
          const p = new URL(u).pathname.replace(/\/+$/, '');
          const parts = p.split('/').filter(Boolean);
          if (parts.length === 0) return null;
          // retire éventuels préfixes de langue/canonical guide
          let slug = parts[parts.length - 1];
          if (!slug || slug === 'guide') return null;
          return slug.toLowerCase();
        } catch {
          return null;
        }
      };

      const extractAnchorIndex = (anchorId: string | null | undefined): string | null => {
        if (!anchorId) return null;
        const m = /^(\d+)_/.exec(anchorId);
        return m ? m[1] : null;
      };

      const registerArticleUrls = (art: any) => {
        const frUrl  = art.urls_by_lang?.fr;
        const tgtUrl = art.urls_by_lang?.[lang];
        if (frUrl && tgtUrl) {
          const frBase = stripUrlFragment(frUrl);
          const tgtBase = stripUrlFragment(tgtUrl);
          if (!urlMap.has(frUrl)) urlMap.set(frUrl, tgtBase);
          if (!urlMap.has(frBase)) urlMap.set(frBase, tgtBase);

          // Variante canonique FR (/guide/fr/slug/) -> URL traduite réelle.
          const canonicalFr = normalizeArticleUrl(frBase, 'fr');
          if (!urlCanonicalMap.has(canonicalFr)) urlCanonicalMap.set(canonicalFr, tgtBase);
          const frSlug = slugFromUrl(frBase);
          if (frSlug && !urlSlugMap.has(frSlug)) urlSlugMap.set(frSlug, tgtBase);

          // Nouveau schéma ingestion : heading_anchors_by_lang.{lang}
          const frAnchorsObj = art.heading_anchors_by_lang?.fr ?? {};
          const tgtAnchorsObj = art.heading_anchors_by_lang?.[lang] ?? {};
          const tgtByIndex = new Map<string, string>();
          for (const val of Object.values(tgtAnchorsObj)) {
            if (typeof val !== 'string') continue;
            const idx = extractAnchorIndex(val);
            if (idx && !tgtByIndex.has(idx)) tgtByIndex.set(idx, val);
          }
          for (const key of Object.keys(tgtAnchorsObj)) {
            const idx = extractAnchorIndex(key);
            if (idx && !tgtByIndex.has(idx)) tgtByIndex.set(idx, key);
          }

          for (const val of Object.values(frAnchorsObj)) {
            if (typeof val !== 'string') continue;
            const idx = extractAnchorIndex(val);
            if (!idx) continue;
            const tgtAnchorId = tgtByIndex.get(idx);
            if (!tgtAnchorId) continue;
            anchorByFrCanonAndIndex.set(`${canonicalFr}|${idx}`, `${tgtBase}#${tgtAnchorId}`);
          }
          for (const key of Object.keys(frAnchorsObj)) {
            const idx = extractAnchorIndex(key);
            if (!idx) continue;
            const tgtAnchorId = tgtByIndex.get(idx);
            if (!tgtAnchorId) continue;
            anchorByFrCanonAndIndex.set(`${canonicalFr}|${idx}`, `${tgtBase}#${tgtAnchorId}`);
          }

          const dayNumFromAnchorId = (id: string): number | null => {
            const raw = String(id).replace(/^#/, '');
            const mJ = /\bJour[_\s]*(\d+)\b/i.exec(raw) ?? /\bDay[_\s]*(\d+)\b/i.exec(raw);
            if (mJ) return parseInt(mJ[1], 10);
            const mN = /^(\d+)_/.exec(raw);
            if (mN) return parseInt(mN[1], 10);
            return null;
          };
          const frByDay = new Map<number, string>();
          for (const frId of [...Object.keys(frAnchorsObj), ...Object.values(frAnchorsObj)]) {
            if (typeof frId !== 'string') continue;
            const d = dayNumFromAnchorId(frId);
            if (d === null) continue;
            frByDay.set(d, frId.replace(/^#/, ''));
          }
          const enByDay = new Map<number, string>();
          for (const enId of [...Object.keys(tgtAnchorsObj), ...Object.values(tgtAnchorsObj)]) {
            if (typeof enId !== 'string') continue;
            const d = dayNumFromAnchorId(enId);
            if (d === null) continue;
            enByDay.set(d, enId.replace(/^#/, ''));
          }
          for (const [d, _frAnchor] of frByDay) {
            const enAnchorId = enByDay.get(d);
            if (!enAnchorId) continue;
            anchorByFrCanonAndDay.set(`${canonicalFr}|day:${d}`, `${tgtBase}#${enAnchorId}`);
          }
        }
      };

      for (const art of articlesFromConfiguredDb) registerArticleUrls(art);
      console.log(
        `🌐 [EXPORT][${lang}] URL resolver : ${urlMap.size} article(s) avec URL en ${lang} `
        + `(articlesDb=${articlesFromConfiguredDb.length}, ancres #N_: ${anchorByFrCanonAndIndex.size}, ancres jour: ${anchorByFrCanonAndDay.size})`
      );
      urlResolver = (frUrl: string) => {
        const hit = urlMap.get(frUrl);
        if (hit !== undefined) return hit;
        const stripped = stripUrlFragment(frUrl);
        if (stripped !== frUrl) {
          const hitStripped = urlMap.get(stripped);
          if (hitStripped !== undefined) return hitStripped;
        }
        return frUrl;
      };
    }

    const slugFromUrlForResolve = (u: string): string | null => {
      try {
        const p = new URL(u).pathname.replace(/\/+$/, '');
        const parts = p.split('/').filter(Boolean);
        if (parts.length === 0) return null;
        const slug = parts[parts.length - 1];
        if (!slug || slug === 'guide') return null;
        return slug.toLowerCase();
      } catch {
        return null;
      }
    };

    /** FR → URL article dans la langue d'export (base + ancre cible si connue en base). */
    const resolveCrossLangArticleUrl = (destination: string): string => {
      if (lang === 'fr') return destination;

      const frag = getUrlFragment(destination);
      let fragInner = frag.startsWith('#') ? frag.slice(1) : frag;
      try {
        fragInner = decodeURIComponent(fragInner);
      } catch {
        /* fragment déjà décodé ou invalide */
      }

      const baseDest = stripUrlFragment(destination);
      const anchorIdx = parseAnchorLeadingIndex(frag);

      let resolved = urlResolver(baseDest);
      if (resolved === baseDest) resolved = urlResolver(destination);
      if (resolved === baseDest) {
        const fromCanonicalFr = urlCanonicalMap.get(normalizeArticleUrl(baseDest, 'fr'));
        if (fromCanonicalFr) resolved = fromCanonicalFr;
      }
      if (resolved === baseDest) {
        const slug = slugFromUrlForResolve(baseDest);
        if (slug && urlSlugMap.has(slug)) resolved = urlSlugMap.get(slug) as string;
      }

      const canonFr = normalizeArticleUrl(baseDest, 'fr');

      if (anchorIdx) {
        const anchored = anchorByFrCanonAndIndex.get(`${canonFr}|${anchorIdx}`);
        if (anchored) return anchored;
        const fragResolved = getUrlFragment(resolved);
        if (parseAnchorLeadingIndex(fragResolved) === anchorIdx) return resolved;
        return stripUrlFragment(resolved);
      }

      const mDay = /\bJour[_\s]*(\d+)\b/i.exec(fragInner) ?? /\bDay[_\s]*(\d+)\b/i.exec(fragInner);
      if (mDay) {
        const dayNum = parseInt(mDay[1], 10);
        const anchoredDay = anchorByFrCanonAndDay.get(`${canonFr}|day:${dayNum}`);
        if (anchoredDay) return anchoredDay;
      }

      if (frag) {
        const fragNorm = fragInner.replace(/\s+/g, '_').replace(/[^\w_-]/g, '_');
        for (const [k, fullUrl] of anchorByFrCanonAndIndex) {
          if (!k.startsWith(`${canonFr}|`)) continue;
          const tail = k.slice(canonFr.length + 1);
          if (tail.startsWith('day:')) continue;
          if (fragNorm.includes(tail) || tail.includes(fragNorm)) return fullUrl;
        }
      }

      return resolved === baseDest ? destination : resolved;
    };

    // ── 5. Construire les pages exportées — passe 1 ────────────────────────
    // Les champs avec service_id sont intentionnellement ignorés ici ;
    // ils seront calculés en passe 2, une fois toutes les pages connues.
    const pages: ExportedPageSnapshot[] = exportablePages.map((page, idx) => {
      const template = templates[page.template_id];
      const content  = page.content || {};
      const fields   = (template?.fields || []) as any[];

      const textFields:  Record<string, string>  = {};
      const imageFields: Record<string, { url: string; indesign_layer: string; local_filename: string; local_path: string }> = {};
      const pictoFields: Record<string, {
        value: string;
        picto_key: string | null;
        indesign_layer: string;
        variant_layer: string | null;
        label: string;
      }> = {};

      for (const field of fields) {
        // Les champs calculés par un service sont ignorés en passe 1
        if (field.service_id) continue;

        const value = content[field.name];
        if (value === undefined || value === null || value === '') continue;

        if (isPictoField(field.name)) {
          const strValue     = String(value);
          const rawLayer     = resolveVariantLayer(field.option_layers, strValue);
          // "non" est toujours inactif : forcer picto_key = null même si option_layers
          // est mal configuré et mappe "non" vers un calque non-null.
          const variantLayer = strValue.toLowerCase() === 'non' ? null : rawLayer;
          pictoFields[field.name] = {
            value:          strValue,
            picto_key:      variantLayer,   // non-null = actif (filtre normalize-export)
            indesign_layer: resolveFieldLayer(field.name, field.indesign_layer),
            variant_layer:  variantLayer,
            label:          field.label || '',
          };
        } else if (field.type === 'image') {
          const pageNum   = String(page.ordre || idx + 1).padStart(3, '0');
          const tplSlug   = (page.template_name || 'page').toLowerCase();
          const fieldSlug = field.name.toLowerCase();
          imageFields[field.name] = {
            url: String(value),
            indesign_layer: resolveFieldLayer(field.name, field.indesign_layer),
            local_filename: `p${pageNum}_${tplSlug}_${fieldSlug}.jpg`,
            local_path: `images/${tplSlug}/`,
          };
        } else {
          // Champ lien structuré {label, url} — sérialiser en JSON string
          // pour que le normaliseur et le script InDesign puissent l'interpréter.
          const linkParsed = parseLinkField(value);
          textFields[field.name] = linkParsed
            ? buildLinkField(linkParsed.label, linkParsed.url)
            : String(value);
        }
      }

      // url_source : résolu en passe 3 (stocké séparément ici pour le return)
      const resolvedUrlSource = page.url_source || null;

      return {
        id: page._id.toString(),
        page_number: page.ordre,
        template: page.template_name || template?.name || 'UNKNOWN',
        section: page.section_id || null,
        titre: page.titre,
        status: page.statut_editorial,
        url_source: resolvedUrlSource,
        entity_meta: {
          page_type:          page.metadata?.page_type          ?? null,
          cluster_id:         page.metadata?.cluster_id         ?? null,
          cluster_name:       page.metadata?.cluster_name       ?? null,
          poi_id:             page.metadata?.poi_id             ?? null,
          poi_name:           page.metadata?.poi_name           ?? null,
          inspiration_id:     page.metadata?.inspiration_id     ?? null,
          inspiration_title:  page.metadata?.inspiration_title  ?? null,
          season:             page.metadata?.saison             ?? null,
        },
        content: {
          text:   textFields,
          images: imageFields,
          pictos: pictoFields,
        },
      } as ExportedPageSnapshot;
    });

    // ── 5b. Passe 2 : calculer les champs service ──────────────────────────
    // On a maintenant la liste complète des pages construites → on peut
    // appeler chaque service avec le contexte global.
    const runner = new FieldServiceRunner();
    const frSommaireToPersist: Array<{ pageId: string; value: string }> = [];

    for (let i = 0; i < exportablePages.length; i++) {
      const rawPage  = exportablePages[i];
      const template = templates[rawPage.template_id];
      const fields   = (template?.fields || []) as any[];

      const serviceFields = fields.filter((f: any) => !!f.service_id);
      if (serviceFields.length === 0) continue;

      for (const field of serviceFields) {
        try {
          const result = await runner.run(field.service_id, {
            guideId,
            guide,
            currentPage:      rawPage,
            allExportedPages: pages,
            db,
            fieldDef:         field,
          });
          // Sommaire : alléger le JSON par page (seules les entrées de cette spread).
          let injected = result.value;
          if (field.service_id === 'sommaire_generator') {
            const tplName = (pages[i].template || '').toUpperCase();
            if (tplName === 'SOMMAIRE') {
              const sommaireSpreadIndex = pages
                .slice(0, i + 1)
                .filter((p) => (p.template || '').toUpperCase() === 'SOMMAIRE').length;
              injected = narrowSommaireJsonForPageExport(String(injected), sommaireSpreadIndex);
              // Persister la source FR de SOMMAIRE_texte_1 pour la traduction ultérieure.
              if (lang === 'fr') {
                frSommaireToPersist.push({
                  pageId: String(rawPage._id),
                  value: String(injected),
                });
              }
            }
          }
          // Injecter la valeur calculée dans le champ texte de la page
          pages[i].content.text[field.name] = injected;

          // Si le champ est de type repetitif, exploser le tableau JSON en champs plats
          // pour que le script InDesign trouve des calques nommés individuellement.
          // Les sous-champs _image_N sont routés vers content.images (format { url, local })
          // car le script InDesign injecte les images depuis content.images uniquement.
          if (field.type === 'repetitif' && result.value) {
            const flat = explodeRepetitifField(field.name, result.value, field.max_repetitions);
            const pageNum = String(rawPage.ordre || i + 1).padStart(3, '0');
            const pageSlug = slugify(rawPage.titre || rawPage.template_name || 'inspiration');
            const pageFolder = `p${pageNum}_${pageSlug}`;
            for (const [k, v] of Object.entries(flat)) {
              if (k.includes('_image_') && typeof v === 'string' && v.startsWith('http')) {
                pages[i].content.images[k] = {
                  url: v,
                  indesign_layer: k,
                  // Evite les collisions entre pages inspiration :
                  // un sous-dossier par page + nom de fichier préfixé page.
                  local_filename: `p${pageNum}_${k.toLowerCase()}.jpg`,
                  local_path: `images/inspiration/${pageFolder}/`,
                };
              } else {
                pages[i].content.text[k] = v;
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ExportService] Service "${field.service_id}" error on page ${rawPage._id}: ${msg}`);
          pages[i].content.text[field.name] = '';
        }
      }
    }

    // ── 5b-ter. Persist FR source sommaire en base ───────────────────────────
    // Garantit que GuideTranslationService lit un SOMMAIRE_texte_1 FR complet
    // (JSON structuré) au lieu d'une valeur partielle/legacy.
    if (lang === 'fr' && frSommaireToPersist.length > 0) {
      try {
        const nowIso = new Date().toISOString();
        await db.collection(COLLECTIONS.pages).bulkWrite(
          frSommaireToPersist.map((it) => ({
            updateOne: {
              filter: { _id: new ObjectId(it.pageId) },
              update: {
                $set: {
                  'content.SOMMAIRE_texte_1': it.value,
                  updated_at: nowIso,
                },
              },
            },
          })),
          { ordered: false }
        );
        console.log(`📝 [EXPORT][fr] SOMMAIRE_texte_1 persisté en base pour ${frSommaireToPersist.length} page(s) SOMMAIRE`);
      } catch (persistErr) {
        console.warn('⚠️ [EXPORT][fr] Échec persistance SOMMAIRE_texte_1 (non bloquant):', persistErr);
      }
    }

    // ── 5b-quater. Injection Carte_lien_1 pour les pages CARTE ─────────────────
    // Résout le lien Mapbox selon la langue demandée :
    //   - surcharge spécifique (map_url_translations[lang]) si disponible,
    //   - sinon fallback sur la version FR (map_url_fr).
    // Injecté en dehors du content éditorial pour ne pas être soumis à la traduction IA.
    for (let i = 0; i < exportablePages.length; i++) {
      const rawPage = exportablePages[i];
      const tpl = rawPage.template_name || '';
      if (tpl !== 'CARTE' && tpl !== 'CARTE_DESTINATION') continue;
      const mapUrl =
        lang !== 'fr' && (rawPage as any).map_url_translations?.[lang]
          ? (rawPage as any).map_url_translations[lang]
          : (rawPage as any).map_url_fr;
      if (mapUrl) {
        pages[i].content.text['Carte_lien_1'] = mapUrl;
      }
    }

    // ── 5b-bis. Snapshot des URLs sources de redirection (stable inter-langues)
    // On capture les URLs avant overlay de traduction pour éviter des écarts
    // de volumétrie entre langues (la base source reste identique).
    type RedirectCandidatePage = {
      template: string;
      titre: string;
      entity_meta: { poi_name: string | null };
    };
    type RedirectCandidate = { rawUrl: string; page: RedirectCandidatePage };
    const TRAILING_PUNCTUATION = '.,;:!?)]}';
    const isFooterLinkFieldKey = (fieldKey: string): boolean =>
      /_lien_|_url_article_/i.test(fieldKey) && !fieldKey.includes('_url_maps_');
    const extractRedirectUrlsFromFieldValue = (value: string): string[] => {
      const urls = new Set<string>();
      const pushIfValid = (raw: string) => {
        const s = raw.trim();
        if (!s || !/^https?:\/\//i.test(s) || isGoogleMapsUrl(s) || isRootUrl(s)) return;
        urls.add(s);
      };

      if (/^https?:\/\//i.test(value)) {
        pushIfValid(value);
        return Array.from(urls);
      }
      const parsedLink = parseLinkField(value);
      if (parsedLink?.url) pushIfValid(parsedLink.url);
      if (value.includes('http://') || value.includes('https://')) {
        for (const m of value.match(/https?:\/\/[^\s"'<>()]+/gi) ?? []) {
          let core = m;
          while (core.length > 0 && TRAILING_PUNCTUATION.includes(core[core.length - 1])) {
            core = core.slice(0, -1);
          }
          pushIfValid(core);
        }
      }
      return Array.from(urls);
    };

    const baseRedirectCandidates: RedirectCandidate[] = [];
    for (const page of pages) {
      const pageRef: RedirectCandidatePage = {
        template: page.template,
        titre: page.titre,
        entity_meta: { poi_name: page.entity_meta.poi_name },
      };

      for (const [fieldKey, fieldValue] of Object.entries(page.content.text)) {
        if (!fieldValue || typeof fieldValue !== 'string') continue;
        if (!isFooterLinkFieldKey(fieldKey)) continue;
        for (const redirectUrl of extractRedirectUrlsFromFieldValue(fieldValue)) {
          baseRedirectCandidates.push({ rawUrl: redirectUrl, page: pageRef });
        }
      }
    }

    // ── 5b. Dictionnaire FR→traduit pour le sommaire (avant la passe 5c) ────────
    // Doit être construit ICI, avant que la passe 5c écrase pages[i].content.text.
    // Le snapshot FR (après passe 2) contient TOUS les champs, y compris les champs
    // générés à l'export (INSPIRATION_TITRE, SECTION_titre_1, etc.) qui ne sont pas
    // dans page.content de MongoDB mais sont bien dans pages[i].content.text à ce stade.
    const frToTranslatedTitle = new Map<string, string>();
    if (lang !== 'fr') {
      for (let i = 0; i < exportablePages.length; i++) {
        const rawPage = exportablePages[i];
        const translatedText: Record<string, string> =
          (rawPage as any).content_translations?.[lang]?.text || {};
        // Snapshot FR AVANT overlay — source de vérité pour la correspondance
        const frSnap = pages[i].content.text;
        for (const [k, trVal] of Object.entries(translatedText)) {
          if (typeof trVal !== 'string' || !trVal.trim()) continue;
          const frVal = frSnap[k];
          if (typeof frVal !== 'string' || !frVal.trim()) continue;
          if (frVal.trim() === trVal.trim()) continue;
          if (frVal.startsWith('{') || frVal.startsWith('[')) continue;
          frToTranslatedTitle.set(frVal.trim(), trVal.trim());
        }
        // Métadonnées non traduits par le LLM (cluster_name, inspiration_title, saison)
        const rawMeta = (rawPage as any).metadata ?? {};
        const entityNames = [
          rawMeta.cluster_name,
          rawMeta.inspiration_title,
          rawMeta.saison,
        ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
        for (const frName of entityNames) {
          if (frToTranslatedTitle.has(frName.trim())) continue;
          // Chercher un champ snapshot FR qui correspond à ce nom pour trouver sa traduction
          for (const [k, frVal] of Object.entries(frSnap)) {
            if (typeof frVal !== 'string') continue;
            if (frVal.trim() === frName.trim() && translatedText[k]?.trim()) {
              frToTranslatedTitle.set(frName.trim(), translatedText[k].trim());
              break;
            }
          }
        }
      }
    }

    // ── 5c. Passe 3 : overlay des traductions ─────────────────────────────────
    // Appliquée APRÈS la passe 2 pour couvrir :
    //  - les champs template classiques (titres, textes…)
    //  - les labels de liens (POI_lien_1, CLUSTER_lien_1, ALLER_PLUS_LOIN_lien_N…)
    //  - les noms dans les blocs répétitifs (INSPIRATION_1_nom_N…) générés par explodeRepetitifField
    if (lang !== 'fr') {
      for (let i = 0; i < exportablePages.length; i++) {
        const rawPage = exportablePages[i];
        const translatedText: Record<string, string> =
          (rawPage as any).content_translations?.[lang]?.text || {};

        for (const [k, v] of Object.entries(translatedText)) {
          if (typeof v !== 'string' || !v.trim()) continue;
          if (!(k in pages[i].content.text)) continue;

          const originalVal = pages[i].content.text[k];
          // Lien JSON {label, url} → reconstruction avec label traduit
          const originalLink = parseLinkField(originalVal);
          if (originalLink && !v.startsWith('{')) {
            pages[i].content.text[k] = buildLinkField(repairStrandedBoldMarkers(v), originalLink.url);
            continue;
          }

          pages[i].content.text[k] = repairStrandedBoldMarkers(v);
        }
      }
    }

    // ── 5d. Passe 4 : résolution des URLs vers la langue cible ────────────────
    // Appliquée APRÈS la passe 3 (overlay) pour que les labels soient déjà traduits
    // quand on reconstruit les objets lien {label, url} avec l'URL résolue.
    // Couvre : URLs brutes, JSON lien {label,url}, url_source de la page.
    if (lang !== 'fr') {
      let resolvedCount = 0;
      let fallbackCount = 0;

      for (const page of pages) {
        for (const k of Object.keys(page.content.text)) {
          const v = page.content.text[k];
          if (!v || typeof v !== 'string') continue;

          if (/^https?:\/\//i.test(v)) {
            const resolved = resolveCrossLangArticleUrl(v);
            if (resolved !== v) resolvedCount++;
            else fallbackCount++;
            page.content.text[k] = resolved;
          } else if (v.startsWith('{')) {
            try {
              const parsed = JSON.parse(v);
              if (parsed && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
                const resolved = resolveCrossLangArticleUrl(parsed.url);
                if (resolved !== parsed.url) resolvedCount++;
                else fallbackCount++;
                parsed.url = resolved;
                page.content.text[k] = JSON.stringify(parsed);
              }
            } catch { /* JSON invalide → laisser tel quel */ }
          }
        }
      }

      // Résolution de url_source sur chaque page
      for (const page of pages) {
        if (page.url_source && /^https?:\/\//i.test(page.url_source)) {
          const resolved = resolveCrossLangArticleUrl(page.url_source);
          if (resolved !== page.url_source) resolvedCount++;
          else fallbackCount++;
          (page as any).url_source = resolved;
        }
      }

      console.log(`🌐 [EXPORT][${lang}] URLs résolues : ${resolvedCount} ✅  |  fallback FR : ${fallbackCount} ⚠️`);
    }

    // ── 5e. Passe 5 : normalisation des URLs internes du site ─────────────────
    // Toutes les URLs d'articles (url_source, champs texte bruts, liens JSON {label,url}
    // et champs _url_article_N) sont remplacées par leur forme normalisée :
    //   https://{host}/guide/{lang}/{slug}/
    // Les URLs Google Maps (champs _url_maps_N) sont exclues.
    // Cette passe s'applique à TOUTES les langues (y compris FR).
    //
    // Cas particulier — pages POI sans article lié (url_source = racine du site) :
    //   Un slug-placeholder est généré depuis le nom du POI + destination du guide :
    //   https://{host}/guide/{lang}/{slug-poi}-{slug-destination}/
    //   La paire (URL normalisée → URL racine) est ajoutée au CSV de redirections.
    //   L'exploitant pourra modifier la destination vers l'URL réelle de l'article
    //   une fois celui-ci rédigé.
    //
    // Les paires (normalisée → destination) sont collectées ici pour
    // générer le CSV de redirections à l'export ZIP.
    const redirectMap = new Map<string, string>();
    const trimHost = (h: string): string => h.toLowerCase().replace(/^www\./, '');
    const internalHosts = new Set<string>();
    try {
      if (guide.wpConfig?.siteUrl) internalHosts.add(trimHost(new URL(guide.wpConfig.siteUrl).host));
    } catch { /* ignore siteUrl invalide */ }
    for (const p of pages) {
      try {
        if (p.url_source) internalHosts.add(trimHost(new URL(p.url_source).host));
      } catch { /* ignore */ }
    }
    const isInternalSiteUrl = (rawUrl: string): boolean => {
      try {
        const u = new URL(rawUrl);
        return internalHosts.has(trimHost(u.host));
      } catch {
        return false;
      }
    };

    const guideDestination: string = guide.destinations?.[0] ?? guide.destination ?? '';

    // Pour une page POI dont l'url_source est le domaine racine, construit
    // une URL normalisée placeholder à partir du nom du POI et de la destination.
    const buildPoiPlaceholderUrl = (rootUrl: string, poiTitle: string): string => {
      try {
        const parsed = new URL(rootUrl);
        const poiSlug  = slugify(poiTitle || '');
        const destSlug = slugify(guideDestination);
        const slug = [poiSlug, destSlug].filter(Boolean).join('-');
        if (!slug) return rootUrl;
        return `${parsed.protocol}//${parsed.host}/guide/${lang}/${slug}/`;
      } catch {
        return rootUrl;
      }
    };

    // Normalisation standard (pour les URLs avec un vrai slug d'article).
    const trackNormalize = (rawUrl: string, collectRedirect = true): string => {
      if (!rawUrl || isGoogleMapsUrl(rawUrl) || !isInternalSiteUrl(rawUrl)) return rawUrl;
      const normalized = normalizeArticleUrl(rawUrl, lang);
      if (collectRedirect && normalized !== rawUrl) redirectMap.set(normalized, rawUrl);
      return normalized;
    };

    // Normalisation tenant compte du contexte de la page :
    // • Pour les pages POI dont l'URL est une URL racine → slug depuis le titre.
    // • Pour toutes les autres URLs avec un slug d'article → normalisation standard.
    const trackNormalizePage = (
      rawUrl: string,
      page: { template: string; titre: string; entity_meta: { poi_name: string | null } },
      collectRedirect = true
    ): string => {
      if (!rawUrl || isGoogleMapsUrl(rawUrl) || !isInternalSiteUrl(rawUrl)) return rawUrl;
      if (page.template.toUpperCase().startsWith('POI') && isRootUrl(rawUrl)) {
        // Préférer entity_meta.poi_name si disponible (plus précis que le titre de la page)
        const name = page.entity_meta.poi_name || page.titre || '';
        const normalized = buildPoiPlaceholderUrl(rawUrl, name);
        if (collectRedirect && normalized !== rawUrl) redirectMap.set(normalized, rawUrl);
        return normalized;
      }
      return trackNormalize(rawUrl, collectRedirect);
    };

    // La table de redirections est construite depuis le snapshot source stable
    // (avant traduction), puis destination traduite par langue.
    for (const candidate of baseRedirectCandidates) {
      trackNormalizePage(candidate.rawUrl, candidate.page, true);
    }

    let normalizedCount = 0;
    for (const page of pages) {
      // url_source de la page
      if (page.url_source && /^https?:\/\//i.test(page.url_source)) {
        const prev = page.url_source;
        (page as any).url_source = trackNormalizePage(page.url_source, page, false);
        if ((page as any).url_source !== prev) normalizedCount++;
      }

      // Champs texte
      for (const k of Object.keys(page.content.text)) {
        // Exclure les champs cartes Google Maps
        if (k.includes('_url_maps_')) continue;

        const v = page.content.text[k];
        if (!v || typeof v !== 'string') continue;

        // Même en EN/DE/… : réécrire les URLs du site dans content.text vers
        // https://{host}/guide/{lang}/{slug}/ (+ ancre slugifiée si #) comme url_source,
        // pour rester aligné avec le CSV de redirections et les hyperliens InDesign.
        // Les domaines non « site » restent inchangés (trackNormalizePage).

        if (/^https?:\/\//i.test(v) && !isGoogleMapsUrl(v)) {
          const prev = v;
          page.content.text[k] = trackNormalizePage(v, page, false);
          if (page.content.text[k] !== prev) normalizedCount++;
        } else if (v.startsWith('{')) {
          try {
            const parsed = JSON.parse(v);
            if (
              parsed &&
              typeof parsed.url === 'string' &&
              /^https?:\/\//i.test(parsed.url) &&
              !isGoogleMapsUrl(parsed.url)
            ) {
              const prev = parsed.url;
              parsed.url = trackNormalizePage(parsed.url, page, false);
              if (parsed.url !== prev) normalizedCount++;
              page.content.text[k] = JSON.stringify(parsed);
            }
          } catch { /* JSON invalide → laisser tel quel */ }
        } else if (v.includes('http://') || v.includes('https://')) {
          const prev = v;
          page.content.text[k] = v.replace(/https?:\/\/[^\s"'<>()]+/gi, (matchedUrl) => {
            let core = matchedUrl;
            let suffix = '';
            while (core.length > 0 && TRAILING_PUNCTUATION.includes(core[core.length - 1])) {
              suffix = core[core.length - 1] + suffix;
              core = core.slice(0, -1);
            }
            if (!core) return matchedUrl;
            const normalized = trackNormalizePage(core, page, false);
            if (normalized !== core) normalizedCount++;
            return `${normalized}${suffix}`;
          });
          if (page.content.text[k] === prev) {
            // aucune URL interne réécrite dans ce champ texte
          }
        }
      }
    }

    console.log(`🔗 [EXPORT][${lang}] URLs normalisées : ${normalizedCount} | redirections uniques : ${redirectMap.size}`);

    /** Suffixe après « -- » dans le dernier segment /guide/{lang}/slug--suffix/ (ancre slugifiée). */
    const parseAnchorSuffixFromNormalized = (normalized: string): string | null => {
      try {
        const u = new URL(normalized);
        const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        const last = parts[parts.length - 1] ?? '';
        const sep = last.indexOf('--');
        if (sep < 0) return null;
        return last.slice(sep + 2);
      } catch {
        return null;
      }
    };

    /**
     * Si la résolution depuis l’URL FR (#…) ne produit pas d’ancre EN, on retente depuis
     * le suffixe « --… » de l’URL normalisée (même info que le hash, slugifiée pour le CSV).
     * Cas typique : --jour-2-parc-… vs ancres #9-… qui matchent déjà via parseAnchorLeadingIndex.
     */
    const resolveDestinationWithNormalizedAnchorFallback = (
      normalized: string,
      frDestination: string
    ): string => {
      const dest = resolveCrossLangArticleUrl(frDestination);
      if (lang === 'fr') return dest;
      if (getUrlFragment(dest)) return dest;

      const anchorSuffix = parseAnchorSuffixFromNormalized(normalized);
      if (!anchorSuffix) return dest;

      const baseFr = stripUrlFragment(frDestination);
      const canonFr = normalizeArticleUrl(baseFr, 'fr');

      const mIdx = /^(\d+)-/.exec(anchorSuffix);
      if (mIdx) {
        const idx = mIdx[1];
        const anchored = anchorByFrCanonAndIndex.get(`${canonFr}|${idx}`);
        if (anchored) return anchored;
      }

      const mJour = /^jour-(\d+)/i.exec(anchorSuffix) ?? /^day-(\d+)/i.exec(anchorSuffix);
      if (mJour) {
        const d = parseInt(mJour[1], 10);
        const anchoredDay = anchorByFrCanonAndDay.get(`${canonFr}|day:${d}`);
        if (anchoredDay) return anchoredDay;
      }

      return dest;
    };

    const redirectPairs: RedirectPair[] = Array.from(redirectMap.entries()).map(
      ([normalized, destination]) => ({
        normalized,
        destination: resolveDestinationWithNormalizedAnchorFallback(normalized, destination),
      })
    );

    // ── 5f. Aligner les liens JSON sur les clés de redirection ───────────────
    // Le JSON exporté doit pointer vers l'URL normalisée (source de redirection),
    // pas vers la destination finale. Ainsi, InDesign/PDF et le CSV restent cohérents.
    if (lang !== 'fr' && redirectPairs.length > 0) {
      const normalizedByDestination = new Map<string, string>();
      const putNormalized = (destinationUrl: string, normalizedUrl: string) => {
        normalizedByDestination.set(destinationUrl, normalizedUrl);
        const destinationNoHash = stripUrlFragment(destinationUrl);
        const normalizedNoHash = stripUrlFragment(normalizedUrl);
        if (destinationNoHash) {
          normalizedByDestination.set(destinationNoHash, normalizedNoHash || normalizedUrl);
        }
      };

      for (const pair of redirectPairs) {
        putNormalized(pair.destination, pair.normalized);
        // Après résolution cross-langue, la passe 5e appelle normalizeArticleUrl() sur
        // l'URL destination (ex. /en/national-park-teide-.../), ce qui produit un
        // /guide/{lang}/{slug-dernier-segment}/ qui ne suit pas la nomenclature FR
        // du CSV. Indexer aussi cette forme pour la réécrire vers pair.normalized.
        try {
          if (
            pair.destination &&
            /^https?:\/\//i.test(pair.destination) &&
            isInternalSiteUrl(pair.destination)
          ) {
            const wrongGuideGuess = normalizeArticleUrl(pair.destination, lang);
            if (wrongGuideGuess && wrongGuideGuess !== pair.normalized) {
              putNormalized(wrongGuideGuess, pair.normalized);
            }
          }
        } catch { /* URL invalide */ }
      }

      const mapToNormalizedIfKnown = (rawUrl: string): string => {
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || isGoogleMapsUrl(rawUrl)) return rawUrl;
        return normalizedByDestination.get(rawUrl)
          ?? normalizedByDestination.get(stripUrlFragment(rawUrl))
          ?? rawUrl;
      };

      for (const page of pages) {
        if (page.url_source && /^https?:\/\//i.test(page.url_source)) {
          (page as any).url_source = mapToNormalizedIfKnown(page.url_source);
        }

        for (const k of Object.keys(page.content.text)) {
          if (k.includes('_url_maps_')) continue;
          const v = page.content.text[k];
          if (!v || typeof v !== 'string') continue;

          if (/^https?:\/\//i.test(v)) {
            page.content.text[k] = mapToNormalizedIfKnown(v);
          } else if (v.startsWith('{')) {
            try {
              const parsed = JSON.parse(v);
              if (parsed && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
                parsed.url = mapToNormalizedIfKnown(parsed.url);
                page.content.text[k] = JSON.stringify(parsed);
              }
            } catch { /* JSON invalide -> laisser tel quel */ }
          } else if (v.includes('http://') || v.includes('https://')) {
            page.content.text[k] = v.replace(/https?:\/\/[^\s"'<>()]+/gi, (matchedUrl) => {
              let core = matchedUrl;
              let suffix = '';
              while (core.length > 0 && TRAILING_PUNCTUATION.includes(core[core.length - 1])) {
                suffix = core[core.length - 1] + suffix;
                core = core.slice(0, -1);
              }
              if (!core) return matchedUrl;
              const mapped = mapToNormalizedIfKnown(core);
              return `${mapped}${suffix}`;
            });
          }
        }
      }
    }

    // ── 5g. Sommaire : mise à jour des titres vers la langue cible ───────────
    // Les titres du sommaire sont traduits via le LLM (SOMMAIRE_titre_N dans content_translations)
    // et complétés par le dictionnaire frToTranslatedTitle de la passe 5b pour les champs content.
    if (lang !== 'fr') {
      // Construire un dictionnaire FR→traduit spécifique au sommaire depuis les pages SOMMAIRE
      // en lisant les SOMMAIRE_titre_N stockés par guide-translation.service lors de la traduction.
      const sommaireSpecificMap = new Map<string, string>();
      for (let i = 0; i < exportablePages.length; i++) {
        const rawPage = exportablePages[i];
        const tpl = (pages[i]?.template ?? '').toUpperCase();
        if (!tpl.startsWith('SOMMAIRE')) continue;

        const translatedText: Record<string, string> =
          (rawPage as any).content_translations?.[lang]?.text || {};
        const rawSommaireJson: string | undefined = (rawPage as any).content?.['SOMMAIRE_texte_1'];
        if (!rawSommaireJson) continue;

        try {
          const fullJson = JSON.parse(rawSommaireJson) as {
            schema_version?: number;
            entries?: Array<{ title?: string }>;
          };
          if (fullJson?.schema_version !== 1 || !Array.isArray(fullJson.entries)) continue;

          // Reconstituer la correspondance positionnelle construite par extractTranslatableFields.
          // La clé est `SOMMAIRE_texte_1_entry_N` (même logique que extractTranslatableFields)
          // pour éviter la collision avec le champ template SOMMAIRE_titre_1 = "Sommaire".
          const seen = new Set<string>();
          let idx = 0;
          for (const entry of fullJson.entries) {
            const frTitle = entry.title?.trim();
            if (frTitle && !seen.has(frTitle)) {
              seen.add(frTitle);
              idx++;
              const trTitle = translatedText[`SOMMAIRE_texte_1_entry_${idx}`]?.trim();
              if (trTitle && trTitle !== frTitle) {
                sommaireSpecificMap.set(frTitle, trTitle);
              }
            }
          }
        } catch { /* JSON invalide → ignorer */ }
      }

      // Mettre à jour le JSON sommaire de chaque page SOMMAIRE
      // Priorité : sommaireSpecificMap (LLM) > frToTranslatedTitle (snapshot contenu)
      for (const page of pages) {
        const tpl = page.template.toUpperCase();
        if (!tpl.startsWith('SOMMAIRE')) continue;
        const raw = page.content.text['SOMMAIRE_texte_1'];
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as import('./field-service-runner.service.js').SommaireJsonV1;
          if (!parsed || parsed.schema_version !== 1 || !Array.isArray(parsed.entries)) continue;
          let changed = false;
          for (const entry of parsed.entries) {
            const frTitle = entry.title?.trim() ?? '';
            const translated =
              sommaireSpecificMap.get(frTitle) ??
              frToTranslatedTitle.get(frTitle) ??
              null;
            if (translated && translated !== frTitle) {
              entry.title = translated;
              changed = true;
            }
          }
          if (changed) {
            parsed.entries_by_sommaire_page = {
              '1': parsed.entries.filter((e) => e.sommaire_page === 1),
              '2': parsed.entries.filter((e) => e.sommaire_page === 2),
            } as any;
            parsed.legacy_text = (await import('./field-service-runner.service.js')).sommaireEntriesToLegacyText(parsed.entries);
            page.content.text['SOMMAIRE_texte_1'] = JSON.stringify(parsed);
          }
        } catch { /* JSON sommaire invalide → conserver tel quel */ }
      }
    }

    // ── 5h. Marqueurs ** (traduction / LLM) sur tout le texte exporté ─────────
    // Dernière passe : tous les champs (toutes langues), y compris liens {label}.
    for (const page of pages) {
      for (const k of Object.keys(page.content.text)) {
        if (k.includes('_url_maps_')) continue;
        const v = page.content.text[k];
        if (!v || typeof v !== 'string' || !v.includes('**')) continue;
        const link = parseLinkField(v);
        if (link) {
          const fixedLabel = repairStrandedBoldMarkers(link.label);
          if (fixedLabel !== link.label) {
            page.content.text[k] = buildLinkField(fixedLabel, link.url);
          }
          continue;
        }
        const fixed = repairStrandedBoldMarkers(v);
        if (fixed !== v) page.content.text[k] = fixed;
      }
    }

    // ── 6. Construire le mapping field→calque depuis les templates réels ──────
    const dynamicFieldLayers: Record<string, string> = {};
    const bulletListFields: string[] = [];

    for (const tpl of Object.values(templates)) {
      for (const field of (tpl.fields ?? [])) {
        dynamicFieldLayers[field.name] = resolveFieldLayer(field.name, field.indesign_layer);
        if (field.type === 'liste') {
          bulletListFields.push(field.name);
        }
      }
    }
    // ── 7. Construire le JSON final ────────────────────────────────────────
    return {
      meta: {
        guide_id:     guideId,
        guide_name:   guide.name,
        destination:  guide.destinations?.[0] ?? guide.destination ?? '',
        year:         guide.year,
        language:     lang,
        version:      guide.version || '1.0.0',
        exported_at:  new Date().toISOString(),
        api_build:    'v2.3.0-simplified_pictos',
        stats: {
          total_pages:     allPages.length,
          exported:        exportablePages.length,
          excluded_draft:  draftPages.length,
          excluded_statuses: [...new Set(draftPages.map(p => p.statut_editorial))],
        },
      },

      mappings: {
        // Mapping dynamique construit depuis les templates réels — toujours à jour
        fields: dynamicFieldLayers,
        // Noms de tous les champs de type 'liste' — le script InDesign les traite en puces
        bullet_fields: bulletListFields,
      },

      pages,

      /** Paires URL normalisée → URL destination pour générer le CSV de redirections */
      redirectPairs,
    };
  }
}
