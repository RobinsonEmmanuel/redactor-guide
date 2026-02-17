# 📋 Fonctionnalités du système Chemin de Fer
## Vue d'ensemble

Le système actuel combine **3 étapes distinctes** :
- **Étape 5** : Génération du Sommaire par IA
- **Étape 6** : Construction du Chemin de fer (Railway)
- **Étape 7** : Rédaction des contenus de pages

## 🎯 Architecture actuelle

### Composants principaux
1. **SommaireProposal.tsx** : Génération IA du sommaire
2. **CheminDeFerTab.tsx** : Interface principale du chemin de fer
3. **PageCard.tsx** : Carte de page draggable
4. **PageModal.tsx** : Édition des métadonnées de page
5. **ContentEditorModal.tsx** : Éditeur de contenu de page

---

## 📦 Étape 5 : Génération du Sommaire IA

### Fonctionnalités

#### 1. **Génération automatique du sommaire**
- 🎯 Bouton **"Générer le sommaire"**
- Analyse des articles WordPress du guide
- Utilise l'IA (OpenAI) pour structurer le contenu
- Génération basée sur des prompts configurables en base de données

#### 2. **Types de propositions générées**
##### a) **Sections** (bleu)
- `section_id` : Identifiant unique
- `section_nom` : Titre de la section
- `description_courte` : Description éditoriale
- `articles_associes` : Liste des slugs d'articles WordPress liés
- Icône : 📚 RectangleStackIcon
- Couleur : Bleu

##### b) **POIs (Lieux)** (vert)
- `poi_id` : Identifiant unique
- `nom` : Nom du lieu
- `type` : Type de POI (musée, plage, restaurant, etc.)
- `article_source` : Slug de l'article WordPress principal
- `autres_articles_mentions` : Liste des slugs d'articles secondaires
- `raison_selection` : Justification éditoriale
- `coordinates` : Objet avec `lat`, `lon`, `display_name` (géocodage automatique)
- Icône : 📍 MapPinIcon
- Couleur : Verte
- **Badge de comptage** : Affiche "+N" si plusieurs articles mentionnent ce POI
- **Dropdown cliquable** : Liste des autres articles avec liens

##### c) **Inspirations** (orange)
- `theme_id` : Identifiant unique
- `titre` : Titre du thème d'inspiration
- `angle_editorial` : Angle éditorial suggéré
- `lieux_associes` : Liste des POIs liés
- Icône : 💡 LightBulbIcon
- Couleur : Orange

#### 3. **Régénération partielle**
- Bouton **"🔄 Regénérer"** pour chaque type (Sections / Lieux / Inspiration)
- Permet de regénérer uniquement une catégorie sans perdre les autres
- Endpoint : `POST /generate-sommaire?parts=sections,pois,inspirations`

#### 4. **Sauvegarde automatique**
- Proposition sauvegardée dans la collection `chemin_de_fer`
- Champ : `sommaire_proposal`
- Rechargement automatique au montage du composant

#### 5. **Drag & Drop depuis la palette**
- Toutes les cards de proposition sont draggables
- ID de drag : `proposal-{type}-{id}`
- Métadonnées transportées :
  - `type: 'proposal'`
  - `proposalType: 'section' | 'poi' | 'inspiration'`
  - `id`, `title`, `description`
  - `articleSlug` (pour POI)
  - `autresArticlesMentions` (pour POI)
  - `poiType` (type du POI)
  - `coordinates` (GPS du POI)

---

## 🎨 Étape 6 : Chemin de fer (Railway)

### Structure visuelle

#### **Layout en 2 colonnes**
1. **Colonne gauche (Palette)** : 
   - Templates disponibles
   - Propositions IA (Sommaire)
   
2. **Colonne droite (Grille)** : 
   - Chemin de fer avec pages
   - Grille responsive (3-7 colonnes selon taille écran)

---

### 🛠️ Fonctionnalités Palette gauche

#### **Section Templates**
##### 1. **Liste des templates disponibles**
- Chargement depuis `/api/v1/templates`
- Affichage en grille 2 colonnes
- **TemplatePaletteItemMini** :
  - Nom du template
  - Nombre de champs
  - Icône 📝 DocumentTextIcon
  - Draggable avec ID : `template-{template._id}`

##### 2. **Drag & Drop de templates**
- Glisser un template vers la grille
- Crée une nouvelle page avec le template sélectionné
- Titre par défaut : "Nouvelle page {template.name}"
- Statut initial : `draft`
- `ordre` : Position dans la grille ou fin de liste

