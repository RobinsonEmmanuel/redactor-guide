# Workflow de Production - Guide Visuel

## Vue d'ensemble

Le système de production de guides suit un **workflow en 8 étapes** clairement visualisé dans l'interface grâce au **WorkflowStepper**.

Ce stepper affiche en temps réel la progression et guide l'utilisateur à travers chaque étape du processus.

## Interface visuelle

```
┌────────────────────────────────────────────────────────────────────────┐
│ Guide: Tenerife 2026                                   Version 2026    │
├────────────────────────────────────────────────────────────────────────┤
│ Workflow de production                         Étape 3 / 8             │
│                                                                        │
│ ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐           │
│ │⚙️ 1  │ ── │📄 2  │ ── │📍 3  │ ── │🗂️ 4 │ ── │📋 5  │ ── ...   │
│ │✅    │    │✅    │    │🔄    │    │⏳    │    │⏳    │           │
│ │Config│    │Art. │    │Lieux │    │Clus. │    │Som.  │           │
│ └──────┘    └──────┘    └──────┘    └──────┘    └──────┘           │
│                                                                        │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  3/8 complétées            │
├────────────────────────────────────────────────────────────────────────┤
│ [📄 Articles WordPress] [🗂️ Matching Cluster] [🛤️ Chemin de fer]     │
└────────────────────────────────────────────────────────────────────────┘
```

## Les 8 étapes du workflow

### 1. ⚙️ Paramétrage

**Objectif** : Configuration initiale du guide

**Actions** :
- Créer le guide
- Renseigner nom, année, destination
- Configurer WordPress (URL + token JWT)
- Renseigner `destination_rl_id` (ID MongoDB Region Lovers)

**Statut** : ✅ Toujours complété (si guide existe)

**Onglet** : Configuration (à venir)

---

### 2. 📄 Articles WordPress

**Objectif** : Récupération des articles sources

**Actions** :
- Cliquer sur "Lancer la récupération"
- Système récupère tous les articles de la destination
- Extraction du contenu HTML brut
- Stockage en base (`articles_raw`)

**Statut** : ✅ Complété si `articlesCount > 0`

**Onglet** : Articles WordPress

**Déblocage** : Étape 3 (Lieux)

---

### 3. 📍 Lieux

**Objectif** : Identification des lieux dans les articles

**Actions** :
- Aller dans l'onglet "Matching Cluster"
- Cliquer sur "Générer les POIs"
- L'IA identifie tous les lieux mentionnés
- Génération coordonnées GPS (Nominatim)

**Statut** : ✅ Complété si matching généré

**Onglet** : Matching Cluster

**Dépendance** : Étape 2 complétée

---

### 4. 🗂️ Clusters

**Objectif** : Rangement des lieux par cluster

**Actions** :
- Auto-matching avec clusters Region Lovers (score ≥ 60%)
- Drag & drop des POIs entre colonnes
- Ajustements manuels si nécessaire
- Cliquer sur "Enregistrer"

**Statut** : ✅ Complété si matching sauvegardé

**Onglet** : Matching Cluster

**Dépendance** : Étape 3 complétée

**Déblocage** : Étape 5 (Sommaire)

---

### 5. 📋 Sommaire

**Objectif** : Génération IA du sommaire du guide

**Actions** :
- Aller dans "Chemin de fer"
- Cliquer sur "Générer le sommaire"
- 3 prompts IA chaînés (sections, POIs, inspirations)
- Affichage des propositions dans la colonne droite

**Statut** : ✅ Complété si sommaire généré (sections ou POIs présents)

**Onglet** : Chemin de fer

**Dépendance** : Étape 4 complétée (matching finalisé)

---

### 6. 🛤️ Chemin de fer

**Objectif** : Finalisation de la structure du guide

**Actions** :
- Drag & drop des pages du sommaire vers la grille
- Ajout de pages vides (bouton "+")
- Réorganisation de l'ordre des pages
- Suppression/modification si nécessaire

**Statut** : ✅ Complété si au moins 1 page créée

**Onglet** : Chemin de fer

**Dépendance** : Étape 5 complétée

**Déblocage** : Étape 7 (Rédaction)

---

### 7. ✍️ Rédaction

**Objectif** : Génération IA des contenus des pages

**Actions** :
- Pour chaque page, cliquer sur "Rédiger"
- Sélectionner l'article WordPress source
- L'IA génère le contenu selon le template
- Validation automatique (Zod + retry si échec)
- Visualisation des images analysées

**Statut** : ✅ Complété si au moins 1 page avec `statut_editorial === 'generee_ia'`

**Onglet** : Chemin de fer (modal de contenu)

**Dépendance** : Étape 6 complétée

**Déblocage** : Étape 8 (Export)

---

### 8. 📦 Export

**Objectif** : Export CSV pour InDesign / EasyCatalog

**Actions** :
- *(À formaliser)*
- Export des pages finalisées
- Format compatible InDesign
- Intégration avec EasyCatalog

**Statut** : ⏳ À venir

**Onglet** : Export (à créer)

**Dépendance** : Étape 7 complétée

---

## Badges de statut

Les étapes affichent des badges visuels :

| Badge | Statut | Description |
|-------|--------|-------------|
| ✅ | **Complété** | Étape terminée avec succès |
| 🔄 | **En cours** | Étape actuellement active |
| ⏳ | **À venir** | Étape accessible, pas encore démarrée |
| 🔒 | **Verrouillé** | Étape inaccessible (précédente non complétée) |

