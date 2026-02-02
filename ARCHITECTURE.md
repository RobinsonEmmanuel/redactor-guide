# Architecture du projet Redactor Guide

## 🎯 Vue d'ensemble

Redactor Guide est un monorepo Node.js/TypeScript organisé en packages modulaires pour la génération de guides touristiques.

## 📐 Principes architecturaux

### 1. Séparation des responsabilités

Chaque package a une responsabilité unique et claire :

- **core-model** : Définitions des modèles de données
- **ingestion-wp** : Récupération depuis WordPress
- **ai-services** : Services d'intelligence artificielle
- **guide-builder** : Assemblage des guides
- **exporters** : Export vers différents formats
- **validators** : Validation métier

### 2. Injection de dépendances

Tous les services utilisent l'injection de dépendances par constructeur :

```typescript
export class MyService {
  constructor(
    private readonly db: Db,
    private readonly otherService: IOtherService
  ) {}
}
```

**Avantages :**
- Facilite les tests (mock des dépendances)
- Rend les dépendances explicites
- Permet la composition de services

### 3. Validation avec Zod

Toutes les données qui traversent les frontières de services sont validées avec Zod :

```typescript
// Définition du schema
export const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

// Validation
const user = UserSchema.parse(input);
```

**Points de validation :**
- Entrées de l'API REST
- Données de WordPress
- Réponses des services IA
- Avant insertion en base de données
- Avant export CSV

### 4. Type safety avec TypeScript

Le mode strict de TypeScript est activé pour garantir la sûreté des types :

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true
}
```

## 🏗️ Structure du monorepo

```
redactor-guide/
├── apps/
│   └── api/                    # Application principale
│       ├── src/
│       │   ├── config/         # Configuration (DB, env)
│       │   ├── di/             # Conteneur DI
│       │   ├── routes/         # Routes API (à ajouter)
│       │   └── index.ts        # Point d'entrée
│       └── package.json
│
└── packages/
    ├── core-model/             # Modèles de données
    │   └── src/
    │       └── schemas/        # Schemas Zod
    │
    ├── ingestion-wp/           # Ingestion WordPress
    │   └── src/
    │       ├── schemas/        # Validation API WP
    │       └── services/       # Services d'ingestion
    │
    ├── ai-services/            # Services IA
    │   └── src/
    │       ├── schemas/        # Validation réponses IA
    │       └── services/       # Services IA
    │
    ├── guide-builder/          # Construction guides
    │   └── src/
    │       └── services/       # Services de build
    │
    ├── exporters/              # Exports
    │   └── src/
    │       ├── schemas/        # Config exports
    │       └── services/       # Services d'export
    │
    └── validators/             # Validateurs métier
        └── src/
            └── validators/     # Validateurs
```

## 🔄 Flux de données

### 1. Ingestion WordPress

```
WordPress API → ingestion-wp → Validation Zod → MongoDB
```

**Étapes :**
1. Récupération via API REST WordPress
2. Validation avec `WordPressPostSchema`
3. Transformation en modèle interne
4. Stockage dans collection `wordpress_posts`

### 2. Traduction

```
Texte source → ai-services → Validation → Base de données
```

**Étapes :**
1. Récupération du prompt depuis MongoDB
2. Injection des variables dans le template
3. Appel à l'API IA (OpenAI/Anthropic)
4. Validation de la réponse avec Zod
5. Stockage du résultat

### 3. Construction de guide

```
Destinations → guide-builder → Assemblage → Guide complet
```

**Étapes :**
1. Récupération des destinations depuis MongoDB
2. Application des traductions
3. Assemblage du contenu
4. Validation métier
5. Mise à jour du statut

### 4. Export

```
Guide → exporters → Format CSV → Fichier
```

**Étapes :**
1. Récupération du guide
2. Transformation selon le format cible
3. Validation des options d'export
4. Génération du fichier

## 🗄️ Base de données MongoDB

### Collections

#### `guides`

Guide touristique annuel.

```typescript
{
  _id: string,
  name: string,
  year: number,
  version: string,
  language: Language,
  destinations: string[],
  status: GuideStatus,
  createdAt: Date,
  updatedAt: Date
}
```

#### `destinations`

Destination touristique (ville, monument, etc.).

```typescript
{
  _id: string,
  wpId?: number,
  slug: string,
  type: DestinationType,
  contents: TranslatedContent[],
  images: Image[],
  location?: { lat, lng, address },
  createdAt: Date,
  updatedAt: Date
}
```

#### `wordpress_posts`

Cache des contenus WordPress.

```typescript
{
  _id: string,
  id: number,              // WP post ID
  sourceUrl: string,
  title: { rendered: string },
  content: { rendered: string },
  acf?: Record<string, unknown>,
  lastSyncAt: Date
}
```

#### `prompts`

Prompts IA stockés dynamiquement.

```typescript
{
  _id: string,
  key: string,             // Identifiant unique
  name: string,
  type: PromptType,
  template: string,        // Template avec {{variables}}
  variables: string[],
  config?: { model, temperature },
  isActive: boolean
}
```

#### `wordpress_sites`

Configuration des sites WordPress sources.

```typescript
{
  _id: string,
  name: string,
  url: string,
  language: Language,
  wpml?: { enabled, languages },
  auth?: { type, credentials },
  sync?: { frequency, lastSyncAt }
}
```

### Index recommandés

```typescript
// guides
db.guides.createIndex({ year: 1, language: 1 });
db.guides.createIndex({ status: 1 });

