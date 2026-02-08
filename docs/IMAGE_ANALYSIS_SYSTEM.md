# Système d'analyse d'images avec OpenAI Vision

Ce document décrit le système d'analyse automatique des images lors de l'ingestion WordPress.

## Vue d'ensemble

Le système analyse automatiquement toutes les images des articles WordPress avec **OpenAI Vision API (GPT-4o)** pour évaluer leur qualité et pertinence éditoriale. Les métadonnées d'analyse sont stockées dans MongoDB et réutilisées pour la sélection automatique d'images lors de la génération de contenu.

## Architecture

```
┌─────────────────────────────────────────┐
│  1. Ingestion WordPress                  │
│  - Récupération articles + images[]     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  2. Analyse images (si activée)         │
│  - 1 appel OpenAI Vision par image      │
│  - Prompt: analyse_image (en base)      │
│  - Model: gpt-4o                         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  3. Stockage métadonnées                │
│  - articles_raw.images_analysis[]       │
│  - Scores, flags, résumé par image      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  4. Sélection automatique (génération)  │
│  - Filtrage par scores et critères      │
│  - Choix optimal sans appel API         │
└─────────────────────────────────────────┘
```

## Activation

### Lors de l'ingestion

Ajouter le paramètre `analyzeImages: true` dans le body de la requête :

```bash
POST /api/v1/ingest
```

```json
{
  "siteId": "canarias-lovers",
  "destinationIds": ["tenerife"],
  "siteUrl": "https://canarias-lovers.com",
  "jwtToken": "your-jwt-token",
  "languages": ["fr", "es", "en"],
  "analyzeImages": true
}
```

### Prérequis

1. **Prompt système** : Un prompt avec `intent: "analyse_image"` et `actif: true` doit exister dans la collection `prompts`
2. **Clé API OpenAI** : `OPENAI_API_KEY` configurée dans `.env`

## Prompt d'analyse

Le prompt d'analyse doit être créé dans la collection `prompts` :

```javascript
{
  "prompt_id": "analyse_img_001",
  "prompt_nom": "Analyse qualité images pour guides",
  "intent": "analyse_image",
  "categories": ["image", "analyse", "ia"],
  "langue_source": "fr",
  "texte_prompt": `Tu es un assistant spécialisé dans l'analyse d'images...
  
[Format de sortie attendu]
{
  "image_id": "string",
  "shows_entire_site": boolean,
  "shows_detail": boolean,
  ...
}`,
  "version": "1.0.0",
  "actif": true
}
```

## Structure des métadonnées

Les analyses sont stockées dans `articles_raw.images_analysis[]` :

```javascript
{
  "_id": ObjectId("..."),
  "site_id": "canarias-lovers",
  "title": "Visiter Siam Park",
  "images": [
    "https://canarias-lovers.com/wp-content/uploads/2024/09/siam-park-1.jpg",
    "https://canarias-lovers.com/wp-content/uploads/2024/09/siam-park-2.jpg"
  ],
  "images_analysis": [
    {
      "url": "https://canarias-lovers.com/wp-content/uploads/2024/09/siam-park-1.jpg",
      "analysis": {
        "shows_entire_site": true,
        "shows_detail": false,
        "detail_type": "paysage",
        "is_iconic_view": true,
        "is_contextual": true,
        "visual_clarity_score": 0.9,
        "composition_quality_score": 0.85,
        "lighting_quality_score": 0.8,
        "readability_small_screen_score": 0.9,
        "has_text_overlay": false,
        "has_graphic_effects": false,
        "editorial_relevance": "forte",
        "analysis_summary": "Vue d'ensemble du parc aquatique montrant l'architecture thaïlandaise et les toboggans principaux"
      },
      "analyzed_at": "2026-02-02T10:30:00Z"
    },
    {
      "url": "https://canarias-lovers.com/wp-content/uploads/2024/09/siam-park-2.jpg",
      "analysis": {
        "shows_entire_site": false,
        "shows_detail": true,
        "detail_type": "architecture",
        "is_iconic_view": false,
        "is_contextual": false,
        "visual_clarity_score": 0.7,
        "composition_quality_score": 0.6,
        "lighting_quality_score": 0.75,
        "readability_small_screen_score": 0.65,
        "has_text_overlay": false,
        "has_graphic_effects": false,
        "editorial_relevance": "moyenne",
        "analysis_summary": "Détail d'un toboggan avec texture de la surface"
      },
      "analyzed_at": "2026-02-02T10:30:15Z"
    }
  ]
}
```

