/**
 * Régénération ciblée de champs picto pour les pages POI d'une destination.
 *
 * Usage (depuis apps/api) :
 *   MONGODB_URI=... OPENAI_API_KEY=... npx tsx src/scripts/regenerate-poi-fields.ts
 *
 * Variables d'environnement :
 *   MONGODB_URI          URI de connexion MongoDB (obligatoire)
 *   MONGODB_DB_NAME      Nom de la base (défaut : redactor_guide)
 *   OPENAI_API_KEY       Clé OpenAI (obligatoire)
 *   TARGET_DESTINATION   Destination à cibler (défaut : Tenerife)
 *   DRY_RUN              Si "true", affiche les pages sans générer (défaut : false)
 *   DELAY_MS             Délai entre chaque appel IA en ms (défaut : 1500)
 */

import { MongoClient, ObjectId } from 'mongodb';
import { PageRedactionService } from '../services/page-redaction.service.js';
import { COLLECTIONS } from '../config/collections.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const FIELDS_TO_REGENERATE = [
  'POI_picto_8',  // Payant (nouveau champ — POI_picto_8 dans le template)
  'POI_picto_1',  // Intérêt touristique (prompt modifié — POI_picto_1 dans le template non migré)
];

const TARGET_DESTINATION = process.env.TARGET_DESTINATION || 'Tenerife';
const GENERATED_STATUSES = ['generee_ia', 'non_conforme', 'relue', 'validee', 'texte_coule', 'visuels_montes'];
const DRY_RUN   = process.env.DRY_RUN === 'true';
const DELAY_MS  = parseInt(process.env.DELAY_MS || '1500', 10);

const MONGODB_URI     = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'redactor_guide';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

if (!MONGODB_URI)     { console.error('❌ MONGODB_URI manquant');     process.exit(1); }
if (!OPENAI_API_KEY)  { console.error('❌ OPENAI_API_KEY manquante'); process.exit(1); }

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function pad(n: number, t: number) { return String(n).padStart(String(t).length, ' '); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       Régénération ciblée de champs POI              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`📍 Destination    : ${TARGET_DESTINATION}`);
  console.log(`🎯 Champs ciblés  : ${FIELDS_TO_REGENERATE.join(', ')}`);
  console.log(`🔬 Mode           : ${DRY_RUN ? 'DRY RUN (simulation)' : 'PRODUCTION'}`);
  console.log(`⏱️  Délai IA       : ${DELAY_MS}ms`);
  console.log('');

  const client = new MongoClient(MONGODB_URI!);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  console.log(`✅ Connecté à MongoDB (${MONGODB_DB_NAME})`);

  const redactionService = new PageRedactionService(db, OPENAI_API_KEY!);

  try {
    // ── 1. Trouver le guide ────────────────────────────────────────────────────
    const guide = await db.collection(COLLECTIONS.guides).findOne({
      $or: [
        { destination:  { $regex: TARGET_DESTINATION, $options: 'i' } },
        { destinations: { $elemMatch: { $regex: TARGET_DESTINATION, $options: 'i' } } },
        { name:         { $regex: TARGET_DESTINATION, $options: 'i' } },
      ],
    });
    if (!guide) {
      console.error(`❌ Aucun guide pour "${TARGET_DESTINATION}"`);
      process.exit(1);
    }
    console.log(`📖 Guide : ${guide.name} (${guide._id})`);

    // ── 2. Chemin de fer ──────────────────────────────────────────────────────
    const cdf = await db.collection(COLLECTIONS.chemins_de_fer).findOne({ guide_id: guide._id.toString() });
    if (!cdf) { console.error('❌ Chemin de fer introuvable'); process.exit(1); }

    // ── 3. Pages POI générées ─────────────────────────────────────────────────
    const pages = await db.collection(COLLECTIONS.pages).find({
      chemin_de_fer_id: cdf._id.toString(),
      statut_editorial: { $in: GENERATED_STATUSES },
      $or: [
        { 'metadata.page_type': 'poi' },
        { template_name: { $regex: /^poi/i } },
      ],
    }).sort({ ordre: 1 }).toArray();

    console.log(`\n📄 Pages POI générées trouvées : ${pages.length}`);
    if (pages.length === 0) { await client.close(); return; }

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const label = p.titre || p.metadata?.poi_name || p._id.toString();
      console.log(`  ${pad(i + 1, pages.length)}. [${p.statut_editorial}] ${label}`);
    }
    console.log('');

    if (DRY_RUN) {
      console.log('🔬 DRY RUN — retirez DRY_RUN=true pour exécuter.');
      await client.close();
      return;
    }

    // ── 4. Régénération ───────────────────────────────────────────────────────
    let success = 0, errors = 0;

    for (let i = 0; i < pages.length; i++) {
      const page   = pages[i];
      const pageId = page._id.toString();
      const label  = page.titre || page.metadata?.poi_name || pageId;

      console.log(`\n[${pad(i + 1, pages.length)}/${pages.length}] ${label}  (${page.statut_editorial})`);

      // Pages sans article source valide → mode base de connaissance LLM
      const hasValidUrl = (() => {
        if (!page.url_source) return false;
        try { return new URL(page.url_source).pathname.replace(/\//g, '').length > 0; }
        catch { return false; }
      })();
      if (!hasValidUrl) console.log(`   ℹ️  Pas d'article source → mode LLM`);

      try {
        const result = await redactionService.generatePageContent(
          guide._id.toString(),
          pageId,
          { onlyFields: FIELDS_TO_REGENERATE, useLlmKnowledge: !hasValidUrl }
        );

        if (result.status === 'error') {
          console.error(`   ❌ Erreur IA : ${result.error}`);
          errors++;
        } else {
          const setFields: Record<string, any> = { updated_at: new Date().toISOString() };
          let updated = 0;
          for (const f of FIELDS_TO_REGENERATE) {
            if (result.content[f] !== undefined) {
              setFields[`content.${f}`] = result.content[f];
              console.log(`   ✓ ${f} = ${JSON.stringify(result.content[f])}`);
              updated++;
            } else {
              console.warn(`   ⚠️  ${f} : pas de valeur retournée`);
            }
          }
          if (updated > 0) {
            await db.collection(COLLECTIONS.pages).updateOne(
              { _id: new ObjectId(pageId) },
              { $set: setFields }   // statut_editorial préservé intentionnellement
            );
            console.log(`   ✅ ${updated} champ(s) patchés (statut préservé)`);
            success++;
          } else {
            errors++;
          }
        }
      } catch (err: any) {
        console.error(`   ❌ Exception : ${err.message}`);
        errors++;
      }

      if (i < pages.length - 1) await sleep(DELAY_MS);
    }

    // ── 5. Bilan ──────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════');
    console.log(`✅ Succès  : ${success}/${pages.length}`);
    if (errors > 0) console.log(`❌ Erreurs : ${errors}/${pages.length}`);
    console.log('══════════════════════════════════════');

  } finally {
    await client.close();
    console.log('\n🔌 Connexion MongoDB fermée.');
  }
}

main().catch(err => { console.error('❌ Erreur fatale :', err); process.exit(1); });