// destinations
db.destinations.createIndex({ slug: 1 }, { unique: true });
db.destinations.createIndex({ type: 1 });
db.destinations.createIndex({ wpId: 1, wpSiteUrl: 1 });

// wordpress_posts
db.wordpress_posts.createIndex({ id: 1, sourceUrl: 1 }, { unique: true });

// prompts
db.prompts.createIndex({ key: 1 }, { unique: true });
db.prompts.createIndex({ type: 1 });
```

## 🔐 Sécurité et validation

### Stratégie de validation

1. **Validation d'entrée** : Toute donnée externe est validée immédiatement
2. **Validation de frontière** : Validation à chaque frontière de service
3. **Validation avant stockage** : Validation avant insertion en base
4. **Validation métier** : Règles métier spécifiques en plus de la validation structurelle

### Gestion des erreurs

```typescript
try {
  const data = MySchema.parse(input);
} catch (error) {
  if (error instanceof z.ZodError) {
    // Erreurs de validation structurées
    console.error(error.errors);
  }
  throw error;
}
```

## 🧪 Tests (à implémenter)

### Structure recommandée

```
packages/[package-name]/
├── src/
│   └── services/
│       └── my-service.ts
└── tests/
    ├── unit/
    │   └── my-service.test.ts
    └── integration/
        └── my-service.integration.test.ts
```

### Tests unitaires

- Mocker les dépendances (DB, services externes)
- Tester la logique métier isolément
- Utiliser Jest ou Vitest

### Tests d'intégration

- Tester avec une vraie base de données (MongoDB Memory Server)
- Tester les flux complets
- Vérifier les interactions entre services

## 🚀 Performance

### Optimisations

1. **Cache des prompts** : `PromptService` met en cache les prompts
2. **Connexion MongoDB poolée** : Pool de connexions réutilisables
3. **Compilation incrémentale** : Turbo met en cache les builds
4. **Validation lazy** : Validation uniquement quand nécessaire

### Monitoring (à ajouter)

- Logs structurés (Winston/Pino)
- Métriques de performance
- Tracing des requêtes

## 📦 Dépendances externes

### Production

- **zod** : Validation de schémas
- **mongodb** : Driver MongoDB
- **dotenv** : Variables d'environnement

### Développement

- **typescript** : Langage
- **turbo** : Build system monorepo
- **tsx** : Exécution TypeScript (dev)

## 🔄 CI/CD (à configurer)

### Pipeline recommandé

1. **Install** : `npm ci`
2. **Typecheck** : `npm run typecheck`
3. **Lint** : `npm run lint`
4. **Test** : `npm test`
5. **Build** : `npm run build`
6. **Deploy** : Déploiement selon environnement

## 📈 Évolutions futures

### Court terme

- [ ] Ajouter Express/Fastify pour l'API REST
- [ ] Implémenter les appels IA réels
- [ ] Configurer l'export CSV EasyCatalog
- [ ] Ajouter des tests

### Moyen terme

- [ ] Interface web d'administration
- [ ] Gestion des utilisateurs et permissions
- [ ] Historique des versions de guides
- [ ] Preview des guides avant export

### Long terme

- [ ] Multi-tenancy (plusieurs organisations)
- [ ] API GraphQL
- [ ] Webhooks pour notifications
- [ ] Intégration avec d'autres CMS

## 📚 Références

- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Dependency Injection](https://en.wikipedia.org/wiki/Dependency_injection)
- [Zod Documentation](https://zod.dev/)
- [MongoDB Best Practices](https://www.mongodb.com/docs/manual/administration/production-notes/)
