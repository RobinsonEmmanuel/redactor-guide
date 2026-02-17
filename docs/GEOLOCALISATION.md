# Géolocalisation automatique des POIs

## Vue d'ensemble

Lors de la génération du sommaire d'un guide, les lieux (POIs) proposés sont automatiquement géolocalisés via l'API Nominatim (OpenStreetMap). Les coordonnées GPS récupérées sont stockées et affichées dans l'interface.

## Fonctionnement

### 1. Déclenchement automatique

La géolocalisation se déclenche automatiquement :
- Lors de la génération complète du sommaire (`/generate-sommaire`)
- Lors de la régénération partielle des POIs (`/generate-sommaire/partial` avec `parts: ['pois']`)

### 2. Processus

1. **Génération des POIs** : L'IA génère la liste des lieux via le prompt `selection_pois`
2. **Enrichissement GPS** : Pour chaque POI, une requête est envoyée à Nominatim
3. **Stockage** : Les coordonnées sont stockées dans la collection `sommaire_proposals`
4. **Affichage** : Les coordonnées apparaissent dans l'interface utilisateur

## API Nominatim

### Configuration

```typescript
const BASE_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RegionLovers-Recensement/1.0'; // Obligatoire
const RATE_LIMIT = 1000; // 1 requête/seconde
```

### Requête type

```typescript
const query = `${nomLieu}, ${pays}`;
const url = `${BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

const response = await fetch(url, {
  headers: {
    'User-Agent': 'RegionLovers-Recensement/1.0'
  }
});
```

### Réponse type

```json
[
  {
    "place_id": 123456,
    "lat": "28.1234567",
    "lon": "-16.7234567",
    "display_name": "Loro Parque, Puerto de la Cruz, Santa Cruz de Tenerife, Canarias, España",
    "type": "tourism",
    "importance": 0.654
  }
]
```

## Mapping destination → pays

Le service `GeocodingService` contient un mapping pour déterminer le pays à partir du nom de la destination :

```typescript
const destinationCountryMap = {
  'tenerife': 'Spain',
  'gran canaria': 'Spain',
  'marrakech': 'Morocco',
  'lisbonne': 'Portugal',
  // etc.
};
```

Ce mapping permet d'améliorer la précision des résultats Nominatim.

## Stockage des coordonnées

### Dans le sommaire

Les coordonnées sont stockées dans l'objet POI :

```typescript
interface SommairePOI {
  poi_id: string;
  nom: string;
  type: string;
  article_source: string;
  raison_selection: string;
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}
```

### Dans les pages

Lorsqu'un POI est déplacé dans le chemin de fer, les coordonnées sont copiées dans la page :

```typescript
interface Page {
  // ... autres champs
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}
```

## Affichage frontend

### Dans les propositions (ProposalCardMini)

Les coordonnées sont affichées sous la description du POI :

```jsx
{coordinates && (
  <p className="text-[10px] text-gray-400 font-mono">
    📍 {coordinates.lat.toFixed(5)}, {coordinates.lon.toFixed(5)}
  </p>
)}
```

### Dans le chemin de fer (PageCard)

Les coordonnées sont affichées après le type de page :

```jsx
{page.coordinates && (
  <div className="text-[10px] text-gray-400 font-mono mb-3 flex items-center gap-1">
    <span>📍</span>
    <span title={page.coordinates.display_name || 'Coordonnées GPS'}>
      {page.coordinates.lat.toFixed(5)}, {page.coordinates.lon.toFixed(5)}
    </span>
  </div>
)}
```

## Gestion des erreurs

Le service de géolocalisation est tolérant aux erreurs :
- Si un lieu n'est pas trouvé, il est ignoré (log warning)
- Si l'API Nominatim est en erreur, le POI est créé sans coordonnées
- Les autres POIs continuent d'être géolocalisés

### Logs backend

```
🌍 Géolocalisation de 15 lieu(x)...
🌍 Géolocalisation: "Loro Parque, Spain"
✅ Coordonnées trouvées: 28.40932, -16.56469
🌍 Géolocalisation: "Siam Park, Spain"
✅ Coordonnées trouvées: 28.07222, -16.82639
⚠️ Aucun résultat pour "Lieu Inconnu, Spain"
✅ 14/15 lieu(x) géolocalisé(s)
📍 14/15 POI(s) géolocalisé(s)
```

## Limitations et contraintes

### Rate limiting
- **Limite** : 1 requête/seconde
- **Implémentation** : Pause automatique de 1000ms entre chaque requête
- **Impact** : Pour 20 POIs, comptez ~20 secondes de géolocalisation

### Qualité des résultats
- **Dépendance** : Les résultats dépendent de la qualité des données OpenStreetMap
- **Précision** : Variable selon les lieux (très bonne pour les lieux touristiques connus)
- **Faux positifs** : Possibles si plusieurs lieux portent le même nom

### User-Agent obligatoire
- L'API Nominatim **exige** un User-Agent
- Sans User-Agent, les requêtes sont bloquées (HTTP 403)
- User-Agent configuré : `RegionLovers-Recensement/1.0`

## Utilisation future

Les coordonnées GPS peuvent être utilisées pour :
- Afficher les lieux sur une carte interactive
- Calculer des distances entre POIs
- Optimiser les itinéraires
- Filtrer les lieux par proximité géographique
- Générer des cartes PDF pour les guides

## Références

- [Nominatim API Documentation](https://nominatim.org/release-docs/latest/api/Search/)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OpenStreetMap](https://www.openstreetmap.org/)
