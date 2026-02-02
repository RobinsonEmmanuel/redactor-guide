# Interface Web - Redactor Guide

Interface d'administration pour gérer les guides touristiques.

## 🚀 Démarrage

### 1. Démarrer l'API backend

Dans un terminal :

```bash
cd ~/Documents/Repository-redactor-guide/redactor-guide
npm run dev:api
```

L'API sera disponible sur `http://localhost:3000`

### 2. Démarrer l'interface web

Dans un autre terminal :

```bash
cd ~/Documents/Repository-redactor-guide/redactor-guide/apps/web
npm run dev
```

L'interface sera disponible sur `http://localhost:3001`

## ✨ Fonctionnalités

### Gestion des guides

- ✅ **Liste des guides** - Vue d'ensemble de tous vos guides
- ✅ **Créer un guide** - Formulaire complet avec validation
- ✅ **Modifier un guide** - Mise à jour des informations
- ✅ **Supprimer un guide** - Suppression avec confirmation
- ✅ **Configuration WordPress** - URL et jeton JWT

### Informations d'un guide

1. **Informations générales**
   - Titre du guide
   - Slug (généré automatiquement)
   - Année
   - Version
   - Langue
   - Statut (brouillon, en cours, publié, etc.)

2. **Configuration WordPress**
   - URL du site WordPress source
   - Jeton JWT pour l'authentification

## 🎨 Interface

L'interface utilise le même design que votre annuaire de contacts :
- Menu latéral sombre (bleu marine)
- Interface principale claire et épurée
- Code couleur cohérent (orange pour l'actif)
- Design responsive et moderne

## 📸 Captures d'écran

### Liste des guides
- Tableau avec toutes les informations
- Filtres par statut
- Actions rapides (modifier, supprimer)
- Indicateur de configuration WordPress

### Formulaire
- Création/modification
- Validation en temps réel
- Auto-génération du slug
- Configuration WordPress intégrée

## 🔧 Configuration

L'interface communique avec l'API backend sur `http://localhost:3000`.

Si vous changez le port de l'API, mettez à jour les URLs dans :
- `components/GuidesList.tsx`
- `components/GuideForm.tsx`

## 📦 Technologies

- **Next.js 15** - Framework React
- **Tailwind CSS** - Styling
- **Heroicons** - Icônes
- **TypeScript** - Type safety

## 🚧 Prochaines étapes

- [ ] Ajouter la gestion des destinations
- [ ] Implémenter les exports
- [ ] Ajouter les statistiques
- [ ] Système d'authentification
- [ ] Prévisualisation des guides
