# Matching Cluster - Documentation

## Vue d'ensemble

Le système de **Matching Cluster** permet d'affecter automatiquement les lieux (POIs) détectés dans les articles WordPress aux clusters de la base Region Lovers.

Cette fonctionnalité utilise un algorithme de similarité de chaînes pour proposer des correspondances automatiques, et offre une interface drag & drop pour ajuster manuellement les affectations.

## Accès

**Onglet** : "Matching Cluster" (entre "Articles WordPress" et "Chemin de fer")

**Condition d'accès** : Les articles WordPress doivent avoir été récupérés

**Prérequis** :
- Guide configuré avec `destination_rl_id` (ID MongoDB de la région dans Region Lovers)
- Variables d'environnement API Region Lovers configurées

## Workflow utilisateur

### 1. Génération des POIs

**Bouton** : "📍 Générer les POIs"

**Processus** :
1. L'IA génère la liste des POIs depuis les articles WordPress (réutilise le prompt `selection_pois`)
2. Récupération des clusters depuis l'API Region Lovers (`GET /place-instance-drafts/region/{regionId}`)
3. Auto-matching par algorithme de similarité
4. Affichage dans l'interface Kanban

**Résultat** :
- POIs avec score ≥ 60% → Affectés automatiquement au cluster suggéré
- POIs avec score < 60% → Placés dans "Non affectés"

### 2. Ajustement manuel (Drag & Drop)

**Interface Kanban** :
- **Colonne "❓ Non affectés"** : POIs sans match ou score faible
- **Colonnes clusters** : Un cluster = une colonne

**Actions** :
- Glisser-déposer un POI d'une colonne à l'autre
- Les POIs déplacés manuellement sont marqués comme tels (badge disparaît)

### 3. Sauvegarde

**Bouton** : "💾 Enregistrer"

**Effet** :
- Sauvegarde l'état final en base MongoDB (`cluster_assignments`)
- Met à jour les statistiques

## Algorithme de matching

### Normalisation des chaînes

```
"Loro Parque"   → "loro parque"
"Parc-National" → "parc national"
"Téléphérique"  → "telepherique"
```

**Opérations** :
1. Minuscules
2. Suppression des accents (NFD normalization)
3. Suppression des caractères spéciaux
4. Normalisation des espaces

### Calcul de similarité

**Méthode** : Distance de Levenshtein normalisée

**Cas spéciaux** :
- **Match exact** : score = 1.0 (100%)
- **L'un contient l'autre** : score = 0.85-0.95
- **Distance de Levenshtein** : score = 1 - (distance / longueur_max)

**Exemple** :
```
"Loro Parque" vs "Loro-Parque"         → 98% (match quasi exact)
"Siam Park" vs "Siam Park Tenerife"    → 92% (contient)
"Mirador X" vs "Mirador Y"             → 78% (Levenshtein)
"Plage A" vs "Restaurant B"            → 15% (aucune similarité)
```

### Seuils de confiance

| Score | Confiance | Badge | Affectation |
|-------|-----------|-------|-------------|
| ≥ 90% | High ✅ | Vert | Auto |
| 75-89% | Medium ⚠️ | Jaune | Auto |
| 60-74% | Low ⚠️ | Orange | Auto |
| < 60% | - | - | Non affecté |

## Interface utilisateur

### Colonne de cluster

```
┌─────────────────────┐
│ 🏛️ Culture (3)     │ ← Nom + compteur
├─────────────────────┤
│ [POI Cards...]      │
│                     │
│ Glissez ici →       │ ← Drop zone
└─────────────────────┘
```

### Carte POI

```
┌─────────────────────┐
│ 📍 Loro Parque      │
│ 📍 28.40932,-16.56  │ ← Coordonnées GPS
│ 🏷️ Type: zoo       │
│ ✅ 98% (Auto)       │ ← Score + badge
└─────────────────────┘
```

**Badges** :
- ✅ **High confidence** : Vert (≥90%)
- ⚠️ **Medium confidence** : Jaune (75-89%)
- ⚠️ **Low confidence** : Orange (60-74%)
- **(Auto)** : Affectation automatique (disparaît si déplacé manuellement)

### Barre de progression

```
📊 Progression: 12/15 POIs affectés
```

## API Backend

### Routes

#### `POST /guides/:guideId/matching/generate`

Génère les POIs et effectue l'auto-matching.

**Réponse** :
```json
{
  "success": true,
  "assignment": {
    "unassigned": [...],
    "clusters": {
      "cluster_id_1": [...],
      "cluster_id_2": [...]
    }
  },
  "stats": {
    "total_pois": 15,
    "assigned": 12,
    "unassigned": 3,
    "auto_matched": 10,
    "manual_matched": 2
  },
  "clusters_metadata": [...]
}
```

#### `GET /guides/:guideId/matching`

Récupère l'état actuel du matching.

#### `POST /guides/:guideId/matching/save`

Sauvegarde l'état après modifications drag & drop.

**Body** :
```json
{
  "assignment": { ... }
}
```

### Intégration API Region Lovers

**Endpoint** : `GET /place-instance-drafts/region/{regionId}`