#### **Section Propositions IA**
##### 1. **Bouton "Tout générer"**
- Lance la génération complète du sommaire
- Affiche un spinner pendant la génération
- Gestion d'erreur avec message

##### 2. **Affichage des propositions**
- **Sections** avec bouton "🔄 Regénérer"
- **Lieux (POIs)** avec :
  - Badge de comptage des articles secondaires
  - Bouton "🔄 Regénérer"
  - Coordonnées GPS affichées
- **Inspiration** avec bouton "🔄 Regénérer"

##### 3. **ProposalCardMini draggable**
- Cards compactes avec :
  - Icône selon le type
  - Titre
  - Description courte
  - Coordonnées GPS (POI uniquement)
  - Badge "+N" pour articles secondaires
  - Dropdown avec liste d'articles

##### 4. **État vide**
- Message : "Cliquez sur 'Tout générer'"
- Icône SparklesIcon

---

### 📊 Fonctionnalités Grille (Chemin de fer)

#### **Header**
- Titre : "Chemin de fer"
- Compteur de pages : "X page(s)"
- Texte d'aide : "💡 Glissez depuis la palette"
- **Bouton "Vider tout"** :
  - Supprime toutes les pages du chemin de fer
  - Double confirmation avant suppression
  - Suppression en parallèle de toutes les pages

#### **Grille de pages**
##### 1. **Configuration de la grille**
- Grille responsive : 3 à 7 colonnes selon taille écran
- Classes : `grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7`
- Gestion dynamique du nombre d'emplacements :
  - Si < 50 pages : affiche 100 emplacements
  - Si ≥ 50 pages : affiche jusqu'à 200 ou pages.length + 20
  - Emplacements additionnels configurables par l'utilisateur

##### 2. **EmptySlot (Case vide droppable)**
- Affiche le numéro d'ordre en grand
- Background gris clair avec bordure pointillée
- Au survol lors du drag : bordure bleue + fond bleu clair + scale(1.05)
- ID droppable : `empty-slot-{ordre}`
- Texte : "Libre" ou "Placer ici" (au hover)

##### 3. **PageCard (Case avec page)**
- **Miniature (h-32)**
  - Image de fond si `image_url` (article WordPress)
  - Overlay sombre pour lisibilité
  - **Numéro de page** (top-left) : Badge blanc avec numéro d'ordre
  - **Bouton supprimer** (top-right) : Visible au hover, croix rouge
  - **Icône drag** (center) : Bars3Icon
  - **Pastille de statut** (bottom-left) : Couleur selon statut
  - **Zone entièrement draggable** avec cursor grab/grabbing

- **Contenu (p-3)**
  - **Titre de la page** : 2 lignes max (line-clamp-2)
  - **Badge de statut** : 
    - `draft` : Gris
    - `generee_ia` : Bleu
    - `en_attente` : Rose (avec animation pulse)
    - `non_conforme` : Rouge
    - `relue` : Jaune
    - `validee` : Vert (avec ring)
    - `texte_coule` : Cyan
    - `visuels_montes` : Violet
    - `texte_recu` : Orange
  - **Type de page** (si défini) : `poi`, `section`, etc.
  - **Coordonnées GPS** (si page POI) : Format `lat, lon`
  - **Actions** (2 boutons) :
    - **Bouton principal** :
      - `draft` → "Rédiger" (bleu)
      - `en_attente` → "Génération..." (spinner, disabled) + Bouton "Annuler"
      - `non_conforme` → "Corriger" (rouge) + Bouton "Réinitialiser"
      - `generee_ia`/`relue`/`validee` → "Éditer" (vert)
    - **Bouton secondaire** : "Modifier paramètres" (crayon)

##### 4. **Bordures et états visuels**
- `en_attente` : Bordure bleue + ring bleu + animation pulse
- `non_conforme` : Bordure rouge + ring rouge
- `generee_ia` : Bordure bleue stable
- `validee` : Bordure verte + ring vert

---

### 🔄 Drag & Drop : Gestion complète

#### **1. Drag d'un template vers la grille**
- Détection : `active.data.current?.type === 'template'`
- Création d'une page via `handleCreatePageFromTemplate()` :
  - `page_id` : nanoid(10)
  - `titre` : "Nouvelle page {template.name}"
  - `template_id` : ID du template
  - `type_de_page` : undefined
  - `statut_editorial` : 'draft'
  - `ordre` : targetOrder ou pages.length + 1
  - `url_source` : undefined
  - `commentaire_interne` : undefined
