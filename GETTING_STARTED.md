# Guide de démarrage rapide

## 📋 Prérequis

- Node.js >= 18
- MongoDB (local ou distant)
- npm >= 9

## 🚀 Installation

```bash
# 1. Cloner le projet (si ce n'est pas déjà fait)
cd redactor-guide

# 2. Installer les dépendances
npm install

# 3. Compiler tous les packages
npm run build
```

## ⚙️ Configuration

```bash
# 1. Copier le fichier d'exemple
cp .env.example .env

# 2. Éditer .env avec vos valeurs
# Minimum requis :
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=redactor_guide
```

### Démarrer MongoDB en local

Si vous n'avez pas MongoDB installé localement :

```bash
# Avec Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Ou avec Homebrew (macOS)
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

## 🎯 Démarrage

### Mode développement

```bash
# Démarrer l'API en mode watch
npm run dev:api
```

### Mode production

```bash
# Compiler
npm run build

# Démarrer l'API
npm run start
```

## 📦 Structure des packages

### @redactor-guide/core-model

Modèles de données centraux avec validation Zod.

**Utilisation :**

```typescript
import { Guide, GuideSchema, CreateGuideSchema } from '@redactor-guide/core-model';

// Créer un guide
const guide: CreateGuideDto = {
  name: 'Guide Paris 2025',
  slug: 'paris-2025',
  year: 2025,
  version: '1.0',
  language: 'fr',
  destinations: ['paris'],
  status: 'draft',
};

// Valider avec Zod
const validatedGuide = CreateGuideSchema.parse(guide);
```

### @redactor-guide/ingestion-wp

Ingestion de contenu depuis WordPress.

**Utilisation :**

```typescript
import { WordPressIngestionService } from '@redactor-guide/ingestion-wp';

const service = new WordPressIngestionService(db);
const posts = await service.fetchPosts('https://example.com', {
  page: 1,
  perPage: 100,
  language: 'fr',
});
```

### @redactor-guide/ai-services

Services IA (traduction, assistance).

**Utilisation :**

```typescript
import { PromptService, TranslationService } from '@redactor-guide/ai-services';

const promptService = new PromptService(db);
const translationService = new TranslationService(promptService);

const result = await translationService.translate({
  text: 'Bonjour',
  sourceLanguage: 'fr',
  targetLanguage: 'en',
});
```

### @redactor-guide/guide-builder

Construction et assemblage des guides.

**Utilisation :**

```typescript
import { GuideBuilderService } from '@redactor-guide/guide-builder';

const service = new GuideBuilderService(db);
const guide = await service.buildGuide('guide-id');
```

### @redactor-guide/exporters

Export vers différents formats.

**Utilisation :**

```typescript
import { CsvExporterService } from '@redactor-guide/exporters';

const exporter = new CsvExporterService();
const csv = await exporter.export(guide, {
  delimiter: ',',
  includeHeaders: true,
});
```

### @redactor-guide/validators

Validateurs métier.

**Utilisation :**

```typescript
import { GuideValidator } from '@redactor-guide/validators';

const validator = new GuideValidator();
const result = await validator.validate(guide);

if (!result.isValid) {
  console.error('Erreurs:', result.errors);
}
```

## 🏗️ Architecture

### Injection de dépendances

Tous les services utilisent l'injection de dépendances par constructeur :

```typescript
import { DIContainer } from './di/container';

const db = await connectDatabase();
const container = new DIContainer(db);

// Récupérer un service
const wpService = container.getWordPressIngestionService();
```

### Validation avec Zod

Toutes les données sont validées avec Zod :

```typescript
import { z } from 'zod';

// Définir un schema
const MySchema = z.object({
  name: z.string().min(1),
  age: z.number().min(0),
});

// Valider
const data = MySchema.parse(input); // Lève une erreur si invalide
```

## 📝 Scripts disponibles

```bash
# Développement
npm run dev              # Tous les packages en mode watch
npm run dev:api          # API uniquement en mode watch

# Build
npm run build            # Compiler tous les packages

# Production
npm run start            # Démarrer l'API en production

# Vérification
npm run typecheck        # Vérifier les types TypeScript
npm run lint             # Linter (si configuré)

# Nettoyage
npm run clean            # Supprimer les fichiers compilés
```

## 🧪 Prochaines étapes

1. **Ajouter un serveur HTTP** (Express/Fastify)
2. **Implémenter les routes API**
3. **Configurer les appels IA** (OpenAI, Anthropic, DeepL)
4. **Implémenter la logique métier** dans les services
5. **Ajouter des tests** (Jest/Vitest)
6. **Configurer les exports CSV** selon le format EasyCatalog
7. **Mettre en place l'authentification**
8. **Ajouter des migrations MongoDB**

## 🐛 Dépannage

### Erreur de connexion MongoDB

```
MongoServerError: connect ECONNREFUSED 127.0.0.1:27017
```

**Solution :** Vérifiez que MongoDB est démarré.

### Erreur de compilation TypeScript

```
error TS6133: 'X' is declared but its value is never read
```

**Solution :** Le mode strict de TypeScript détecte les variables non utilisées. Supprimez-les ou utilisez-les.

### Turbo cache issues

```bash
# Nettoyer le cache
rm -rf .turbo
npm run clean
npm run build
```

## 📚 Documentation

- [Zod Documentation](https://zod.dev/)
- [MongoDB Node.js Driver](https://www.mongodb.com/docs/drivers/node/)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## 🤝 Contribution

Ce projet est un outil interne. Pour toute question, contactez l'équipe technique.
