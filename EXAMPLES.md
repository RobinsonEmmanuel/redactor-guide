# Exemples d'utilisation

Ce document contient des exemples pratiques d'utilisation des différents services et packages.

## 📦 Utilisation des modèles (core-model)

### Créer et valider un guide

```typescript
import {
  CreateGuideSchema,
  Guide,
  GuideSchema,
} from '@redactor-guide/core-model';

// Créer un nouveau guide
const newGuide = {
  name: 'Guide Paris 2025',
  slug: 'paris-2025',
  year: 2025,
  version: '1.0.0',
  language: 'fr',
  destinations: ['paris', 'versailles'],
  status: 'draft',
};

// Valider avec Zod
try {
  const validatedGuide = CreateGuideSchema.parse(newGuide);
  console.log('✅ Guide valide', validatedGuide);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Erreurs de validation:', error.errors);
  }
}
```

### Créer une destination multilingue

```typescript
import {
  CreateDestinationSchema,
  Destination,
} from '@redactor-guide/core-model';

const destination = {
  slug: 'tour-eiffel',
  type: 'monument',
  contents: [
    {
      language: 'fr',
      title: 'Tour Eiffel',
      description: 'Monument emblématique de Paris...',
      shortDescription: 'La Dame de Fer',
      translatedBy: 'human',
    },
    {
      language: 'en',
      title: 'Eiffel Tower',
      description: 'Iconic Parisian monument...',
      shortDescription: 'The Iron Lady',
      translatedBy: 'ai',
    },
  ],
  featuredImage: {
    url: 'https://example.com/eiffel.jpg',
    alt: 'Tour Eiffel au coucher du soleil',
    width: 1920,
    height: 1080,
  },
  location: {
    latitude: 48.8584,
    longitude: 2.2945,
    address: 'Champ de Mars, 5 Avenue Anatole France',
    city: 'Paris',
    country: 'France',
  },
  tags: ['monument', 'iconic', 'paris'],
  categories: ['attractions', 'landmarks'],
};

const validatedDestination = CreateDestinationSchema.parse(destination);
```

## 🔌 Ingestion WordPress

### Récupérer et stocker des posts WordPress

```typescript
import { MongoClient } from 'mongodb';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';

async function syncWordPress() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  // Créer le service avec injection de dépendances
  const wpService = new WordPressIngestionService(db);

  try {
    // Récupérer les posts
    const posts = await wpService.fetchPosts('https://example.com', {
      page: 1,
      perPage: 50,
      postType: 'post',
      status: 'publish',
      language: 'fr',
    });

    console.log(`📥 ${posts.length} posts récupérés`);

    // Ingérer chaque post
    for (const post of posts) {
      await wpService.ingestPost(post, 'https://example.com');
      console.log(`✅ Post ${post.id} ingéré`);
    }

    // Récupérer les médias
    for (const post of posts) {
      if (post.featured_media) {
        const media = await wpService.fetchMedia(
          'https://example.com',
          post.featured_media
        );
        if (media) {
          await wpService.ingestMedia(media, 'https://example.com');
          console.log(`✅ Media ${media.id} ingéré`);
        }
      }
    }
  } finally {
    await client.close();
  }
}

syncWordPress();
```

### Synchronisation programmée

```typescript
import { CronJob } from 'cron';

// Synchroniser tous les jours à 2h du matin
const job = new CronJob('0 2 * * *', async () => {
  console.log('🔄 Démarrage de la synchronisation WordPress...');
  await syncWordPress();
  console.log('✅ Synchronisation terminée');
});

job.start();
```

## 🤖 Services IA

### Gérer les prompts

```typescript
import { MongoClient } from 'mongodb';
import { PromptService } from '@redactor-guide/ai-services';
import { CreatePromptSchema } from '@redactor-guide/core-model';

async function setupPrompts() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  // Créer un prompt de traduction
  await db.collection('prompts').insertOne({
    key: 'translation',
    name: 'Traduction générique',
    type: 'translation',
    template: `Traduisez le texte suivant de {{sourceLanguage}} vers {{targetLanguage}}.

Texte source:
{{text}}

Contexte: {{context}}

