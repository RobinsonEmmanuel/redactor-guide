# 📍 Étape fusionnée : Lieux et Clusters

## 🎯 Vue d'ensemble

**Fusion des anciennes étapes 3 et 4** en une seule interface unifiée.

### Workflow complet
1. **Génération automatique** : Extraction des lieux depuis les articles WordPress
2. **Matching automatique** : Dispatch des lieux par cluster (IA)
3. **Ajustements manuels** : Ajout, réaffectation, création de POIs
4. **Validation** : Confirmation avant passage à l'étape suivante (Sommaire)

---

## 🖥️ Interface : Split View

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📍 Lieux et Clusters                                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                                           │
│  [🤖 1. Générer les lieux depuis WordPress]  42/49 POIs affectés        │
│  [🔄 2. Lancer le matching automatique]      23 clusters • 7 non affectés│
│  [✅ 3. Valider et passer au Sommaire]                                   │
│                                                                           │
├──────────────────────────────┬──────────────────────────────────────────┤
│                              │                                          │
│  📋 LISTE DES LIEUX (49)     │  📊 RÉPARTITION PAR CLUSTER             │
│                              │                                          │
│  🔍 Rechercher un lieu...    │  🔍 Rechercher un cluster...            │
│  [Tous] [Non affectés] [OK]  │  [Vue: Grille ▼] [Trier par: Nom ▼]    │
│                              │                                          │
│  [➕ Ajouter un lieu ▼]      │  ▼ ❓ NON AFFECTÉS (7)                  │
│     • Créer POI vierge       │     ┌──────────────────────────────┐   │
│     • Depuis bibliothèque RL  │     │ • Siam Park (💡 Costa Adeje) │   │
│                              │     │ • Masca (❌ pas de suggest.) │   │
│  ┌──────────────────────────┐│     │ • 5 autres...                │   │
│  │ ☑ 📍 Loro Parque         ││     └──────────────────────────────┘   │
│  │    Zoo • Auto 95%        ││                                         │
│  │    → Puerto de la Cruz   ││  ▼ 🏖️ PUERTO DE LA CRUZ (8)          │
│  │    ✅                    ││     ┌──────────────────────────────┐   │
│  └──────────────────────────┘│     │ • Loro Parque (95%)          │   │
│                              │     │ • Jardín Sitio Litre (92%)   │   │
│  ┌──────────────────────────┐│     │ • Jardín Botánico (89%)      │   │
│  │ ☑ 📍 Siam Park           ││     │ • 5 autres...                │   │
│  │    Parc • 88%            ││     └──────────────────────────────┘   │
│  │    💡 Costa Adeje        ││                                         │
│  │    ⚠️ Non affecté        ││  ▶ 🏖️ COSTA ADEJE (12)                │
│  └──────────────────────────┘│                                         │
│                              │  ▶ 🏔️ TEIDE (6)                        │
│  ┌──────────────────────────┐│                                         │
│  │ □ 📍 Masca               ││  ▶ 🏖️ LOS CRISTIANOS (5)              │
│  │    Village               ││                                         │
│  │    ❌ Pas de suggestion  ││  ... [+18 autres clusters]              │
│  │    [✏️ Affecter]         ││                                         │
│  └──────────────────────────┘│                                         │
│                              │                                          │
│  ... (liste scrollable)      │  (vue scrollable)                       │
│                              │                                          │
│  [Actions groupées ▼]        │  [📊 Statistiques détaillées]           │
│    • Affecter sélection à... │                                          │
│    • Supprimer sélection     │                                          │
│                              │                                          │
└──────────────────────────────┴──────────────────────────────────────────┘
```

---

## 🚀 Étape 1 : Génération des lieux depuis WordPress

### Bouton "🤖 Générer les lieux depuis WordPress"

#### Fonctionnement
1. **Clic sur le bouton** → Lance une tâche asynchrone (QStash + Worker)
2. **Statut** : Bouton passe en "⏳ Génération en cours..." (disabled)
3. **Polling** : Vérification toutes les 3s du statut du job
4. **Résultat** : 
   - Succès → Affiche les POIs dans la liste de gauche (tous en statut "Non affecté")
   - Échec → Message d'erreur avec possibilité de réessayer

#### Données générées (par POI)
- `poi_id` : Identifiant unique (MongoDB ObjectId)
- `nom` : Nom du lieu (ex: "Loro Parque")
- `type` : Type de POI (musée, plage, restaurant, parc, etc.)
- `article_source` : Slug de l'article WordPress principal
- `autres_articles_mentions` : Array de slugs d'articles secondaires
- `raison_selection` : Justification éditoriale de la sélection
- `coordinates` : Objet `{ lat, lon, display_name }` (géocodage Nominatim)
- `cluster_id` : `null` (sera rempli après matching)
- `place_instance_id` : `null` (sera rempli si match avec base RL)
- `matched_automatically` : `false` (sera true après matching auto)
- `confidence` : `null` (score de matching, sera rempli après)

#### Affichage initial
- **Liste de gauche** : Tous les POIs générés
- **Vue de droite** : Section "❓ Non affectés (N)" avec tous les POIs
- **Statistiques** : "0/N POIs affectés • N non affectés"
- **Étape 2 active** : Bouton "🔄 Lancer le matching automatique" devient cliquable

---

## 🧠 Étape 2 : Matching automatique par cluster

### Bouton "🔄 Lancer le matching automatique"

#### Fonctionnement
1. **Clic sur le bouton** → Appel API `POST /guides/:guideId/matching`
2. **Backend** :
   - Récupère les POIs depuis `pois_selection`
   - Récupère les place_instances de la région (API Region Lovers)
   - Calcule la similarité entre chaque POI et chaque place_instance
   - Affecte automatiquement si score ≥ 90% (haute confiance)
   - Crée des suggestions pour scores 60-89%
   - Laisse non affectés si score < 60%
3. **Sauvegarde** dans `cluster_assignments` :
   ```json
   {
     "guide_id": "...",
     "assignment": {
       "unassigned": [
         {
           "poi": { /* données POI */ },
           "current_cluster_id": "unassigned",
           "suggested_match": {
             "place_instance": { /* données place_instance */ },
             "score": 0.88,
             "confidence": "medium"
           },
           "matched_automatically": false
         }
       ],
       "clusters": {
         "cluster_1_id": [
           {
             "poi": { /* données POI */ },
             "current_cluster_id": "cluster_1_id",
             "place_instance_id": "place_instance_x",
             "suggested_match": {
               "place_instance": { /* données place_instance */ },
               "score": 0.95,
               "confidence": "high"
             },
             "matched_automatically": true
           }
         ]
       }
     },
     "clusters_metadata": [
       {
         "cluster_id": "cluster_1_id",
         "cluster_name": "Puerto de la Cruz",
         "place_count": 8
       }
     ],
     "matched_at": "2026-02-17T16:45:00Z"
   }
   ```

#### Affichage après matching
- **Liste de gauche** : POIs avec badges de statut
  - ✅ Vert : Auto affecté (≥90%)
  - ⚠️ Orange : Suggestion (60-89%)
  - ❌ Rouge : Non affecté (<60%)
- **Vue de droite** : 
  - Section "❓ Non affectés" en haut
  - Sections par cluster (accordéons dépliables)
  - Nombre de POIs par cluster
- **Statistiques** : "42/49 POIs affectés • 7 non affectés • 23 clusters"

---

## ✏️ Étape 3 : Ajustements manuels

### 3.1. Ajout manuel de POIs

#### Bouton "➕ Ajouter un lieu" (dropdown)

##### Option A : "Créer POI vierge"
**Modal d'ajout manuel**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Créer un nouveau lieu                                        ✕     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Nom du lieu *                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Ex: Mirador de la Esperanza                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Type de lieu *                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Point de vue                                              ▼  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  (Restaurant, Hôtel, Musée, Plage, Parc, Point de vue, etc.)        │
│                                                                       │
│  Coordonnées GPS (optionnel)                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐        │
│  │ Latitude: 28.xxxxx       │  │ Longitude: -16.xxxxx     │        │
│  └──────────────────────────┘  └──────────────────────────┘        │
│  [📍 Géocoder automatiquement]                                      │
│                                                                       │
│  Article WordPress source (optionnel)                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ /tenerife/mirador-esperanza                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Notes internes (optionnel)                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [Annuler]                                     [✅ Créer le lieu]   │
└─────────────────────────────────────────────────────────────────────┘
```