**Headers** :
```
Authorization: Bearer {REGION_LOVERS_API_TOKEN}
Content-Type: application/json
```

**Réponse attendue** :
```json
[
  {
    "_id": "cluster_123",
    "place_name": "Loro Parque",
    "place_type": "zoo",
    "place_instance_id": "..."
  },
  ...
]
```

## Structure de données

### Collection MongoDB : `cluster_assignments`

```json
{
  "guide_id": "698103c854f9e04def33b803",
  "region_id": "68c2aaeb5a239cd1cfe753f0",
  "assignment": {
    "unassigned": [
      {
        "poi": {
          "poi_id": "poi_001",
          "nom": "Mirador X",
          "type": "panorama",
          "article_source": "mirador-x-tenerife",
          "coordinates": { "lat": 28.12, "lon": -16.45 }
        },
        "current_cluster_id": "unassigned",
        "suggested_cluster": {
          "cluster": { "_id": "...", "place_name": "...", "place_type": "..." },
          "score": 0.45,
          "confidence": "low"
        },
        "matched_automatically": false
      }
    ],
    "clusters": {
      "cluster_123": [
        {
          "poi": { ... },
          "current_cluster_id": "cluster_123",
          "suggested_cluster": { ... },
          "matched_automatically": true
        }
      ]
    }
  },
  "stats": {
    "total_pois": 15,
    "assigned": 12,
    "unassigned": 3,
    "auto_matched": 10,
    "manual_matched": 2,
    "by_cluster": {
      "cluster_123": 4,
      "cluster_456": 5,
      "cluster_789": 3
    }
  },
  "clusters_metadata": [
    {
      "cluster_id": "cluster_123",
      "place_name": "Loro Parque",
      "place_type": "zoo"
    }
  ],
  "created_at": "2026-02-17T12:00:00.000Z",
  "updated_at": "2026-02-17T12:30:00.000Z"
}
```

## Configuration

### Variables d'environnement (.env)

```env
# API Region Lovers
REGION_LOVERS_API_URL=https://api-prod.regionlovers.ai
REGION_LOVERS_API_TOKEN=your_token_here
```

### Configuration du guide

Dans l'interface de création/édition du guide, renseigner :
- **destination_rl_id** : ID MongoDB de la région dans Region Lovers (ex: `68c2aaeb5a239cd1cfe753f0`)

## Cas d'usage

### 1. Premier matching d'un guide

1. Récupérer les articles WordPress
2. Aller dans l'onglet "Matching Cluster"
3. Cliquer sur "Générer les POIs"
4. Vérifier les suggestions automatiques
5. Ajuster manuellement si nécessaire (drag & drop)
6. Cliquer sur "Enregistrer"

### 2. Ajustement après nouvelle ingestion

Si de nouveaux articles sont ajoutés :
1. Aller dans "Matching Cluster"
2. Cliquer sur "Générer les POIs" (écrase l'état précédent)
3. Réajuster manuellement
4. Sauvegarder

### 3. Audit des affectations

- Consulter la colonne "Non affectés" pour identifier les POIs problématiques
- Vérifier les scores de confiance (badges)
- Identifier les POIs nécessitant une création de cluster dans Region Lovers

## Statistiques

Les statistiques suivantes sont calculées automatiquement :

- **total_pois** : Nombre total de POIs détectés
- **assigned** : POIs affectés à un cluster
- **unassigned** : POIs dans "Non affectés"
- **auto_matched** : POIs affectés automatiquement (score ≥ 60%)
- **manual_matched** : POIs affectés manuellement (drag & drop)
- **by_cluster** : Répartition par cluster

## Limitations et améliorations futures

### Limitations actuelles

1. **Régénération complète** : Cliquer sur "Générer" écrase tout
2. **Pas de fusion** : Impossible de fusionner avec un matching existant
3. **Pas de recherche manuelle** : Pas de champ de recherche pour trouver un cluster
4. **Pas d'historique** : Pas de tracking des modifications

### Améliorations prévues

- [ ] Mode "Ajouter aux POIs existants" (fusion)
- [ ] Recherche de clusters par nom
- [ ] Historique des modifications (audit trail)
- [ ] Export CSV des affectations
- [ ] Filtre par niveau de confiance
- [ ] Suggestion de création de nouveau cluster pour les non affectés

## Dépannage

### "destination_rl_id manquant"
→ Configurez l'ID Region Lovers dans les paramètres du guide

### "REGION_LOVERS_API_TOKEN non configuré"
→ Ajoutez la variable d'environnement dans Railway

### "Erreur API Region Lovers"
→ Vérifiez que le `regionId` est valide et que le token est correct

### Aucun POI généré
→ Vérifiez que les articles WordPress ont bien été récupérés pour cette destination

### Tous les POIs dans "Non affectés"
→ Les noms de lieux dans les articles ne correspondent pas aux noms des clusters Region Lovers (problème de nomenclature)

## Références

- [Distance de Levenshtein (Wikipedia)](https://fr.wikipedia.org/wiki/Distance_de_Levenshtein)
- [@dnd-kit Documentation](https://docs.dndkit.com/)
- API Region Lovers (documentation interne)