Traduction:`,
    variables: ['text', 'sourceLanguage', 'targetLanguage', 'context'],
    config: {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 2000,
    },
    version: '1.0',
    isActive: true,
    createdAt: new Date(),
  });

  // Utiliser le prompt
  const promptService = new PromptService(db);

  const renderedPrompt = await promptService.renderPrompt('translation', {
    text: 'Bonjour le monde',
    sourceLanguage: 'français',
    targetLanguage: 'anglais',
    context: 'Salutation informelle',
  });

  console.log(renderedPrompt);
  // Résultat:
  // Traduisez le texte suivant de français vers anglais.
  //
  // Texte source:
  // Bonjour le monde
  //
  // Contexte: Salutation informelle
  //
  // Traduction:

  await client.close();
}
```

### Traduire du contenu

```typescript
import { TranslationService, PromptService } from '@redactor-guide/ai-services';

async function translateContent() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  // Créer les services
  const promptService = new PromptService(db);
  const translationService = new TranslationService(promptService);

  // Traduire
  const result = await translationService.translate({
    text: 'La Tour Eiffel est un monument emblématique de Paris.',
    sourceLanguage: 'fr',
    targetLanguage: 'en',
    context: 'Description touristique',
  });

  console.log('Original:', result.originalText);
  console.log('Traduit:', result.translatedText);
  console.log('Méthode:', result.method);
  console.log('Confiance:', result.confidence);

  await client.close();
}
```

## 🏗️ Construction de guides

### Créer et construire un guide

```typescript
import { MongoClient } from 'mongodb';
import { GuideBuilderService } from '@redactor-guide/guide-builder';

async function buildGuide() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  // Créer un guide
  await db.collection('guides').insertOne({
    name: 'Guide Paris 2025',
    slug: 'paris-2025',
    year: 2025,
    version: '1.0.0',
    language: 'fr',
    destinations: ['paris', 'versailles', 'montmartre'],
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const guide = await db.collection('guides').findOne({ slug: 'paris-2025' });

  // Construire le guide
  const builderService = new GuideBuilderService(db);
  const builtGuide = await builderService.buildGuide(guide._id.toString());

  console.log('✅ Guide construit:', builtGuide);

  await client.close();
}
```

## 📤 Export de guides

### Exporter en CSV

```typescript
import { CsvExporterService } from '@redactor-guide/exporters';
import { Guide } from '@redactor-guide/core-model';
import { writeFile } from 'fs/promises';

async function exportGuide(guide: Guide) {
  const exporter = new CsvExporterService();

  // Export simple
  const csv = await exporter.export(guide, {
    delimiter: ',',
    includeHeaders: true,
    encoding: 'utf-8',
  });

  // Sauvegarder le fichier
  await writeFile(`guide-${guide.slug}.csv`, csv, 'utf-8');
  console.log('✅ Guide exporté vers CSV');
}
```

### Export personnalisé

```typescript
async function exportWithCustomColumns(guide: Guide) {
  const exporter = new CsvExporterService();

  const csv = await exporter.export(guide, {
    delimiter: ';',
    includeHeaders: true,
    encoding: 'utf-8',
    columns: ['id', 'name', 'year', 'language', 'status'],
  });

  return csv;
}
```

## ✅ Validation

### Valider un guide

```typescript
import { GuideValidator } from '@redactor-guide/validators';
import { Guide } from '@redactor-guide/core-model';

async function validateGuide(guide: Guide) {
  const validator = new GuideValidator();

  // Validation complète
  const result = await validator.validate(guide);

  if (!result.isValid) {
    console.error('❌ Erreurs de validation:');
    result.errors.forEach((error) => console.error('  -', error));
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️ Avertissements:');
    result.warnings.forEach((warning) => console.warn('  -', warning));
  }

  return result.isValid;
}

// Exemple d'utilisation
const guide: Guide = {
  name: 'Guide Test',
  slug: 'guide-test',
  year: 2025,
  version: '1.0',
  language: 'fr',
  destinations: [], // ❌ Erreur: aucune destination
  status: 'published',
  // publishedAt manquant ⚠️ Warning
};

const isValid = await validateGuide(guide);
// Sortie:
// ❌ Erreurs de validation:
//   - Le guide doit contenir au moins une destination
// ⚠️ Avertissements:
//   - Un guide publié devrait avoir une date de publication
```

## 🔧 Injection de dépendances complète

### Conteneur DI personnalisé