**Fonctionnement** :
1. Remplissage du formulaire
2. Clic sur "Créer le lieu"
3. Appel API : `POST /guides/:guideId/pois`
4. Body :
   ```json
   {
     "nom": "Mirador de la Esperanza",
     "type": "point_de_vue",
     "coordinates": {
       "lat": 28.xxxxx,
       "lon": -16.xxxxx
     },
     "article_source": "/tenerife/mirador-esperanza",
     "notes_internes": "...",
     "origine": "manuel"
   }
   ```
5. Le POI est ajouté à la liste de gauche en statut "Non affecté"
6. L'utilisateur peut ensuite le déplacer vers un cluster

##### Option B : "Depuis bibliothèque Region Lovers"
**Modal de sélection depuis la base**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Bibliothèque des lieux - Région: Tenerife                   ✕     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  🔍 Rechercher un lieu...                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Loro Parque                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Filtres : [Tous types ▼] [Par cluster ▼]                           │
│                                                                       │
│  530 lieux disponibles, groupés par cluster :                        │
│                                                                       │
│  ▼ 🏖️ PUERTO DE LA CRUZ (61)                                       │
│     ┌───────────────────────────────────────────────────────────┐  │
│     │ 📍 Loro Parque                                            │  │
│     │    Zoo • 28.40538, -16.56655                              │  │
│     │    ✅ Déjà dans le guide                                  │  │
│     ├───────────────────────────────────────────────────────────┤  │
│     │ 📍 Jardín Sitio Litre                                     │  │
│     │    Jardin botanique • 28.41234, -16.54321                 │  │
│     │    [➕ Ajouter au guide]                                  │  │
│     ├───────────────────────────────────────────────────────────┤  │
│     │ 📍 Lago Martiánez                                         │  │
│     │    Piscine naturelle • 28.41789, -16.54567                │  │
│     │    [➕ Ajouter au guide]                                  │  │
│     └───────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ▶ 🏖️ COSTA ADEJE (69)                                             │
│  ▶ 🏔️ TEIDE (58)                                                   │
│  ▶ 🏖️ LOS CRISTIANOS (32)                                          │
│  ... [+18 autres clusters]                                           │
│                                                                       │
│  [Fermer]                                         5 lieu(x) ajouté(s)│
└─────────────────────────────────────────────────────────────────────┘
```

**Fonctionnement** :
1. **Chargement** : Appel `GET /place-instance-drafts/region/{regionId}` (API RL)
2. **Affichage** : Groupé par cluster, ordre alphabétique
3. **Clic sur "➕ Ajouter"** :
   - Appel `POST /guides/:guideId/pois/from-library`
   - Body :
     ```json
     {
       "place_instance_id": "6938f0f4e02cb72937d5c8bb",
       "cluster_id": "d432afdc219f42cfa9b012c9",
       "cluster_name": "Puerto de la Cruz"
     }
     ```
   - Le POI est créé dans `pois_selection` avec :
     - Données complètes de la place_instance
     - `cluster_id` pré-affecté
     - `matched_automatically` = false
     - `origine` = "bibliotheque"
4. **Affichage** : Le POI apparaît immédiatement dans la liste ET dans son cluster

**Fonctionnalités** :
- ✅ Recherche par nom
- ✅ Filtres par type et cluster
- ✅ Indication si POI déjà dans le guide (badge "✅ Déjà dans le guide")
- ✅ Compteur : "5 lieu(x) ajouté(s)"
- ✅ Ajout multiple sans fermer la modal

---

### 3.2. Réaffectation manuelle

#### Clic sur un POI dans la liste → Panel de détail

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Retour à la liste                                          ✕     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  📍 Siam Park                                                        │
│  Parc aquatique                                                      │
│                                                                       │
│  📍 Coordonnées : 28.07257, -16.82374                               │
│  🔗 Article source : /tenerife/siam-park                            │
│  📄 Autres mentions : 2 articles                                     │
│  🏷️ Origine : ✨ Généré automatiquement depuis WordPress           │
│                                                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                                       │
│  🎯 AFFECTATION AU CLUSTER                                           │
│                                                                       │
│  Statut actuel : ⚠️ Non affecté                                     │
│                                                                       │
│  💡 Suggestion automatique (88%)                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🏖️ Costa Adeje                                            │   │
│  │  12 POIs déjà assignés                                      │   │
│  │  Zone balnéaire sud de l'île                                │   │
│  │  [✅ Accepter cette suggestion]                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  OU                                                                   │
│                                                                       │
│  Choisir un autre cluster :                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🔍 Rechercher un cluster...                             ▼  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  • Buenavista - Garachico (49 POIs)                                 │
│  • El Medano (26 POIs)                                               │
│  • Icod de los Vinos (19 POIs)                                       │
│  • Los Cristianos (32 POIs)                                          │
│  • Puerto de la Cruz (8 POIs)                                        │
│  ... [voir plus 18 clusters]                                         │
│                                                                       │
│  [➕ Créer un nouveau cluster]                                       │
│  [❌ Retirer du cluster actuel]                                      │
│                                                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                                       │
│  🗑️ ACTIONS                                                          │
│  [✏️ Modifier les informations]  [🗑️ Supprimer ce lieu]            │
│                                                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                                       │
│  [← Précédent: Masca]                    [Suivant: Playa del... →]  │
└─────────────────────────────────────────────────────────────────────┘
```