- Endpoint : `POST /chemin-de-fer/pages`

#### **2. Drag d'une proposition IA vers la grille**
- Détection : `active.data.current?.type === 'proposal'`
- Création d'une page via `handleCreatePageFromProposal()` :
  - Sélection automatique du template approprié :
    - POI → Cherche template avec "poi" dans le nom
    - Sinon → Premier template disponible
  - **Récupération des données WordPress** (si POI) :
    - Appel à `/guides/{guideId}/articles?slug={articleSlug}`
    - Récupération de `image_url` (première image)
    - Récupération de `articleUrl` (urls_by_lang.fr)
  - Création de la page :
    - `page_id` : nanoid(10)
    - `titre` : Titre de la proposition
    - `template_id` : Template sélectionné
    - `type_de_page` : Type de la proposition (`poi`, `section`, `inspiration`)
    - `statut_editorial` : 'draft'
    - `ordre` : targetOrder ou pages.length + 1
    - `section_id` : ID de la proposition
    - `url_source` : URL de l'article WordPress (si POI)
    - `image_url` : Image de l'article (si POI)
    - `coordinates` : Coordonnées GPS (si POI)
    - `commentaire_interne` : 
      - Type POI
      - Autres articles mentionnés
- Endpoint : `POST /chemin-de-fer/pages`

#### **3. Réorganisation des pages existantes**

##### **Cas A : Échange entre 2 pages**
- Drag d'une page vers une autre page occupée
- Détection : `targetPage` trouvée
- Échange des ordres :
  - Page A prend l'ordre de Page B
  - Page B prend l'ordre de Page A
- Endpoint : `PUT /chemin-de-fer/pages/reorder`
- Body : Liste complète des pages avec nouveaux ordres

##### **Cas B : Déplacement vers case vide**
- Drag d'une page vers une case vide
- Détection : `over.id.startsWith('empty-slot-')`
- Changement d'ordre :
  - Page prend l'ordre de la case vide
  - Autres pages conservent leur ordre
- Endpoint : `PUT /chemin-de-fer/pages/{pageId}`
- Body : `{ ordre: newOrder }`

#### **4. DragOverlay**
- Affiche un aperçu de l'élément en cours de drag
- Bordure bleue + shadow
- Opacité 90%

---

### 🔧 Actions sur les pages

#### **1. Modifier les paramètres (PageModal)**
- Modal avec formulaire :
  - Titre de la page
  - Sélection du template
  - Type de page
  - Statut éditorial
  - URL source
  - Commentaire interne
- Endpoint : `PUT /chemin-de-fer/pages/{pageId}`

#### **2. Supprimer une page**
- Bouton rouge sur la carte (visible au hover)
- Confirmation avant suppression
- Endpoint : `DELETE /chemin-de-fer/pages/{pageId}`

#### **3. Réinitialiser une page**
- Disponible pour pages en `en_attente` ou `non_conforme`
- Passe le statut à `draft`
- Supprime le contenu généré
- Supprime le commentaire interne
- Endpoint : `PUT /chemin-de-fer/pages/{pageId}`
- Body : `{ statut_editorial: 'draft', commentaire_interne: undefined, content: undefined }`

#### **4. Ajouter des emplacements vides**
- Carte **"+ Ajouter cases"** à la fin de la grille
- Modal pour saisir le nombre (1-100)
- Ajoute des emplacements vides supplémentaires
- Permet de préparer l'espace pour futures pages

---

## ✍️ Étape 7 : Rédaction de contenu

### Fonctionnalités ContentEditorModal

#### **1. Ouverture de l'éditeur**
- Clic sur bouton "Rédiger" / "Éditer" / "Corriger"
- Chargement du contenu existant :
  - Endpoint : `GET /chemin-de-fer/pages/{pageId}/content`
  - Chargement du template associé
  - Initialisation du formulaire

#### **2. Génération automatique de contenu IA**
##### **Bouton "✨ Générer le contenu"**
- **Prérequis** : Page doit avoir `url_source` (article WordPress)
- **Processus asynchrone** (QStash + Worker) :
  1. Clic sur le bouton
  2. Appel : `POST /chemin-de-fer/pages/{pageId}/generate-content`
  3. Réponse : `{ async: true, message: '...' }`
  4. Modal se ferme automatiquement
  5. Page passe en statut `en_attente`
  6. **Polling automatique toutes les 3s** pour vérifier l'état
  7. Notification quand génération terminée
  8. Page passe en statut `generee_ia` (succès) ou `non_conforme` (échec)

