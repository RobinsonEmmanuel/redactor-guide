# 🚀 Prochaines étapes - Système de Templates de Guides

## ✅ Ce qui a été fait

Le système de templates de guides structurés est maintenant complètement implémenté dans le code :

### Backend
- ✅ Schéma `guide-template.schema.ts` (types, validation Zod)
- ✅ Routes API `/api/v1/guide-templates` (CRUD complet)
- ✅ Service `CheminDeFerBuilderService` pour générer la structure
- ✅ Endpoint `/chemin-de-fer/generate-structure` pour génération automatique
- ✅ Endpoint `/chemin-de-fer/proposals` pour propositions basées sur template
- ✅ Scripts de seed préparés (`seed-templates.js` et `seed-guide-templates.js`)

### Frontend
- ✅ Sélecteur de template dans le formulaire de création de guide
- ✅ Bouton "Générer la structure" dans le Chemin de Fer (état vide)
- ✅ Section "Pages suggérées" remplaçant les propositions IA
- ✅ Page de gestion des templates de guides (`/guide-templates`)
- ✅ Menu sidebar avec sous-menu Templates (Pages / Guides)

---

## 📋 CE QU'IL FAUT FAIRE MAINTENANT

### Étape 1 : Créer les templates de pages en base 🎨

**Script à lancer** : `seed-templates.js`

Ce script va créer 9 nouveaux templates de pages :
- `COUVERTURE` - Page de couverture
- `PRESENTATION_GUIDE` - Présentation du guide
- `PRESENTATION_DESTINATION` - Présentation de la destination
- `CARTE_DESTINATION` - Carte de la destination
- `CLUSTER` - Présentation d'un cluster/zone
- `INSPIRATION` - Page d'inspiration avec 6 POIs
- `SAISON` - Description d'une saison
- `ALLER_PLUS_LOIN` - Ressources complémentaires
- `A_PROPOS_RL` - À propos de Region Lovers

**Commande à exécuter** :
```bash
MONGODB_URI="votre_connection_string" MONGODB_DB="redactor-guide" node seed-templates.js
```

**Note** : Les templates POI, RESTAURANT, PLAGE, HEBERGEMENT, ACTIVITE, SECTION_INTRO existaient déjà. Le script ignore les templates existants et crée uniquement les nouveaux.

---

### Étape 2 : Créer les templates de guides en base 📚

**Script à lancer** : `seed-guide-templates.js`

Ce script va créer 3 templates de guides par défaut :

1. **Guide Complet** (par défaut)
   - Toutes les sections : couverture, présentation, lieux par zones, inspirations, saisons, pages finales
   - Structure complète en 9 blocs
   
2. **Guide Compact**
   - Identique au Complet mais sans la section Saisons
   - Pour destinations à climat constant
   
3. **Guide Thématique**
   - Focus sur les inspirations uniquement
   - Pas de section "Lieux par zones"

**Commande à exécuter** :
```bash
MONGODB_URI="votre_connection_string" MONGODB_DB="redactor-guide" node seed-guide-templates.js
```

---

### Étape 3 : Tester le workflow complet ✨

Une fois les seeds lancés, vous pouvez :

1. **Créer un nouveau guide**
   - Aller sur `/guides`
   - Cliquer sur "Nouveau guide"
   - Sélectionner un template de guide dans le dropdown
   - Remplir les informations

2. **Suivre le workflow**
   - Étape 1 : Paramétrage ✅
   - Étape 2 : Articles WP ✅
   - Étape 3 : Lieux & Clusters ✅
   - Étape 4 : Lieux & Inspirations ✅
   - **Étape 5 : Chemin de fer** 🆕
     - Soit cliquer sur "Générer la structure" (crée toutes les pages automatiquement)
     - Soit utiliser la palette "Pages suggérées" pour drag & drop manuel
   - Étape 6 : Export ✅

3. **Gérer les templates de guides**
   - Aller sur `/guide-templates`
   - Visualiser les templates existants
   - Voir la structure détaillée de chaque template
   - (Future) Créer/éditer/supprimer des templates

---

## 🎯 Résumé des commandes

```bash
# 1. Se placer à la racine du projet
cd /Users/emmanuelrobinson/Documents/Repository-redactor-guide/redactor-guide

# 2. Configurer les variables d'environnement
export MONGODB_URI="mongodb+srv://votre_connection_string"
export MONGODB_DB="redactor-guide"

# 3. Lancer le seed des templates de pages
node seed-templates.js

# 4. Lancer le seed des templates de guides
node seed-guide-templates.js
```

---

## 📊 Vérification

Après avoir lancé les scripts, vous devriez voir dans votre base MongoDB :

### Collection `templates`
- 15 templates de pages au total (6 existants + 9 nouveaux)

### Collection `guide_templates`
- 3 templates de guides (Complet, Compact, Thématique)

---

## 🔄 Workflow actuel vs nouveau

### Avant
- Étape 5 : Génération IA de propositions de sections/POIs/inspirations
- Drag & drop manuel des propositions IA vers le chemin de fer

### Maintenant
- Étape 5 : **Option A** - "Générer la structure" (automatique, 1 clic)
- Étape 5 : **Option B** - Drag & drop depuis "Pages suggérées" (basées sur template + données étapes 3 et 4)

---

## 💡 Avantages du nouveau système

1. **Cohérence** : Tous les guides d'un même type suivent la même structure
2. **Rapidité** : Plus besoin d'appels OpenAI pour générer les propositions
3. **Prévisibilité** : L'utilisateur sait exactement quelles pages seront créées
4. **Flexibilité** : Plusieurs types de guides possibles (Complet, Compact, Thématique)
5. **Évolutivité** : Création de nouveaux templates sans modifier le code

---

## 🚨 Important

Les **propositions IA** sont toujours disponibles mais ne sont plus le flux principal. Elles peuvent servir pour :
- Générer du contenu textuel pour les pages
- Obtenir des suggestions de titres/descriptions
- Enrichir les pages existantes

Le nouveau système se concentre sur la **structure** (quelles pages, dans quel ordre) plutôt que sur le **contenu** (texte des pages).