**Actions disponibles** :
1. **Accepter suggestion** : 
   - Affecte au cluster suggéré
   - Met à jour `cluster_id` et `place_instance_id`
   - `matched_automatically` = true (si acceptation de suggestion auto)

2. **Choisir autre cluster** :
   - Dropdown avec recherche
   - Affecte au cluster choisi
   - `matched_automatically` = false

3. **Créer nouveau cluster** :
   - Modal pour nommer le cluster
   - Crée le cluster dans `clusters_metadata`
   - Affecte le POI au nouveau cluster

4. **Retirer du cluster** :
   - Remet le POI en "Non affecté"
   - `cluster_id` = null

5. **Navigation** : Boutons Précédent/Suivant pour traiter tous les POIs rapidement

---

### 3.3. Actions groupées

#### Sélection multiple (checkboxes)
- Checkbox sur chaque POI de la liste
- "Tout sélectionner" / "Tout désélectionner"
- Compteur : "5 POIs sélectionnés"

#### Dropdown "Actions groupées"
```
[Actions groupées ▼]
  • Affecter tous à un cluster...
  • Accepter toutes les suggestions
  • Retirer tous des clusters
  • Supprimer la sélection
  • Exporter la sélection (CSV)
```

**Fonctionnement "Affecter tous à un cluster"** :
1. Clic sur l'action
2. Modal avec dropdown de clusters
3. Validation
4. Appel API : `PUT /guides/:guideId/pois/batch-assign`
   ```json
   {
     "poi_ids": ["id1", "id2", "id3"],
     "cluster_id": "cluster_x",
     "cluster_name": "Puerto de la Cruz"
   }
   ```
