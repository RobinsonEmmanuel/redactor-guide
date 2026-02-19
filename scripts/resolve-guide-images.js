#!/usr/bin/env node
/**
 * CLI — Résolution des images d'un export de guide
 *
 * Usage :
 *   node scripts/resolve-guide-images.js <guide_export.json> [outputFolder]
 *
 * Exemples :
 *   node scripts/resolve-guide-images.js ./guide_tenerife_2026_fr.json
 *   node scripts/resolve-guide-images.js ./guide_tenerife_2026_fr.json ./output/tenerife
 *
 * Le script :
 *   1. Lit le JSON d'export produit par /api/v1/guides/:id/export
 *   2. Télécharge toutes les images distantes dans outputFolder (avec cache)
 *   3. Ajoute le champ "local" à chaque objet image
 *   4. Écrit un nouveau fichier JSON résolu (suffixe _resolved)
 *
 * Structure de sortie :
 *   ./output/tenerife_2026_fr/
 *     images/poi/        ← images POI
 *     images/cluster/    ← images Cluster
 *     images/couverture/ ← images Couverture
 *     ...
 *   ./guide_tenerife_2026_fr_resolved.json ← JSON avec champs "local" ajoutés
 */

const fs   = require('fs');
const path = require('path');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  const [,, jsonFilePath, customOutputFolder] = process.argv;

  if (!jsonFilePath) {
    console.error('❌  Usage: node resolve-guide-images.js <guide_export.json> [outputFolder]');
    process.exit(1);
  }

  if (!fs.existsSync(jsonFilePath)) {
    console.error(`❌  Fichier introuvable: ${jsonFilePath}`);
    process.exit(1);
  }

  // Lire le JSON
  let guideJson;
  try {
    guideJson = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  } catch (err) {
    console.error(`❌  Impossible de lire le JSON: ${err.message}`);
    process.exit(1);
  }

  if (!guideJson.meta || !Array.isArray(guideJson.pages)) {
    console.error('❌  Format JSON non reconnu — assurez-vous d\'utiliser le JSON produit par /api/v1/guides/:id/export');
    process.exit(1);
  }

  // Déterminer le outputFolder
  const { destination, year, language } = guideJson.meta;
  const slug = slugify(destination || 'guide');
  const outputFolder = customOutputFolder
    || path.join(path.dirname(jsonFilePath), 'assets', `${slug}_${year}_${language}`);

  console.log(`\n📖  Guide : ${guideJson.meta.guide_name}`);
  console.log(`🌍  Destination : ${destination} — ${year} — ${language}`);
  console.log(`📂  OutputFolder : ${outputFolder}`);
  console.log(`📄  Pages exportables : ${guideJson.meta.stats?.exported || guideJson.pages.length}\n`);

  // Résolution
  const { stats } = await resolveImagesForGuide(guideJson, outputFolder, {
    concurrency:  5,
    skipExisting: true,
    timeout:      20_000,
  });

  // Écriture du JSON résolu
  const ext      = path.extname(jsonFilePath);
  const base     = path.basename(jsonFilePath, ext);
  const dir      = path.dirname(jsonFilePath);
  const outJson  = path.join(dir, `${base}_resolved${ext}`);

  fs.writeFileSync(outJson, JSON.stringify(guideJson, null, 2), 'utf-8');

  console.log(`\n📦  JSON résolu écrit : ${outJson}`);
  console.log(`\n📊  Bilan :`);
  console.log(`    • Total images   : ${stats.total}`);
  console.log(`    • Téléchargées   : ${stats.downloaded}`);
  console.log(`    • En cache       : ${stats.skipped}`);
  console.log(`    • Échecs         : ${stats.failed}`);

  if (stats.failed > 0) {
    console.warn(`\n⚠️   ${stats.failed} image(s) n'ont pas pu être téléchargées (URLs non accessibles).`);
    console.warn(`    Les champs "local" correspondants sont absents dans le JSON résolu.`);
    process.exit(0); // Pas une erreur bloquante
  }
}

// ─── Helpers inline (pas de dépendance externe) ───────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

async function downloadImage(url, destPath, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'redactor-guide/1.0 (image-resolver)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('Corps vide');
    await pipeline(res.body, createWriteStream(destPath));
  } finally {
    clearTimeout(timer);
  }
}

async function pLimit(tasks, concurrency) {
  let i = 0;
  async function worker() {
    while (i < tasks.length) { await tasks[i++](); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

async function resolveImagesForGuide(guideJson, outputFolder, opts = {}) {
  const { concurrency = 5, skipExisting = true, timeout = 15_000 } = opts;
  fs.mkdirSync(outputFolder, { recursive: true });

  const tasks = [];
  for (const page of guideJson.pages) {
    for (const [, image] of Object.entries(page.content?.images || {})) {
      if (image.url) tasks.push({ image });
    }
  }

  if (!tasks.length) { console.log('Aucune image à résoudre.'); return { guideJson, stats: { total:0, downloaded:0, skipped:0, failed:0 } }; }

  const stats = { total: tasks.length, downloaded: 0, skipped: 0, failed: 0 };

  const work = tasks.map(({ image }) => async () => {
    const subDir  = path.join(outputFolder, image.local_path);
    const absPath = path.join(subDir, image.local_filename);
    const relPath = (image.local_path + image.local_filename).replace(/\\/g, '/');

    fs.mkdirSync(subDir, { recursive: true });

    if (skipExisting && fs.existsSync(absPath)) {
      console.log(`  ⏭  [skip]  ${relPath}`);
      image.local = relPath;
      stats.skipped++;
      return;
    }

    try {
      await downloadImage(image.url, absPath, timeout);
      image.local = relPath;
      stats.downloaded++;
      console.log(`  ✅ [ok]    ${relPath}`);
    } catch (err) {
      console.warn(`  ⚠️  [fail]  ${image.local_filename} — ${err.message}`);
      stats.failed++;
    }
  });

  await pLimit(work, concurrency);
  return { guideJson, stats };
}

main().catch(err => { console.error('❌  Erreur fatale:', err.message); process.exit(1); });
