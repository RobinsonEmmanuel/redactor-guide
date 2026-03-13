/**
 * Migration : nettoyage de max_length dans les règles de validation des templates
 *
 * Problème : certains champs ont à la fois :
 *   - max_chars (Calibre)  → utilisé par le moteur IA comme source de vérité
 *   - validation_rules.max_length → obsolète et potentiellement incohérent
 *
 * Ce script supprime max_length des validation_rules UNIQUEMENT
 * quand le champ possède déjà un max_chars défini.
 *
 * Règles conservées : required, min_length, forbidden_words, severity, etc.
 *
 * Usage :
 *   MONGODB_URI=... MONGODB_DB_NAME=... node scripts/migrate-clean-validation-maxlength.js
 *   ou avec le fichier .env.production :
 *   node -r dotenv/config scripts/migrate-clean-validation-maxlength.js dotenv_config_path=.env.production
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI    = process.env.MONGODB_URI;
const MONGODB_DB     = process.env.MONGODB_DB_NAME ?? 'redactor_guide';
const TEMPLATES_COLL = 'templates';
const DRY_RUN        = process.env.DRY_RUN !== 'false'; // par défaut en dry-run

async function main() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI manquant. Relance avec la variable d\'environnement.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db   = client.db(MONGODB_DB);
  const coll = db.collection(TEMPLATES_COLL);

  console.log(`🔍 Mode ${DRY_RUN ? 'DRY-RUN (aucune modification)' : 'LIVE (modifications en base)'}`);
  console.log(`📦 Base : ${MONGODB_DB} / Collection : ${TEMPLATES_COLL}\n`);

  const templates = await coll.find({}).toArray();
  console.log(`📋 ${templates.length} template(s) à analyser\n`);

  let totalTemplatesModified = 0;
  let totalFieldsCleaned     = 0;
  let totalConflicts         = 0;

  for (const tmpl of templates) {
    const fields = Array.isArray(tmpl.fields) ? tmpl.fields : [];
    if (fields.length === 0) continue;

    let templateModified = false;
    const updatedFields  = fields.map((field) => {
      const hasCalibration     = field.max_chars != null;
      const validationRules    = field.validation_rules ?? {};
      const hasMaxLengthInJson = validationRules.max_length != null;

      if (!hasCalibration || !hasMaxLengthInJson) return field;

      // Conflit détecté : max_length dans les règles + max_chars (Calibre) sur le champ
      const conflict = validationRules.max_length !== field.max_chars;
      if (conflict) {
        console.log(
          `  ⚠️  Conflit sur "${tmpl.template_name}" → champ "${field.name}" :` +
          ` validation max_length=${validationRules.max_length} ≠ max_chars=${field.max_chars}` +
          ` → max_length supprimé`
        );
        totalConflicts++;
      } else {
        console.log(
          `  ✂️  Doublon sur "${tmpl.template_name}" → champ "${field.name}" :` +
          ` max_length=${validationRules.max_length} == max_chars=${field.max_chars}` +
          ` → max_length supprimé (redondant)`
        );
      }

      // Reconstruire validation_rules sans max_length
      const { max_length, ...cleanedRules } = validationRules;
      void max_length; // unused intentionally

      const hasRemainingRules = Object.keys(cleanedRules).length > 0;
      templateModified = true;
      totalFieldsCleaned++;

      return {
        ...field,
        validation_rules: hasRemainingRules ? cleanedRules : undefined,
      };
    });

    if (!templateModified) continue;

    totalTemplatesModified++;

    if (!DRY_RUN) {
      await coll.updateOne(
        { _id: tmpl._id },
        { $set: { fields: updatedFields, updated_at: new Date() } }
      );
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`✅ Templates modifiés  : ${totalTemplatesModified}`);
  console.log(`✅ Champs nettoyés     : ${totalFieldsCleaned}`);
  console.log(`⚠️  Conflits détectés  : ${totalConflicts}`);
  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN actif — aucune modification enregistrée.');
    console.log('   Pour appliquer : DRY_RUN=false node scripts/migrate-clean-validation-maxlength.js');
  } else {
    console.log('\n🚀 Modifications appliquées en base.');
  }

  await client.close();
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
