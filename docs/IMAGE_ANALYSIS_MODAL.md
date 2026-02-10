# 📊 Modal d'Analyse des Images - Documentation Technique

## Vue d'ensemble

La modal d'analyse des images permet de visualiser les résultats de l'analyse IA (via OpenAI Vision) de toutes les images d'un article WordPress associé à une page du guide.

## 🎯 Fonctionnalités

### Affichage des analyses
- **Miniatures des images** : Vue visuelle de chaque image analysée
- **Scores de qualité** : Barres de progression colorées pour 4 critères :
  - Clarté visuelle
  - Qualité de composition
  - Qualité de lumière
  - Lisibilité sur mobile
- **Badges contextuels** :
  - Pertinence éditoriale (forte/moyenne/faible)
  - Vue d'ensemble du site
  - Vue iconique
  - Type de détail
  - Présence de texte incrusté
  - Présence d'effets graphiques
- **Résumé textuel** : Explication IA de ce que montre l'image

### Code de couleurs

#### Scores (barres de progression)
```
≥ 80% : Vert (Excellent)
≥ 60% : Jaune (Bon)
≥ 40% : Orange (Moyen)
< 40% : Rouge (Faible)
```

#### Pertinence éditoriale
```
Forte   : Vert foncé
Moyenne : Jaune foncé
Faible  : Rouge foncé
```

## 📂 Architecture

### Fichiers créés/modifiés

```
apps/web/components/guide/
├── ImageAnalysisModal.tsx       (✅ NOUVEAU)
└── ContentEditorModal.tsx       (🔧 MODIFIÉ)
```

### Composant principal

**`ImageAnalysisModal.tsx`**

Props :
```typescript
interface ImageAnalysisModalProps {
  guideId: string;      // ID du guide
  pageId: string;       // ID de la page
  apiUrl: string;       // URL de l'API
  onClose: () => void;  // Callback de fermeture
}
```

Structure de données :
```typescript
interface ImageAnalysis {
  image_id: string;
  url: string;
  shows_entire_site: boolean;
  shows_detail: boolean;
  detail_type: string;
  is_iconic_view: boolean;
  is_contextual: boolean;
  visual_clarity_score: number;           // 0-1
  composition_quality_score: number;      // 0-1
  lighting_quality_score: number;         // 0-1
  readability_small_screen_score: number; // 0-1
  has_text_overlay: boolean;
  has_graphic_effects: boolean;
  editorial_relevance: 'forte' | 'moyenne' | 'faible';
  analysis_summary: string;
}
```

## 🔌 Intégration

### Dans ContentEditorModal

Ajout d'un bouton secondaire pour ouvrir la modal d'analyse :

```tsx
{page.url_source && (
  <button
    type="button"
    onClick={() => setShowImageAnalysis(true)}
    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10..."
  >
    <PhotoIcon className="h-4 w-4" />
    📊 Voir les analyses d'images
  </button>
)}
```

État du composant :
```tsx
const [showImageAnalysis, setShowImageAnalysis] = useState(false);
```

Rendu conditionnel :
```tsx
{showImageAnalysis && (
  <ImageAnalysisModal
    guideId={guideId}
    pageId={page._id}
    apiUrl={apiUrl}
    onClose={() => setShowImageAnalysis(false)}
  />
)}
```

## 🌐 API Backend

### Endpoint utilisé

```
GET /api/v1/guides/:guideId/chemin-de-fer/pages/:pageId/image-analysis
```

**Réponse attendue** :
```json
{
  "images": [
    {
      "image_id": "...",
      "url": "https://...",
      "shows_entire_site": true,
      "shows_detail": false,
      "detail_type": "indéterminé",
      "is_iconic_view": true,
      "is_contextual": true,
      "visual_clarity_score": 0.85,
      "composition_quality_score": 0.92,
      "lighting_quality_score": 0.78,
      "readability_small_screen_score": 0.88,
      "has_text_overlay": false,
      "has_graphic_effects": false,
      "editorial_relevance": "forte",
      "analysis_summary": "Vue panoramique du parc national montrant le volcan Teide..."
    }
  ]
}
```

**Gestion des erreurs** :
```json
{
  "error": "Page non trouvée"
}
```

```json
{
  "error": "Aucune image analysée pour cette page"
}
```

## 🎨 UX/UI

### États d'affichage