```typescript
import { MongoClient, Db } from 'mongodb';
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';
import { PromptService, TranslationService } from '@redactor-guide/ai-services';
import { GuideBuilderService } from '@redactor-guide/guide-builder';
import { CsvExporterService } from '@redactor-guide/exporters';
import { GuideValidator } from '@redactor-guide/validators';

class AppContainer {
  private services = new Map<string, any>();

  constructor(private readonly db: Db) {}

  getWordPressService() {
    if (!this.services.has('wp')) {
      this.services.set('wp', new WordPressIngestionService(this.db));
    }
    return this.services.get('wp')!;
  }

  getPromptService() {
    if (!this.services.has('prompt')) {
      this.services.set('prompt', new PromptService(this.db));
    }
    return this.services.get('prompt')!;
  }

  getTranslationService() {
    if (!this.services.has('translation')) {
      const promptService = this.getPromptService();
      this.services.set('translation', new TranslationService(promptService));
    }
    return this.services.get('translation')!;
  }

  getGuideBuilderService() {
    if (!this.services.has('guideBuilder')) {
      this.services.set('guideBuilder', new GuideBuilderService(this.db));
    }
    return this.services.get('guideBuilder')!;
  }

  getExporterService() {
    if (!this.services.has('exporter')) {
      this.services.set('exporter', new CsvExporterService());
    }
    return this.services.get('exporter')!;
  }

  getValidatorService() {
    if (!this.services.has('validator')) {
      this.services.set('validator', new GuideValidator());
    }
    return this.services.get('validator')!;
  }
}

// Utilisation
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  const container = new AppContainer(db);

  // Tous les services sont disponibles
  const wpService = container.getWordPressService();
  const translationService = container.getTranslationService();
  const builderService = container.getGuideBuilderService();
  const exporterService = container.getExporterService();
  const validatorService = container.getValidatorService();

  // Utiliser les services...

  await client.close();
}
```

## 🔄 Workflow complet

### Du WordPress à l'export CSV

```typescript
async function completeWorkflow() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('redactor_guide');

  const container = new AppContainer(db);

  try {
    // 1. Ingestion WordPress
    console.log('📥 Ingestion WordPress...');
    const wpService = container.getWordPressService();
    const posts = await wpService.fetchPosts('https://example.com');
    for (const post of posts) {
      await wpService.ingestPost(post, 'https://example.com');
    }

    // 2. Créer un guide
    console.log('📝 Création du guide...');
    const guide = await db.collection('guides').insertOne({
      name: 'Guide Paris 2025',
      slug: 'paris-2025',
      year: 2025,
      version: '1.0',
      language: 'fr',
      destinations: ['paris'],
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. Construire le guide
    console.log('🏗️ Construction du guide...');
    const builderService = container.getGuideBuilderService();
    const builtGuide = await builderService.buildGuide(
      guide.insertedId.toString()
    );

    // 4. Valider le guide
    console.log('✅ Validation du guide...');
    const validator = container.getValidatorService();
    const validation = await validator.validate(builtGuide);
    if (!validation.isValid) {
      throw new Error('Guide invalide: ' + validation.errors.join(', '));
    }

    // 5. Mettre à jour le statut
    await db.collection('guides').updateOne(
      { _id: guide.insertedId },
      { $set: { status: 'ready', updatedAt: new Date() } }
    );

    // 6. Exporter en CSV
    console.log('📤 Export CSV...');
    const exporter = container.getExporterService();
    const csv = await exporter.export(builtGuide);

    // 7. Sauvegarder
    await writeFile(`exports/${builtGuide.slug}.csv`, csv);

    console.log('🎉 Workflow terminé avec succès!');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await client.close();
  }
}

completeWorkflow();
```

## 🧪 Tests (exemples)

### Tester un service avec mock

```typescript
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';
import { Db } from 'mongodb';

describe('WordPressIngestionService', () => {
  let service: WordPressIngestionService;
  let mockDb: Db;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockDb = {
      collection: jest.fn().mockReturnValue({
        updateOne: jest.fn(),
      }),
    } as any;

    mockFetch = jest.fn();
    service = new WordPressIngestionService(mockDb, mockFetch);
  });

  it('devrait récupérer les posts WordPress', async () => {
    const mockPosts = [
      {
        id: 1,
        title: { rendered: 'Test' },
        content: { rendered: 'Content' },
      },
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockPosts,
    });

    const posts = await service.fetchPosts('https://example.com');

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe(1);
  });
});
```

---

Ces exemples montrent comment utiliser tous les services du projet Redactor Guide. Adaptez-les selon vos besoins spécifiques !