## Navigation

### Clic sur une étape

- **Étape complétée** (✅) : Navigation vers l'onglet correspondant
- **Étape à venir** (⏳) : Navigation si étape précédente complétée
- **Étape verrouillée** (🔒) : Clic désactivé

### Progression automatique

Après certaines actions, le système avance automatiquement à l'étape suivante :

- **Articles importés** → Passe à étape 3 (Lieux)
- **Matching généré** → Reste sur étape 4 (Clusters) pour ajustement manuel
- **Sommaire généré** → Reste sur étape 5 pour validation
- **Pages créées** → Reste sur étape 6 pour finalisation

### Barre de progression

Une barre globale affiche la progression :
```
████████████████░░░░░░░░░░░░░░░░░░░░░░  3/8 complétées
```

## Logique de détection des étapes complétées

```typescript
Étape 1 (Config): guide existe
Étape 2 (Articles): articlesCount > 0
Étape 3 (Lieux): matching généré
Étape 4 (Clusters): matching sauvegardé
Étape 5 (Sommaire): sommaire_proposal existe avec pois ou sections
Étape 6 (Chemin de fer): guide.chemin_de_fer.pages.length > 0
Étape 7 (Rédaction): au moins 1 page avec statut_editorial === 'generee_ia'
Étape 8 (Export): à définir
```

## Couleurs et design

### Étapes complétées ✅
- **Container** : Vert pâle (`bg-green-50`)
- **Bordure** : Vert (`border-green-300`)
- **Icône** : Vert solide (`bg-green-500`)
- **Texte** : Vert foncé (`text-green-700`)

### Étape en cours 🔄
- **Container** : Bleu pâle (`bg-blue-50`)
- **Bordure** : Bleu vif (`border-blue-400`)
- **Icône** : Bleu animé (`animate-pulse`)
- **Texte** : Bleu foncé gras (`text-blue-700 font-semibold`)
- **Shadow** : Ombre portée (`shadow-md`)

### Étapes à venir ⏳
- **Container** : Blanc (`bg-white`)
- **Bordure** : Gris clair (`border-gray-300`)
- **Icône** : Gris (`bg-gray-200`)
- **Texte** : Gris moyen (`text-gray-600`)
- **Hover** : Bordure bleue (`hover:border-blue-300`)

### Étapes verrouillées 🔒
- **Container** : Gris très pâle (`bg-gray-100`)
- **Bordure** : Gris clair (`border-gray-200`)
- **Icône** : Gris foncé (`bg-gray-300`)
- **Texte** : Gris clair (`text-gray-400`)
- **Opacité** : 50% (`opacity-50`)
- **Curseur** : Non cliquable (`cursor-not-allowed`)

## Cas d'usage

### Nouveau guide (démarrage)
1. Créer le guide → Étape 1 ✅
2. Récupérer articles → Étape 2 ✅, passage auto à étape 3 🔄
3. Générer matching → Étapes 3-4 ✅
4. Ajuster clusters manuellement
5. Générer sommaire → Étape 5 ✅
6. Créer pages → Étape 6 ✅
7. Rédiger contenus → Étape 7 ✅
8. Exporter → Étape 8 ⏳

### Reprise d'un guide existant

Le stepper affiche automatiquement :
- Toutes les étapes complétées (badges ✅)
- L'étape en cours recommandée (badge 🔄)
- Les étapes suivantes disponibles (badges ⏳)

### Saut d'étapes

Impossible : chaque étape vérifie que la précédente est complétée. Les étapes verrouillées 🔒 ne sont pas cliquables.

## Compatibilité

### Fonctionnalités préservées

✅ **Tous les onglets existants** fonctionnent normalement
✅ **Génération du sommaire** : Inchangée (3 prompts IA)
✅ **Chemin de fer** : Drag & drop, réorganisation
✅ **Génération des pages** : Rédaction IA avec retry
✅ **Récupération WordPress** : Ingestion articles
✅ **Matching Cluster** : Algorithme de similarité

### Nouveaux éléments

🆕 **WorkflowStepper** : Composant de navigation visuelle
🆕 **Suivi de progression** : Détection automatique des étapes complétées
🆕 **Navigation intelligente** : Verrouillage des étapes non accessibles
🆕 **Callbacks** : Progression automatique après certaines actions

## Notes techniques

### Composant WorkflowStepper

```typescript
<WorkflowStepper
  currentStep={currentWorkflowStep}
  completedSteps={getCompletedSteps()}
  onStepClick={handleWorkflowStepClick}
/>
```

### États ajoutés

```typescript
const [currentWorkflowStep, setCurrentWorkflowStep] = useState<number>(2);
const [matchingGenerated, setMatchingGenerated] = useState(false);
const [sommaireGenerated, setSommaireGenerated] = useState(false);
```

### Vérifications asynchrones

```typescript
checkArticles()        // Articles WordPress récupérés
checkMatchingStatus()  // Matching cluster généré
checkSommaireStatus()  // Sommaire généré
```

## Améliorations futures

- [ ] Onglet dédié "⚙️ Configuration" (étape 1)
- [ ] Onglet dédié "📦 Export" (étape 8)
- [ ] Indicateurs de temps par étape
- [ ] Tooltips détaillés sur chaque étape
- [ ] Historique des actions (journal d'activité)
- [ ] Notifications push (étape complétée)
- [ ] Mode "Vue d'ensemble" (résumé de toutes les étapes)
