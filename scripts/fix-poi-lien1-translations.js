/**
 * Fix : correction du label POI_lien_1 traduit (trop long d'1 car.)
 *
 * Champ : POI_lien_1 (JSON string {"label":"...","url":"..."})
 * Langue source FR : "HORAIRES, PRIX ET PHOTOS"
 *
 * Corrections :
 *   de : "ÖFFNUNGSZEITEN, PREISE & BILDER"  → "ÖFFNUNGSZEITEN PREISE BILDER"
 *   da : "ÅBNINGSTIDER, PRISER OG BILLEDER" → "ÅBNINGSTIDER PRISER BILLEDER"
 *        "ÅBNINGSTIDER, PRISER & BILLEDER"  → "ÅBNINGSTIDER PRISER BILLEDER"
 *   nl : "OPENINGSTIJDEN, PRIJZEN EN FOTO"  → "OPENINGSTIJDEN PRIJZEN FOTO"
 *
 * Usage :
 *   node -r dotenv/config scripts/fix-poi-lien1-translations.js dotenv_config_path=.env
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI     = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'redactor_guide';

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI manquant');
  process.exit(1);
}

// [ lang, ancienne valeur du label, nouvelle valeur du label ]
const FIXES = [
  ['de', 'ÖFFNUNGSZEITEN, PREISE & BILDER',  'ÖFFNUNGSZEITEN PREISE BILDER'],
  ['da', 'ÅBNINGSTIDER, PRISER OG BILLEDER',  'ÅBNINGSTIDER PRISER BILLEDER'],
  ['da', 'ÅBNINGSTIDER, PRISER & BILLEDER',   'ÅBNINGSTIDER PRISER BILLEDER'],
  ['nl', 'OPENINGSTIJDEN, PRIJZEN EN FOTO',   'OPENINGSTIJDEN PRIJZEN FOTO'],
];

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  const pages = db.collection('pages');

  let totalFixed = 0;

  for (const [lang, oldLabel, newLabel] of FIXES) {
    const field = `content_translations.${lang}.text.POI_lien_1`;

    // Chercher les pages qui contiennent encore l'ancien label
    const query = { [field]: { $regex: oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } };
    const count = await pages.countDocuments(query);

    if (count === 0) {
      console.log(`[${lang}] "${oldLabel}" — aucune page trouvée, déjà corrigé ou absent.`);
      continue;
    }

    console.log(`[${lang}] "${oldLabel}" → "${newLabel}" : ${count} page(s) à corriger...`);

    // Remplacement dans la string JSON via pipeline d'agrégation
    const result = await pages.updateMany(
      query,
      [{
        $set: {
          [field]: {
            $replaceAll: {
              input: `$${field}`,
              find: oldLabel,
              replacement: newLabel,
            },
          },
        },
      }]
    );

    console.log(`  ✅  ${result.modifiedCount} page(s) mises à jour`);
    totalFixed += result.modifiedCount;
  }

  console.log(`\n✅  Total : ${totalFixed} mise(s) à jour effectuée(s)`);
  await client.close();
}

main().catch((err) => {
  console.error('❌  Erreur :', err);
  process.exit(1);
});