5. Tous les POIs sélectionnés sont affectés au cluster

---

## 📊 Vue de droite : Répartition par cluster

### Structure (Accordéons)

```
▼ ❓ NON AFFECTÉS (7)                                [✅ Tout affecter]
   ┌──────────────────────────────────────────────────────────────┐
   │ • Siam Park (💡 Costa Adeje 88%)                             │
   │ • Masca (❌ pas de suggestion)                               │
   │ • Pyramides de Güímar (💡 Güímar 72%)                       │
   │ • 4 autres...                                                 │
   └──────────────────────────────────────────────────────────────┘

▼ 🏖️ PUERTO DE LA CRUZ (8)                         [✏️ Gérer]
   ┌──────────────────────────────────────────────────────────────┐
   │ • Loro Parque (95% ✨)                                       │
   │ • Jardín Sitio Litre (92% ✨)                                │
   │ • Jardín Botánico (89% ✨)                                   │
   │ • Playa del Muelle (✏️ Manuel)                               │
   │ • 4 autres... [voir tous]                                     │
   └──────────────────────────────────────────────────────────────┘

▶ 🏖️ COSTA ADEJE (12)

▶ 🏔️ TEIDE (6)

... [+18 autres clusters]
```

### Fonctionnalités

#### 1. **Accordéon "Non affectés"**
- Toujours en haut
- Badge rouge avec compteur
- Bouton "✅ Tout affecter" : Accepte toutes les suggestions disponibles
- Liste des POIs avec suggestions (si disponibles)