##### **Analyse d'images intégrée**
- Lors de la génération IA :
  - **Filtrage des images** :
    - Exclure les images dans les reusable blocks WordPress
    - Garder uniquement les images du contenu principal
  - **Analyse via OpenAI Vision API** :
    - Prompt : `analyse_image` (depuis base MongoDB)
    - Pour chaque image : qualité technique + pertinence éditoriale
  - **Cache global** :
    - Analyse stockée par URL unique d'image
    - Évite de réanalyser les mêmes images
  - **Affichage** :
    - Bouton "📸 Voir analyses d'images"
    - Modal avec liste des images analysées
    - Note de qualité + pertinence + commentaires IA

##### **Retry avec validation Zod**
- Chaque champ du template a un schéma Zod de validation
- Si génération échoue (validation Zod) :
  - Max 3 tentatives
  - Régénération uniquement des champs en erreur
  - Prompt enrichi avec contexte d'erreur
- Si échec après 3 tentatives :
  - Statut → `non_conforme`
  - Commentaire interne avec détails de l'erreur

#### **3. Édition manuelle du contenu**
##### **Formulaire dynamique selon template**
- Rendu automatique des champs selon `template.fields[]`
- **Types de champs supportés** :
  
  **a) Titre** :
  - Input texte simple
  - Compteur de caractères (si `max_chars` défini)
  - Couleur : rouge si dépassement
  
  **b) Texte** :
  - Textarea multilignes
  - Compteur de caractères (si `max_chars` défini)
  - Auto-resize
  
  **c) Image** :
  - Input texte pour URL
  - Aperçu de l'image si URL valide
  - Bouton "📸 Voir analyses" si analyses disponibles
  
  **d) Lien** :
  - Input URL
  - Validation du format
  
  **e) Meta** :
  - Input texte court
  - Pour métadonnées (SEO, etc.)
  
  **f) Liste** :
  - Textarea
  - Une valeur par ligne
  - Parsing automatique en array

##### **Informations du champ**
- Label
- Description (si définie)
- Instructions IA (si définies)
- Compteur de caractères avec code couleur :
  - Gris : < 90%
  - Orange : 90-100%
  - Rouge : > 100%

#### **4. Bouton "Voir analyses d'images"**
- Disponible si la page a des analyses d'images
- Ouvre `ImageAnalysisModal`
- Affiche :
  - Miniature de l'image
  - Note de qualité (1-10)
  - Note de pertinence (1-10)
  - Commentaire de l'IA
  - Suggestions d'utilisation

#### **5. Sauvegarde manuelle**
- Bouton "Enregistrer"
- Endpoint : `PUT /chemin-de-fer/pages/{pageId}/content`
- Body : `{ content: { field1: value1, field2: value2, ... } }`
- Ferme la modal après sauvegarde
- Recharge les pages dans la grille

#### **6. États de l'éditeur**
- **Chargement** : Spinner pendant récupération du contenu
- **Génération en cours** : Bouton disabled avec spinner
- **Erreur** : Message d'erreur en rouge
- **Édition** : Formulaire actif

---

## 🔄 Polling automatique pour génération asynchrone

### Mécanisme
- **Déclencheur** : Détection de pages avec `statut_editorial === 'en_attente'`
- **Intervalle** : Toutes les 3 secondes
- **Action** : Recharge les pages via `loadPages()`
- **Arrêt** :
  - Quand aucune page n'est en `en_attente`
  - Nettoyage automatique à la destruction du composant
- **Tracking** :
  - Set `generatingPageIds` pour suivre les pages en génération
  - Notification quand page passe en `generee_ia`
  - Retrait du tracking après notification

### Notifications
- **1 page générée** : `alert("✅ Page {titre} générée avec succès !")`
- **Plusieurs pages** : `alert("✅ N pages générées avec succès !")`

---

## 📡 Endpoints API utilisés

### Templates
- `GET /api/v1/templates` : Liste des templates

### Chemin de fer
- `GET /api/v1/guides/{guideId}/chemin-de-fer` : Récupérer pages
- `POST /api/v1/guides/{guideId}/chemin-de-fer/pages` : Créer page
- `PUT /api/v1/guides/{guideId}/chemin-de-fer/pages/{pageId}` : Modifier page
- `DELETE /api/v1/guides/{guideId}/chemin-de-fer/pages/{pageId}` : Supprimer page
- `PUT /api/v1/guides/{guideId}/chemin-de-fer/pages/reorder` : Réorganiser plusieurs pages

