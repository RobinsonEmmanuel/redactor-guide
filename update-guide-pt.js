const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://travmatter:MlojoS4FzEb4Ob7u@internalrl.pqxqt94.mongodb.net/?retryWrites=true&w=majority&appName=InternalRL';
const dbName = 'redactor_guide';

async function updateGuide() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB\n');
    
    const db = client.db(dbName);
    const collection = db.collection('guides');
    
    // Mettre à jour avec pt-pt au lieu de pt
    const defaultLanguages = ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];
    
    const result = await collection.updateOne(
      { slug: 'tenerife' },
      { 
        $set: { 
          availableLanguages: defaultLanguages,
          updatedAt: new Date()
        } 
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log('✅ Guide mis à jour avec pt-pt !');
      console.log('   Nouvelles langues:', defaultLanguages.join(', '));
    } else {
      console.log('⚠️  Aucune modification effectuée');
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    await client.close();
  }
}

updateGuide();
