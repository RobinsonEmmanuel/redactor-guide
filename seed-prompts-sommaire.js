/**
 * Script pour créer les 3 prompts d'orchestration du sommaire
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'redactor-guide';

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI manquant dans .env');
}

const client = new MongoClient(MONGODB_URI);

const PROMPTS = [
  {
    prompt_id: `prompt_${nanoid(10)}`,
    prompt_nom: 'Structure du guide - Définition des sections',
    intent: 'structure_sections',
    categories: ['sommaire', 'structure', 'sections'],
    langue_source: 'fr',
    texte_prompt: `Rôle :
Tu es un éditeur de guides touristiques expérimenté.

Contexte :
Je prépare un guide numérique pour la destination {{DESTINATION}}.
J'ai récupéré tous les articles existants du site WordPress associé (titres, slugs, catégories, langue).

Objectif :
Proposer la structure principale du guide sous forme de SECTIONS.

Contraintes :
- Les sections doivent regrouper logiquement les articles existants.
- Ne pas inventer de lieux ou de zones absentes des articles.
- Chaque section doit être compréhensible pour un touriste.
- Le guide doit rester lisible et non exhaustif.

Entrée :
Voici la liste des articles disponibles :
{{LISTE_ARTICLES_STRUCTURÉE}}

Sortie attendue (JSON strict) :
{
  "sections": [
    {
      "section_id": "string",
      "section_nom": "string",
      "description_courte": "string (max 120 caractères)",
      "articles_associes": ["slug1", "slug2"]
    }
  ]
}

Règles :
- 4 à 10 sections maximum.
- Ne pas proposer de sous-sections.
- Rester cohérent avec un guide touristique grand public de qualité.`,
    version: '1.0.0',
    actif: true,
  },
  {
    prompt_id: `prompt_${nanoid(10)}`,
    prompt_nom: 'Sélection des POI (lieux)',
    intent: 'selection_pois',
    categories: ['sommaire', 'poi', 'lieux'],
    langue_source: 'fr',
    texte_prompt: `Rôle :
Tu es un éditeur expert en sélection touristique.

Contexte :
Voici les articles du site {{SITE}} pour la destination {{DESTINATION}}.

Objectif :
Identifier les lieux (POI) qui doivent faire l'objet d'une page dédiée dans un guide.

Contraintes :
- Sélectionner uniquement des lieux clairement identifiables.
- Éviter les doublons ou variations du même lieu.
- Ne pas être exhaustif : privilégier la pertinence touristique.
- Couvrir différents types de lieux (culture, nature, ville, expérience).

Entrée :
{{LISTE_ARTICLES_POI}}

Sortie attendue (JSON strict) :
{
  "pois": [
    {
      "poi_id": "string",
      "nom": "string",
      "type": "string",
      "article_source": "slug",
      "raison_selection": "string (max 120 caractères)"
    }
  ]
}

Règles :
- 20 à 100 POI maximum selon la destination.
- Pas de texte marketing.
- Raisons factuelles ou éditoriales.`,
    version: '1.0.0',
    actif: true,
  },
  {
    prompt_id: `prompt_${nanoid(10)}`,
    prompt_nom: 'Pages inspiration et profils',
    intent: 'pages_inspiration',
    categories: ['sommaire', 'inspiration', 'transversal'],
    langue_source: 'fr',
    texte_prompt: `Rôle :
Tu es un éditeur senior chez Region Lovers.

Contexte :
Le guide {{DESTINATION}} est structuré autour de sections et de lieux validés.

Objectif :
Proposer des pages transversales d'inspiration ou de profils de voyageurs, apportant une lecture différente de la destination.

Contraintes :
- Ne pas répéter les pages lieux.
- Apporter une vision transversale (thème, ambiance, usage).
- Rester attractif, mais informatif.
- Être compatible avec une page unique par thème.

Entrée :
- Sections du guide : {{SECTIONS}}
- Liste des POI : {{POIS}}
- Connaissances générales sur la destination

Sortie attendue (JSON strict) :
{
  "inspirations": [
    {
      "theme_id": "string",
      "titre": "string",
      "angle_editorial": "string (max 120 caractères)",
      "lieux_associes": ["poi_id1", "poi_id2"]
    }
  ]
}

Règles :
- 3 à 6 pages inspiration maximum.
- Aucun itinéraire.
- Ton éditorial Region Lovers : informatif, agréable, non marketing.`,
    version: '1.0.0',
    actif: true,
  },
];

async function seedPrompts() {
  try {
    await client.connect();
    console.log('✅ Connecté à MongoDB');

    const db = client.db(MONGODB_DB_NAME);
    const promptsCollection = db.collection('prompts');

    // Vérifier si les prompts existent déjà
    const existingPrompts = await promptsCollection
      .find({ intent: { $in: ['structure_sections', 'selection_pois', 'pages_inspiration'] } })
      .toArray();

    if (existingPrompts.length > 0) {
      console.log(`⚠️  ${existingPrompts.length} prompt(s) déjà existant(s). Suppression...`);
      await promptsCollection.deleteMany({
        intent: { $in: ['structure_sections', 'selection_pois', 'pages_inspiration'] },
      });
    }

    // Insérer les nouveaux prompts
    const result = await promptsCollection.insertMany(
      PROMPTS.map((p) => ({
        ...p,
        created_at: new Date(),
        date_mise_a_jour: new Date(),
      }))
    );

    console.log(`✅ ${result.insertedCount} prompts créés avec succès`);
    console.log('\nPrompts créés :');
    PROMPTS.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.prompt_nom} (${p.intent})`);
    });
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await client.close();
  }
}

seedPrompts();