## Champs d'analyse

| Champ | Type | Description |
|-------|------|-------------|
| `shows_entire_site` | `boolean` | L'image montre une vue d'ensemble du lieu |
| `shows_detail` | `boolean` | L'image montre un détail spécifique |
| `detail_type` | `enum` | Type de détail (`architecture`, `nature`, `intérieur`, `paysage`, `usage`, `symbole`, `indéterminé`) |
| `is_iconic_view` | `boolean` | Vue emblématique du lieu (reconnaissable) |
| `is_contextual` | `boolean` | Image apporte du contexte sur le lieu |
| `visual_clarity_score` | `0-1` | Score de netteté visuelle |
| `composition_quality_score` | `0-1` | Score de composition |
| `lighting_quality_score` | `0-1` | Score de qualité de lumière |
| `readability_small_screen_score` | `0-1` | Lisibilité sur mobile |
| `has_text_overlay` | `boolean` | Présence de texte incrusté |
| `has_graphic_effects` | `boolean` | Présence d'effets graphiques/filtres |
| `editorial_relevance` | `enum` | Pertinence éditoriale (`faible`, `moyenne`, `forte`) |
| `analysis_summary` | `string` | Résumé de ce que montre l'image |

## Sélection automatique d'images

### API

Le service `ImageAnalysisService` fournit deux méthodes :

#### 1. `selectBestImage(analyses, criteria)`

Sélectionne **LA** meilleure image selon des critères :

```typescript
const bestImage = imageAnalysisService.selectBestImage(
  article.images_analysis,
  {
    preferGlobalView: true,
    minClarityScore: 0.7,
    minCompositionScore: 0.6,
    minReadabilityScore: 0.7,
    avoidTextOverlay: true,
    avoidGraphicEffects: true,
    preferIconicView: true,
    minRelevance: 'moyenne'
  }
);

console.log(bestImage.url); // URL de la meilleure image
```

#### 2. `filterImages(analyses, criteria)`

Filtre **toutes** les images correspondant aux critères :

```typescript
const validImages = imageAnalysisService.filterImages(
  article.images_analysis,
  {
    minClarityScore: 0.6,
    minReadabilityScore: 0.6,
    avoidTextOverlay: true
  }
);

console.log(`${validImages.length} images valides`);
```

### Critères de sélection

```typescript
interface SelectionCriteria {
  preferGlobalView?: boolean;        // Préférer vues d'ensemble
  minClarityScore?: number;          // Score minimum de netteté (0-1)
  minCompositionScore?: number;      // Score minimum de composition (0-1)
  minReadabilityScore?: number;      // Score minimum lisibilité mobile (0-1)
  avoidTextOverlay?: boolean;        // Éviter texte incrusté
  avoidGraphicEffects?: boolean;     // Éviter effets graphiques
  preferIconicView?: boolean;        // Préférer vues iconiques
  minRelevance?: 'faible' | 'moyenne' | 'forte'; // Relevance éditoriale minimale
}
```

### Algorithme de scoring

Chaque image reçoit un score sur 100 :

```
Score = 
  + visual_clarity_score × 15
  + composition_quality_score × 10
  + lighting_quality_score × 5
  + readability_small_screen_score × 10
  + (shows_entire_site ? 30 : 0)
  + (is_iconic_view ? 20 : 0)
  + (editorial_relevance === 'forte' ? 10 : 0)
  + (editorial_relevance === 'moyenne' ? 5 : 0)
```

**Maximum** : 100 points

### Utilisation dans la génération de contenu

Dans `page-redaction.service.ts` :