1. **Chargement** : Spinner avec message "Chargement des analyses..."
2. **Erreur** : Carte rouge avec message d'erreur
3. **Vide** : Icône + message "Aucune image analysée"
4. **Données** : Grille de cartes avec analyses détaillées

### Layout responsive

- **Desktop (≥ md)** : Image à gauche (1/3), analyse à droite (2/3)
- **Mobile (< md)** : Colonnes empilées verticalement

### Hiérarchie visuelle

```
┌─────────────────────────────────────┐
│ 🎨 Header (gradient purple-blue)   │
│ - Icône PhotoIcon                   │
│ - Titre "Analyse des images"        │
│ - Compteur d'images                 │
│ - Bouton fermer (X)                 │
├─────────────────────────────────────┤
│ 📜 Contenu (scrollable)             │
│                                     │
│ ┌─────────────────────────────┐   │
│ │ [Image] | Résumé            │   │
│ │         | Scores (barres)   │   │
│ │         | Badges             │   │
│ └─────────────────────────────┘   │
│                                     │
│ (répété pour chaque image)          │
│                                     │
├─────────────────────────────────────┤
│ 🔘 Footer (bouton fermer)          │
└─────────────────────────────────────┘
```

## 🔄 Workflow utilisateur

1. Utilisateur ouvre la modal d'édition d'une page (PageModal ou ContentEditorModal)
2. Clic sur "📊 Voir les analyses d'images"
3. Modal d'analyse s'ouvre en superposition
4. Affichage automatique de toutes les images et analyses
5. Utilisateur consulte les scores et badges
6. Fermeture via bouton "Fermer" ou icône X

## 🧪 Cas d'usage

### Scénario 1 : Vérifier la qualité d'une image avant génération
```
L'éditeur veut s'assurer que les images de l'article sont de bonne qualité
→ Clique sur "Voir les analyses d'images"
→ Consulte les scores de clarté, composition, etc.
→ Identifie les images avec pertinence "forte"
→ Lance la génération en confiance
```

### Scénario 2 : Comprendre pourquoi une image a été sélectionnée
```
L'IA a choisi une image spécifique pour la page
→ Ouvre la modal d'analyse
→ Voit que l'image a un score de 0.92 en composition
→ Badge "Vue d'ensemble" présent
→ Pertinence éditoriale "forte"
→ Comprend le choix automatique
```

### Scénario 3 : Détecter des problèmes (texte incrusté, effets)
```
Une image semble inadaptée au guide
→ Ouvre la modal d'analyse
→ Badge rouge "Texte incrusté" visible
→ Score de lisibilité mobile faible (0.42)
→ Peut choisir manuellement une autre image
```

## 🐛 Gestion des erreurs

### Frontend
- **Réseau** : Message "Erreur réseau lors du chargement des analyses"
- **API** : Affichage du message d'erreur renvoyé par l'API
- **Aucune donnée** : UI spécifique avec message informatif

### Backend
- **Page introuvable** : 404 avec message explicite
- **Article sans images** : Retourne tableau vide
- **Images non analysées** : Retourne tableau vide (analyses faites à la demande)

## 🔮 Améliorations futures

### Court terme
- [ ] Ajouter un bouton "Relancer l'analyse" pour forcer une nouvelle analyse
- [ ] Afficher la date de dernière analyse
- [ ] Filtrer par score minimal (ex: montrer seulement images > 0.7)

### Moyen terme
- [ ] Comparer 2 images côte à côte
- [ ] Sélectionner manuellement une image pour la page depuis la modal
- [ ] Historique des analyses (versions précédentes)

### Long terme
- [ ] Intégration avec système de crop/édition d'image
- [ ] Suggestions d'amélioration (recadrage, luminosité, etc.)
- [ ] Export PDF du rapport d'analyse

## 📝 Notes techniques

### Performance
- Images chargées en `lazy loading`
- Pas de cache côté frontend (reload à chaque ouverture)
- API backend peut mettre en cache les analyses dans MongoDB

### Accessibilité
- Boutons avec labels explicites
- Couleurs avec contraste suffisant (WCAG AA)
- Icônes accompagnées de texte
- Modal fermable au clavier (ESC - à implémenter)

### Sécurité
- Requêtes avec `credentials: 'include'` (JWT)
- Validation des IDs côté backend
- URLs d'images vérifiées (proviennent de WordPress)

---

**Date de création** : 2026-02-02  
**Auteur** : Assistant IA  
**Version** : 1.0.0