#### 2. **Accordéons par cluster**
- Déplié par défaut si < 5 POIs
- Header cliquable pour déplier/replier
- Icône selon type de cluster (🏖️, 🏔️, 🏛️, etc.)
- Nom + nombre de POIs
- Bouton "✏️ Gérer" : Actions sur le cluster entier

#### 3. **Liste des POIs dans cluster**
- Nom du POI
- Badge de matching (score + ✨/✏️)
- Clic sur POI → Ouvre le panel de détail

#### 4. **Options de vue**
- Bouton "Vue: Grille ▼" pour changer le format :
  - **Liste** (défaut) : Accordéons verticaux
  - **Grille** : Cards en grille 2-3 colonnes
  - **Compact** : Liste ultra-compacte (noms uniquement)

#### 5. **Actions sur cluster**
Bouton "✏️ Gérer" → Modal avec actions :
- Renommer le cluster
- Fusionner avec un autre cluster
- Supprimer le cluster (réaffecte POIs en "Non affectés")
- Voir tous les POIs du cluster

---

## 📊 Statistiques détaillées

### Bouton "📊 Statistiques détaillées" → Modal

```
┌─────────────────────────────────────────────────────────────────────┐
│  📊 Statistiques : Lieux et Clusters                          ✕     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  📍 LIEUX                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Total : 49 POIs                                            │   │
│  │  • ✅ Affectés : 42 (85.7%)                                 │   │
│  │  • ⚠️ Non affectés : 7 (14.3%)                              │   │
│  │                                                              │   │
│  │  Par origine :                                               │   │
│  │  • ✨ Générés auto (WordPress) : 45 (91.8%)                 │   │
│  │  • ✏️ Créés manuellement : 2 (4.1%)                         │   │
│  │  • 📚 Depuis bibliothèque RL : 2 (4.1%)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  🎯 MATCHING                                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Affectations automatiques :                                 │   │
│  │  • Haute confiance (≥90%) : 28 POIs                         │   │
│  │  • Moyenne confiance (75-89%) : 10 POIs                     │   │
│  │  • Basse confiance (60-74%) : 4 POIs                        │   │
│  │                                                              │   │
│  │  Affectations manuelles : 7 POIs                            │   │
│  │  Aucune suggestion : 0 POIs                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  📊 CLUSTERS                                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Total : 23 clusters                                         │   │
│  │                                                              │   │
│  │  Top 5 clusters (par nombre de POIs) :                      │   │
│  │  1. Costa Adeje : 12 POIs                                   │   │
│  │  2. Puerto de la Cruz : 8 POIs                              │   │
│  │  3. Teide : 6 POIs                                           │   │
│  │  4. Los Cristianos : 5 POIs                                  │   │
│  │  5. Santa Cruz : 4 POIs                                      │   │
│  │                                                              │   │
│  │  Moyenne : 1.8 POIs par cluster                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  📈 GRAPHIQUES                                                       │
│  [Voir répartition par cluster (bar chart)]                          │
│  [Voir confiance du matching (pie chart)]                            │
│  [Exporter statistiques (CSV)]                                       │
│                                                                       │
│  [Fermer]                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✅ Étape 4 : Validation finale

### Bouton "✅ Valider et passer au Sommaire"

#### Conditions de validation
Avant de passer à l'étape suivante, vérifier :
1. ✅ Au moins 1 POI a été généré
2. ⚠️ Si > 20% de POIs non affectés → Modal de confirmation :
   ```
   ⚠️ 7 POIs ne sont pas encore affectés à un cluster.
   
   Voulez-vous continuer quand même ?
   (Vous pourrez toujours revenir les affecter plus tard)
   
   [← Retour]  [Continuer quand même →]
   ```

#### Action
- Sauvegarde finale de l'état dans `pois_selection` et `cluster_assignments`
- Passage à l'étape suivante : **Sommaire** (étape 5)
- Le workflow continue avec génération du sommaire IA

---

## 🗄️ Structure de données

### Collection `pois_selection`
```json
{
  "_id": ObjectId("..."),
  "guide_id": "698103c854f9e04def33b803",
  "poi_id": "poi_1234567890",
  "nom": "Loro Parque",
  "type": "zoo",
  "article_source": "/tenerife/loro-parque",
  "autres_articles_mentions": ["/tenerife/puerto-cruz", "/activites-famille"],
  "raison_selection": "Attraction majeure, très populaire",
  "coordinates": {
    "lat": 28.40538,
    "lon": -16.56655,
    "display_name": "Loro Parque, Puerto de la Cruz, Tenerife"
  },
  "cluster_id": "d432afdc219f42cfa9b012c9",
  "cluster_name": "Puerto de la Cruz",
  "place_instance_id": "6938f0f4e02cb72937d5c8bb",
  "matched_automatically": true,
  "confidence": "high",
  "score": 0.95,
  "origine": "wordpress", // ou "manuel" ou "bibliotheque"
  "created_at": ISODate("2026-02-17T14:30:00Z"),
  "updated_at": ISODate("2026-02-17T15:45:00Z")
}
```

### Collection `cluster_assignments`
```json
{
  "_id": ObjectId("..."),
  "guide_id": "698103c854f9e04def33b803",
  "assignment": {
    "unassigned": [
      {
        "poi": { /* POI complet */ },
        "current_cluster_id": "unassigned",
        "suggested_match": {
          "place_instance": { /* place_instance suggérée */ },
          "score": 0.88,
          "confidence": "medium"
        },
        "matched_automatically": false
      }
    ],
    "clusters": {
      "d432afdc219f42cfa9b012c9": [
        {
          "poi": { /* POI complet */ },
          "current_cluster_id": "d432afdc219f42cfa9b012c9",
          "place_instance_id": "6938f0f4e02cb72937d5c8bb",
          "suggested_match": {
            "place_instance": { /* place_instance matchée */ },
            "score": 0.95,
            "confidence": "high"
          },
          "matched_automatically": true
        }
      ]
    }
  },
  "clusters_metadata": [
    {
      "cluster_id": "d432afdc219f42cfa9b012c9",
      "cluster_name": "Puerto de la Cruz",
      "place_count": 8,
      "icon": "🏖️"
    }
  ],
  "stats": {
    "total_pois": 49,
    "assigned": 42,
    "unassigned": 7,
    "auto_high": 28,
    "auto_medium": 10,
    "auto_low": 4,
    "manual": 7,
    "total_clusters": 23
  },
  "matched_at": ISODate("2026-02-17T15:00:00Z"),
  "validated_at": null,
  "updated_at": ISODate("2026-02-17T15:45:00Z")
}
```

---

## 🔌 Endpoints API nécessaires

### POIs Management
- `POST /guides/:guideId/pois/generate` - Générer les POIs depuis WordPress (async)
- `GET /guides/:guideId/pois/job-status/:jobId` - Status du job de génération
- `GET /guides/:guideId/pois` - Récupérer tous les POIs du guide
- `POST /guides/:guideId/pois` - Créer un POI manuellement
- `POST /guides/:guideId/pois/from-library` - Ajouter depuis bibliothèque RL
- `PUT /guides/:guideId/pois/:poiId` - Modifier un POI
- `DELETE /guides/:guideId/pois/:poiId` - Supprimer un POI
- `PUT /guides/:guideId/pois/batch-assign` - Affectation groupée

### Matching & Clusters
- `POST /guides/:guideId/matching` - Lancer le matching automatique
- `GET /guides/:guideId/matching` - Récupérer l'état du matching
- `PUT /guides/:guideId/matching/assign` - Affecter un POI à un cluster
- `POST /guides/:guideId/matching/accept-suggestion` - Accepter une suggestion
- `PUT /guides/:guideId/matching/batch-accept` - Accepter toutes les suggestions
- `POST /guides/:guideId/clusters` - Créer un nouveau cluster
- `PUT /guides/:guideId/clusters/:clusterId` - Modifier un cluster
- `DELETE /guides/:guideId/clusters/:clusterId` - Supprimer un cluster

### Bibliothèque Region Lovers
- `GET /guides/:guideId/library` - Liste des POIs de la région depuis RL
  - Wrapper autour de l'API RL : `/place-instance-drafts/region/{regionId}`
  - Ajoute le check "déjà dans le guide"

### Statistiques
- `GET /guides/:guideId/matching/stats` - Statistiques détaillées

---

## 🎨 Codes couleur

### Badges de statut POI
- `✅` Vert : Affecté avec haute confiance (≥90%)
- `⚠️` Orange : Affecté avec moyenne confiance (75-89%) ou suggestion
- `❌` Rouge : Non affecté
- `✏️` Bleu : Affecté manuellement

### Badges d'origine
- `✨` : Généré automatiquement depuis WordPress
- `✏️` : Créé manuellement
- `📚` : Ajouté depuis bibliothèque RL

### Clusters
- `🏖️` : Cluster de type plage/balnéaire
- `🏔️` : Cluster de type montagne/nature
- `🏛️` : Cluster de type culturel/musée
- `🍴` : Cluster de type gastronomie
- `❓` : Non affectés

---

## ✨ Améliorations UX

### 1. **Feedback visuel instantané**
- Animation de déplacement lors de l'affectation
- Badge "Enregistré ✓" après chaque action
- Compteur en temps réel

### 2. **Raccourcis clavier**
- `Ctrl+F` : Focus sur recherche
- `Entrée` : Accepter suggestion (dans panel de détail)
- `←` / `→` : Navigation précédent/suivant
- `Échap` : Fermer modal/panel

### 3. **Sauvegarde automatique**
- Toutes les actions sont sauvegardées immédiatement
- Pas de bouton "Enregistrer" requis

### 4. **Undo/Redo**
- Boutons pour annuler/refaire les dernières actions
- Historique des 20 dernières modifications

### 5. **Mode filtré**
- "Mode focus" : Afficher uniquement les POIs non affectés
- Bouton "Masquer les POIs OK" pour se concentrer sur le reste

---

## 🚀 Workflow complet - Exemple

```
1. Utilisateur arrive sur l'étape "Lieux et Clusters"
   ↓
