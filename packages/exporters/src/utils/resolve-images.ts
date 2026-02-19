import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportImageField {
  /** URL distante de l'image */
  url: string;
  /** Nom de fichier normalisé (ex: p012_poi_grand_rond.jpg) */
  local_filename: string;
  /** Sous-dossier relatif au outputFolder (ex: images/poi/) */
  local_path: string;
  /** Chemin local résolu, relatif au outputFolder — ajouté après résolution */
  local?: string;
}

export interface GuideExportPage {
  id: string;
  page_number: number;
  template: string;
  section: string | null;
  titre: string;
  status: string;
  url_source: string | null;
  content: {
    text: Record<string, string>;
    images: Record<string, ExportImageField>;
    pictos: Record<string, {
      value: string;
      picto_key: string | null;
      indesign_layer: string;
      label: string;
    }>;
  };
}

export interface GuideExportJson {
  meta: {
    guide_id: string;
    guide_name: string;
    destination: string;
    year: number;
    language: string;
    version: string;
    exported_at: string;
    stats: {
      total_pages: number;
      exported: number;
      excluded_draft: number;
      excluded_statuses: string[];
    };
  };
  mappings: Record<string, unknown>;
  pages: GuideExportPage[];
}

export interface ResolveOptions {
  /** Nombre de téléchargements en parallèle (défaut: 5) */
  concurrency?: number;
  /** Passer les images déjà présentes sans re-télécharger (défaut: true) */
  skipExisting?: boolean;
  /** Timeout en ms par image (défaut: 15000) */
  timeout?: number;
  /** Logger custom (défaut: console) */
  logger?: {
    info:  (msg: string) => void;
    warn:  (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface ResolveResult {
  /** JSON muté avec les champs local remplis */
  guideJson: GuideExportJson;
  stats: {
    total:    number;
    downloaded: number;
    skipped:  number;
    failed:   number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Construit le outputFolder par défaut si non fourni :
 * `assets/{destination_slug}_{year}_{language}/`
 */
export function defaultOutputFolder(guideJson: GuideExportJson): string {
  const { destination, year, language } = guideJson.meta;
  return path.join('assets', `${slugify(destination)}_${year}_${language}`);
}

/**
 * Télécharge une image distante vers un fichier local.
 * Utilise Node.js fetch (v18+) + stream/pipeline pour éviter la RAM.
 */
async function downloadImage(
  url: string,
  destPath: string,
  timeout: number
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'redactor-guide/1.0 (image-resolver)' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    if (!res.body) throw new Error('Corps de réponse vide');

    // Écriture en streaming (n'accumule pas en mémoire)
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exécute des tâches en parallèle avec une limite de concurrence.
 */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function worker(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Résout toutes les images distantes d'un guide JSON exporté.
 *
 * Pour chaque image dans `pages[].content.images` :
 *   1. Crée le sous-dossier `{outputFolder}/{local_path}/`
 *   2. Télécharge l'image si elle n'existe pas (cache)
 *   3. Ajoute le champ `local` (chemin relatif au outputFolder)
 *
 * @param guideJson   - JSON d'export produit par export.service.ts
 * @param outputFolder - Racine locale (ex: "./assets/tenerife_2026_fr")
 * @param options     - Options (concurrence, cache, timeout, logger)
 * @returns Le JSON muté + statistiques
 *
 * @example
 * const { guideJson, stats } = await resolveImagesForGuide(json, './output/tenerife_fr');
 * // image avant : { url: "https://...", local_filename: "p012_poi.jpg", local_path: "images/poi/" }
 * // image après : { url: "https://...", local_filename: "p012_poi.jpg", local_path: "images/poi/", local: "images/poi/p012_poi.jpg" }
 */
export async function resolveImagesForGuide(
  guideJson: GuideExportJson,
  outputFolder: string,
  options: ResolveOptions = {}
): Promise<ResolveResult> {
  const {
    concurrency  = 5,
    skipExisting = true,
    timeout      = 15_000,
    logger       = console,
  } = options;

  // Créer le dossier racine
  fs.mkdirSync(outputFolder, { recursive: true });

  // Collecter toutes les tâches d'image
  type ImageTask = {
    page: GuideExportPage;
    fieldName: string;
    image: ExportImageField;
  };

  const tasks: ImageTask[] = [];

  for (const page of guideJson.pages) {
    for (const [fieldName, image] of Object.entries(page.content.images)) {
      if (image.url) tasks.push({ page, fieldName, image });
    }
  }

  if (tasks.length === 0) {
    logger.info('Aucune image à résoudre.');
    return { guideJson, stats: { total: 0, downloaded: 0, skipped: 0, failed: 0 } };
  }

  logger.info(`📸 Résolution de ${tasks.length} image(s) — concurrence: ${concurrency}`);

  const stats = { total: tasks.length, downloaded: 0, skipped: 0, failed: 0 };

  const work = tasks.map(({ image }) => async () => {
    const subDir  = path.join(outputFolder, image.local_path);
    const absPath = path.join(subDir, image.local_filename);
    const relPath = path.join(image.local_path, image.local_filename)
                       .replace(/\\/g, '/'); // normalise les séparateurs Windows

    // Créer le sous-dossier si nécessaire
    fs.mkdirSync(subDir, { recursive: true });

    // Cache : passer si le fichier existe déjà
    if (skipExisting && fs.existsSync(absPath)) {
      logger.info(`  ⏭  [skip]  ${relPath}`);
      image.local = relPath;
      stats.skipped++;
      return;
    }

    try {
      await downloadImage(image.url, absPath, timeout);
      image.local = relPath;
      stats.downloaded++;
      logger.info(`  ✅ [ok]    ${relPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`  ⚠️  [fail]  ${image.local_filename} — ${msg} (url: ${image.url})`);
      // Ne pas bloquer le pipeline : on n'ajoute pas le champ local
      stats.failed++;
    }
  });

  await pLimit(work, concurrency);

  logger.info(
    `\n✅ Résolution terminée : ${stats.downloaded} téléchargées, ` +
    `${stats.skipped} en cache, ${stats.failed} échec(s) sur ${stats.total}`
  );

  return { guideJson, stats };
}
