# Redactor Guide

Outil interne de génération de guides touristiques multi-destinations.

## 🎯 Contexte

- **1 guide = 1 version annuelle**
- Multi-guides, multi-destinations, multi-sites WordPress
- Source : sites WordPress multilingues (WPML)
- Le guide est la **source of truth**, pas le site
- IA = assistance (jamais validation automatique)
- Traduction automatique (IA ou DeepL)
- Images copiées localement
- Export final : CSV EasyCatalog

## 🏗️ Architecture

### Monorepo

```
redactor-guide/
├── apps/
│   └── api/              # API principale
└── packages/
    ├── core-model/       # Modèles de données (Zod schemas)
    ├── ingestion-wp/     # Ingestion WordPress
    ├── ai-services/      # Services IA
    ├── guide-builder/    # Construction de guides
    ├── exporters/        # Exports (CSV, etc.)
    └── validators/       # Validateurs métier
```

### Principes

- **Architecture modulaire** : séparation stricte des responsabilités
- **Validation avec Zod** : toutes les données sont validées
- **Injection de dépendances** : facilite les tests et la maintenabilité
- **Clean code** : TypeScript strict, types explicites

## 🚀 Démarrage

### Prérequis

- Node.js >= 18
- MongoDB en local ou distant

### Installation

```bash
npm install
```

### Configuration

```bash
cp .env.example .env
# Éditer .env avec vos valeurs
```

### Développement

```bash
# Tous les packages
npm run dev

# API uniquement
npm run dev:api
```

### Build

```bash
npm run build
```

### Production

```bash
npm run start
```

## 📦 Packages

### @redactor-guide/core-model

Modèles de données centraux avec validation Zod.

### @redactor-guide/ingestion-wp

Ingestion de contenu depuis WordPress (WPML).

### @redactor-guide/ai-services

Services d'IA (traduction, assistance).

### @redactor-guide/guide-builder

Construction et assemblage des guides.

### @redactor-guide/exporters

Export vers différents formats (CSV EasyCatalog, etc.).

### @redactor-guide/validators

Validateurs métier spécifiques.

## 🗄️ Base de données

MongoDB avec collections :

- `guides` : versions annuelles des guides
- `destinations` : destinations touristiques
- `sites` : configuration des sites WordPress
- `wordpress_posts` : cache des contenus WordPress
- `prompts` : prompts IA stockés dynamiquement

## 📝 Licence

Propriétaire - Usage interne uniquement