```typescript
// Charger l'article avec analyses
const article = await this.loadArticleSource(page.url_source);

// Sélectionner meilleure image pour une page POI
const bestImageUrl = this.selectBestImage(article, {
  preferGlobalView: true,
  minClarityScore: 0.7,
  avoidTextOverlay: true,
  minRelevance: 'moyenne'
});

// Utiliser dans le contenu généré
const content = {
  POI_image_1: bestImageUrl,
  // ...
};
```

## Performance et coûts

### Coûts API

- **Modèle** : `gpt-4o` (Vision)
- **Tokens par image** : ~300-500 tokens
- **Coût par image** : ~$0.005-0.01 (estimation)
- **Exemple** : 100 articles × 3 images = ~$1.50-3.00

### Temps d'analyse

- **1 image** : ~2-3 secondes
- **10 images** : ~25-30 secondes (avec délai 500ms entre appels)
- **100 articles (300 images)** : ~15-20 minutes

### Optimisations

1. **Analyse unique** : Les métadonnées sont stockées et réutilisées (pas de ré-analyse)
2. **Délai entre appels** : 500ms pour éviter rate limiting
3. **Parallélisation** : Possible via QStash pour gros volumes
4. **Cache** : Les analyses persistent dans MongoDB

## Logs et monitoring

### Logs d'analyse

```
📸 Analyse de 3 image(s)...
📸 Analyse image 1/3: https://canarias-lovers.com/.../image1.jpg
✅ Image 1 analysée avec succès
📸 Analyse image 2/3: https://canarias-lovers.com/.../image2.jpg
✅ Image 2 analysée avec succès
📸 Analyse image 3/3: https://canarias-lovers.com/.../image3.jpg
✅ Image 3 analysée avec succès
✅ 3/3 image(s) analysée(s)
```

### Logs de sélection

```
📸 Meilleure image sélectionnée avec score: 87.50/100
```

### Gestion d'erreurs

Les erreurs d'analyse sont **non-bloquantes** :

```
⚠️ Erreur analyse images: API rate limit exceeded
```

L'ingestion continue même si l'analyse échoue. Les images sans analyse utilisent la première image par défaut.

## Bonnes pratiques

### 1. Analyser lors de l'ingestion

✅ **Recommandé** : Analyser pendant l'ingestion (1 seule fois)

```json
{
  "analyzeImages": true
}
```

❌ **Déconseillé** : Analyser à chaque génération de contenu (coûts multiples)

### 2. Créer un prompt adapté

Le prompt doit être :
- **Factuel** : Pas de jugement, juste des observations
- **Structuré** : Format JSON strict
- **Complet** : Tous les champs requis

### 3. Définir des critères de sélection cohérents

```typescript
// ✅ Bon : critères adaptés au type de page
const poiImageCriteria = {
  preferGlobalView: true,
  minClarityScore: 0.7,
  avoidTextOverlay: true
};

// ❌ Mauvais : critères trop stricts (aucune image ne passe)
const tooStrictCriteria = {
  minClarityScore: 0.95,
  minCompositionScore: 0.95,
  minReadabilityScore: 0.95
};
```

### 4. Fallback sur première image

Toujours prévoir un fallback si aucune image ne correspond :

```typescript
const bestImage = selectBestImage(analyses, criteria);
const imageUrl = bestImage?.url || article.images[0] || null;
```

## Limitations

1. **Coûts API** : L'analyse a un coût (prévoir budget)
2. **Temps d'ingestion** : L'ingestion est plus longue avec analyse
3. **Qualité du prompt** : Dépend de la qualité du prompt d'analyse
4. **Rate limiting** : OpenAI limite à ~50 req/min (délai 500ms intégré)
5. **Vision AI** : Parfois imprécise sur détails subtils

## Évolutions futures

- [ ] Analyse en parallèle (Workers concurrents)
- [ ] Cache d'analyse par hash d'image (si même image sur plusieurs articles)
- [ ] Ré-analyse manuelle d'images spécifiques
- [ ] Interface admin pour visualiser analyses
- [ ] Système de tag manuel pour override sélection auto
- [ ] Analyse de conformité (ex: présence de personnes, logos, etc.)