2. Clic sur "🤖 Générer les lieux depuis WordPress"
   → Job lancé en arrière-plan (QStash)
   → Polling du statut toutes les 3s
   → 49 POIs générés et affichés dans la liste
   ↓
3. Clic sur "🔄 Lancer le matching automatique"
   → Calcul des similarités
   → 42 POIs affectés automatiquement
   → 7 POIs non affectés (dont 5 avec suggestions)
   ↓
4. Utilisateur traite les non affectés :
   - Clic sur "Siam Park" → Panel de détail
   - Accepte suggestion "Costa Adeje"
   - Clic sur "Suivant" → "Masca"
   - Pas de suggestion → Choisit "Buenavista - Garachico" manuellement
   - Continue avec les 5 autres...
   ↓
5. Utilisateur ajoute 2 POIs depuis la bibliothèque :
   - Clic sur "➕ Ajouter un lieu" → "Depuis bibliothèque RL"
   - Recherche "Lago Martiánez"
   - Clic sur "➕ Ajouter" (déjà dans cluster Puerto de la Cruz)
   - Recherche "Auditorio de Tenerife"
   - Clic sur "➕ Ajouter" (dans cluster Santa Cruz)
   ↓
6. Vérification finale :
   - 51 POIs au total (49 générés + 2 ajoutés)
   - 51 POIs affectés (100%)
   - 23 clusters
   ↓
7. Clic sur "✅ Valider et passer au Sommaire"
   → Passage à l'étape suivante
```

---

## 🎯 Avantages de cette fusion

1. ✅ **Workflow simplifié** : Plus besoin de naviguer entre 2 onglets
2. ✅ **Vision d'ensemble** : Liste complète + répartition par cluster
3. ✅ **Matching instantané** : Génération → Matching → Ajustements en une seule vue
4. ✅ **Flexibilité maximale** :
   - Ajout manuel (vierge ou bibliothèque)
   - Réaffectation facile
   - Actions groupées
5. ✅ **Efficacité** : Traitement rapide avec navigation Précédent/Suivant
6. ✅ **Scalable** : Fonctionne avec 10 ou 1000 POIs
7. ✅ **Statistiques** : Vue claire de l'avancement et de la qualité du matching

---

C'est parti pour l'implémentation ! 🚀
