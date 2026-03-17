/**
 * Régénération ciblée de champs picto pour les pages POI d'une destination.
 *
 * Ce script régénère UNIQUEMENT les champs spécifiés dans FIELDS_TO_REGENERATE
 * sur les pages POI déjà générées (statut != 'draft') de la destination cible.
 * Le reste du contenu (textes, images, autres pictos) est intégralement préservé.
 *
 * Usage (depuis la racine du projet) :
 *   MONGODB_URI=... OPENAI_API_KEY=... npx tsx scripts/regenerate-poi-fields.ts
 *
 * Variables d'environnement (ou via .env.local dans apps/api) :
 *   MONGODB_URI       URI de connexion MongoDB (obligatoire)
 *   MONGODB_DB_NAME   Nom de la base (défaut : redactor_guide)
 *   OPENAI_API_KEY    Clé OpenAI (obligatoire)
 *   TARGET_DESTINATION  Destination à cibler (défaut : Tenerife)
 *   DRY_RUN           Si "true", affiche les pages sans générer (défaut : false)
 *   DELAY_MS          Délai entre chaque appel IA en ms (défaut : 2000)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';

// Charger le .env.local de l'API si présent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../apps/api/.env.local') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

// ─── Configuration ────────────────────────────────────────────────────────────

/** Champs à régénérer sur chaque page POI */
const FIELDS_TO_REGENERATE = [
  'POI_picto_8',        // Payant (nouveau champ)
  'POI_picto_interet',  // Intérêt touristique (prompt modifié)
];

/** Destination ciblée */
const TARGET_DESTINATION = process.env.TARGET_DESTINATION || 'Tenerife';

/** Statuts éditoriaux considérés comme "déjà générés" (à patcher) */
const GENERATED_STATUSES = ['generee_ia', 'non_conforme', 'relue', 'validee', 'texte_coule', 'visuels_montes'];

/** Mode simulation : affiche sans générer */
const DRY_RUN = process.env.DRY_RUN === 'true';

/** Délai entre chaque appel IA pour éviter le rate limiting (ms) */
const DELAY_MS = parseInt(process.env.DELAY_MS || '2000', 10);