### Sommaire IA
- `GET /api/v1/guides/{guideId}/chemin-de-fer/sommaire-proposal` : Récupérer proposition
- `POST /api/v1/guides/{guideId}/chemin-de-fer/generate-sommaire` : Générer sommaire complet
- `POST /api/v1/guides/{guideId}/chemin-de-fer/generate-sommaire?parts=X,Y` : Régénération partielle

### Contenu de page
- `GET /api/v1/guides/{guideId}/chemin-de-fer/pages/{pageId}/content` : Récupérer contenu
- `PUT /api/v1/guides/{guideId}/chemin-de-fer/pages/{pageId}/content` : Sauvegarder contenu
- `POST /api/v1/guides/{guideId}/chemin-de-fer/pages/{pageId}/generate-content` : Générer contenu IA

### Articles WordPress
- `GET /api/v1/guides/{guideId}/articles?slug={slug}` : Récupérer article par slug

---

## 🎨 Codes couleur et design

### Couleurs par type de proposition
- **Sections** : Bleu (`blue-50`, `blue-200`, `blue-600`)
- **POIs** : Vert (`green-50`, `green-200`, `green-600`)
- **Inspirations** : Orange (`orange-50`, `orange-200`, `orange-600`)

### Couleurs par statut de page
- `draft` : Gris (`gray-100`, `gray-700`)
- `generee_ia` : Bleu (`blue-100`, `blue-700`)
- `en_attente` : Rose (`pink-100`, `pink-700`)
- `non_conforme` : Rouge (`red-100`, `red-700`)
- `relue` : Jaune (`yellow-100`, `yellow-700`)
- `validee` : Vert (`green-100`, `green-700`)
- `texte_coule` : Cyan (`cyan-100`, `cyan-700`)
- `visuels_montes` : Violet (`purple-100`, `purple-700`)
- `texte_recu` : Orange (`orange-100`, `orange-700`)

### Animations
- **Pulse** : Pages en `en_attente` (animate-pulse-slow)
- **Spin** : Spinner de chargement (animate-spin)
- **Scale** : Survol de cases vides (scale-105)
- **Opacity** : Drag en cours (opacity-50)

---

## 🔑 Points clés du système

### Forces
1. **Flexibilité totale** : Drag & drop de templates ou propositions IA
2. **Génération IA intégrée** : Sommaire + contenu automatique
3. **Gestion asynchrone** : Pas de timeout, génération en background
4. **Validation Zod** : Qualité du contenu généré garantie
5. **Analyse d'images** : Sélection intelligente des visuels
6. **Réorganisation libre** : Échange et déplacement de pages
7. **Polling automatique** : Suivi en temps réel des générations
8. **Statuts visuels** : Codes couleur et animations claires
9. **Coordonnées GPS** : Géocodage automatique des POIs
10. **Cache d'analyses** : Optimisation des appels API OpenAI

### Limites actuelles
1. **3 étapes séparées** : Nécessite navigation entre onglets
2. **Palette latérale fixe** : Peut masquer la grille sur petits écrans
3. **Sommaire généré à part** : Pas intégré au flow de construction
4. **Pas de prévisualisation** : Impossible de voir le rendu final

---

## 🎯 Proposition de fusion (Étapes 5 + 6 + 7)

### Objectif
- **Garder le système de Chemin de fer avec drag & drop**
- **Intégrer la génération IA directement dans la palette**
- **Simplifier le workflow en une seule vue**

### Principes
1. **Une seule interface** au lieu de 3 onglets
2. **Palette enrichie** :
   - Templates (comme avant)
   - Propositions IA générées (sections, POIs, inspirations)
   - Génération IA à la demande (bouton "Générer")
3. **Grille de pages** (comme avant) :
   - Drag & drop depuis palette
   - Réorganisation libre
   - Actions sur pages (éditer, supprimer, rédiger)
4. **Modal de rédaction** (comme avant) :
   - Génération IA de contenu
   - Édition manuelle
   - Analyse d'images

### Avantages
- ✅ Workflow linéaire et fluide
- ✅ Moins de navigation entre onglets
- ✅ Vue d'ensemble complète
- ✅ Conserve toutes les fonctionnalités existantes
- ✅ Expérience utilisateur optimisée
