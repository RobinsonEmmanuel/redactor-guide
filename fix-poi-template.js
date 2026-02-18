// Script pour corriger la limite de caractères du champ POI_texte_2 (482 → 480)
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB_NAME || 'redactor_guide';

async function fixPOITemplate() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(MONGODB_DB);
    const templatesCollection = db.collection('templates');

    // Trouver le template POI
    const poiTemplate = await templatesCollection.findOne({ name: 'POI' });
    
    if (!poiTemplate) {
      console.log('❌ Template POI non trouvé');
      return;
    }

    console.log('📋 Template POI trouvé');

    // Vérifier et corriger le champ POI_texte_2
    let updated = false;
    poiTemplate.fields.forEach((field, index) => {
      if (field.name === 'POI_texte_2' && field.max_chars === 482) {
        console.log(`⚠️  Champ ${field.name} a max_chars = 482 (devrait être 480)`);
        poiTemplate.fields[index].max_chars = 480;
        updated = true;
      }
    });

    if (updated) {
      // Mettre à jour le template
      const result = await templatesCollection.updateOne(
        { _id: poiTemplate._id },
        { $set: { fields: poiTemplate.fields, updated_at: new Date().toISOString() } }
      );

      if (result.modifiedCount > 0) {
        console.log('✅ Template POI mis à jour avec succès');
        console.log('   POI_texte_2: max_chars 482 → 480');
      } else {
        console.log('⚠️  Aucune modification effectuée');
      }
    } else {
      console.log('✅ Le template POI est déjà correct (max_chars = 480)');
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await client.close();
    console.log('🔌 Déconnecté de MongoDB');
  }
}

// Exécution
fixPOITemplate();