// ─── Vérification des variables d'environnement ───────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'redactor_guide';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant. Ajoutez-le en variable d\'environnement.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY manquant. Ajoutez-le en variable d\'environnement.');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pad(n: number, total: number): string {
  return String(n).padStart(String(total).length, ' ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       Régénération ciblée de champs POI              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📍 Destination    : ${TARGET_DESTINATION}`);
  console.log(`🎯 Champs ciblés  : ${FIELDS_TO_REGENERATE.join(', ')}`);
  console.log(`🔬 Mode           : ${DRY_RUN ? 'DRY RUN (simulation)' : 'PRODUCTION'}`);
  console.log(`⏱️  Délai IA       : ${DELAY_MS}ms`);
  console.log('');

  // ── 1. Connexion MongoDB ──────────────────────────────────────────────────
  const client = new MongoClient(MONGODB_URI!);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  console.log(`✅ Connecté à MongoDB (${MONGODB_DB_NAME})`);

  // Importation dynamique du service (ESM)
  const { PageRedactionService } = await import('../apps/api/src/services/page-redaction.service.js');
  const redactionService = new PageRedactionService(db, OPENAI_API_KEY!);

  try {
    // ── 2. Trouver le guide de la destination ────────────────────────────────
    const guide = await db.collection('guides').findOne({
      $or: [
        { destination: { $regex: TARGET_DESTINATION, $options: 'i' } },
        { destinations: { $elemMatch: { $regex: TARGET_DESTINATION, $options: 'i' } } },
        { name: { $regex: TARGET_DESTINATION, $options: 'i' } },
      ],
    });

    if (!guide) {
      console.error(`❌ Aucun guide trouvé pour la destination "${TARGET_DESTINATION}"`);
      await client.close();
      process.exit(1);
    }
    console.log(`📖 Guide trouvé : ${guide.name} (${guide._id})`);

    // ── 3. Trouver le chemin de fer du guide ─────────────────────────────────
    const cheminDeFer = await db.collection('chemins_de_fer').findOne({
      guide_id: guide._id.toString(),
    });

    if (!cheminDeFer) {
      console.error(`❌ Chemin de fer introuvable pour le guide "${guide.name}"`);
      await client.close();
      process.exit(1);
    }

    // ── 4. Récupérer les pages POI générées ──────────────────────────────────
    const poiPages = await db.collection('pages').find({
      chemin_de_fer_id: cheminDeFer._id.toString(),
      statut_editorial: { $in: GENERATED_STATUSES },
      $or: [
        { 'metadata.page_type': 'poi' },
        { template_name: { $regex: /^poi/i } },
      ],
    }).sort({ ordre: 1 }).toArray();

    console.log(`\n📄 Pages POI générées trouvées : ${poiPages.length}`);
    if (poiPages.length === 0) {
      console.log('ℹ️  Aucune page à traiter.');
      await client.close();
      return;
    }

    // ── 5. Afficher la liste avant de commencer ───────────────────────────────
    console.log('');
    for (let i = 0; i < poiPages.length; i++) {
      const p = poiPages[i];
      console.log(`  ${pad(i + 1, poiPages.length)}. [${p.statut_editorial}] ${p.titre || p.metadata?.poi_name || p._id}`);
    }
    console.log('');

    if (DRY_RUN) {
      console.log('🔬 DRY RUN — aucune génération lancée. Retirez DRY_RUN=true pour exécuter.');
      await client.close();
      return;
    }

    // ── 6. Régénérer les champs ciblés sur chaque page ────────────────────────
    let success = 0;
    let errors  = 0;

    for (let i = 0; i < poiPages.length; i++) {
      const page = poiPages[i];
      const pageId = page._id.toString();
      const label = page.titre || page.metadata?.poi_name || pageId;

      console.log(`\n[${pad(i + 1, poiPages.length)}/${poiPages.length}] ${label}`);
      console.log(`   Statut actuel : ${page.statut_editorial}`);

      try {
        const result = await redactionService.generatePageContent(
          guide._id.toString(),
          pageId,
          { onlyFields: FIELDS_TO_REGENERATE }
        );

        if (result.status === 'error') {
          console.error(`   ❌ Erreur IA : ${result.error}`);
          errors++;
        } else {
          // Construire le $set avec seulement les champs ciblés générés
          const setFields: Record<string, any> = {
            updated_at: new Date().toISOString(),
          };
          let updatedCount = 0;
          for (const fieldName of FIELDS_TO_REGENERATE) {
            if (result.content[fieldName] !== undefined) {
              setFields[`content.${fieldName}`] = result.content[fieldName];
              updatedCount++;
              console.log(`   ✓ ${fieldName} = ${JSON.stringify(result.content[fieldName])}`);
            } else {
              console.warn(`   ⚠️  ${fieldName} : aucune valeur retournée par l'IA`);
            }
          }

          if (updatedCount > 0) {
            await db.collection('pages').updateOne(
              { _id: new ObjectId(pageId) },
              { $set: setFields }
              // statut_editorial inchangé intentionnellement
            );
            console.log(`   ✅ ${updatedCount} champ(s) mis à jour (statut préservé : ${page.statut_editorial})`);
            success++;
          } else {
            console.warn(`   ⚠️  Aucun champ mis à jour (résultat vide)`);
            errors++;
          }
        }
      } catch (err: any) {
        console.error(`   ❌ Exception : ${err.message}`);
        errors++;
      }

      // Délai avant la page suivante (sauf pour la dernière)
      if (i < poiPages.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    // ── 7. Bilan ──────────────────────────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════');
    console.log(`✅ Succès  : ${success}/${poiPages.length}`);
    if (errors > 0) {
      console.log(`❌ Erreurs : ${errors}/${poiPages.length}`);
    }
    console.log('══════════════════════════════════════');

  } finally {
    await client.close();
    console.log('\n🔌 Connexion MongoDB fermée.');
  }
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
