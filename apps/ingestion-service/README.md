# Ingestion Service

Microservice REST autonome pour l'ingestion d'articles WordPress, la détection de POIs (Points d'Intérêt) et le matching avec les clusters Region Lovers.

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Démarrage rapide](#démarrage-rapide)
- [Variables d'environnement](#variables-denvironnement)
- [Authentification](#authentification)
- [Référence des endpoints](#référence-des-endpoints)
  - [Ingestion WordPress](#ingestion-wordpress)
  - [Détection POI](#détection-poi)
  - [Matching clusters](#matching-clusters)
- [Flux typiques](#flux-typiques)
- [Architecture interne](#architecture-interne)

---

## Vue d'ensemble

Ce service centralise trois fonctions utilisées par plusieurs outils :

| Fonction | Description |
|---|---|
| **Ingestion WP** | Télécharge les articles d'un site WordPress, extrait leur contenu en Markdown, résout les URLs par langue (WPML) |
| **Détection POI** | Classifie les articles par IA, extrait les lieux touristiques (mono-article ou H2/H3), dédoublonne via algorithme + LLM |
| **Matching clusters** | Compare les POIs aux `place_instances` Region Lovers par similarité de nom, affecte chaque POI au cluster le plus probable |

L'accès est sécurisé par une **clé API** transmise dans le header `X-Api-Key`.

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 18
- MongoDB (partagé ou dédié)
- Compte Upstash QStash (pour les jobs asynchrones)
- Clé OpenAI (pour l'extraction POI et la déduplication)

### Installation

```bash
# Depuis la racine du monorepo
npm install

# Démarrer uniquement ce service
npm run dev:ingestion

# Ou depuis le dossier du service
cd apps/ingestion-service
npm run dev
```

### Configuration

```bash
cp apps/ingestion-service/.env.example apps/ingestion-service/.env
# Remplir les variables (voir ci-dessous)
```

---

## Variables d'environnement

| Variable | Requis | Défaut | Description |
|---|---|---|---|
| `PORT` | Non | `4001` | Port d'écoute du service |
| `MONGODB_URI` | **Oui** | — | URI de connexion MongoDB |
| `MONGODB_DB_NAME` | **Oui** | — | Nom de la base de données |
| `API_KEY_SECRET` | Recommandé | — | Clé secrète pour l'authentification des appels entrants |
| `OPENAI_API_KEY` | Oui (POI) | — | Clé API OpenAI — requis pour la détection et déduplication POI |
| `QSTASH_TOKEN` | Oui (async) | — | Token Upstash QStash pour publier des jobs |
| `INGEST_WORKER_URL` | Oui (async) | — | URL publique **de ce service** — utilisée par QStash pour les callbacks (`https://mon-service.railway.app`) |
| `REGION_LOVERS_API_URL` | Non | `https://api-prod.regionlovers.ai` | URL de l'API Region Lovers |
| `PROMPT_ID_POI_EXTRACTION` | Non | `prompt_1770544848350_9j5m305ukj` | ID du prompt d'extraction POI en base |
| `PROMPT_ID_POI_DEDUP` | Non | `deduplication_POI_24022026` | ID du prompt de déduplication POI en base |

> **Important :** `INGEST_WORKER_URL` doit être l'URL publique accessible par QStash, pas `localhost`. En développement local, utiliser un tunnel (ex: [ngrok](https://ngrok.com/) ou [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).

---

## Authentification

Toutes les routes (sauf `/health` et les callbacks worker appelés par QStash) nécessitent le header :

```
X-Api-Key: <valeur de API_KEY_SECRET>
```

**Routes exemptées** (callbacks QStash, sans clé API) :
- `POST /api/v1/ingest/run`
- `POST /api/v1/workers/generate-pois`
- `POST /api/v1/workers/deduplicate-pois`

Si `API_KEY_SECRET` n'est pas défini dans l'environnement, l'authentification est désactivée (pratique en développement local).

**Exemple d'appel authentifié :**

```bash
curl -X POST https://mon-service.railway.app/api/v1/ingest/enqueue \
  -H "X-Api-Key: mon_secret" \
  -H "Content-Type: application/json" \
  -d '{ "siteId": "site_abc", "siteUrl": "https://mon-site.fr", "jwtToken": "..." }'
```

---

## Référence des endpoints

### Santé

#### `GET /health`

Vérifie que le service et la connexion MongoDB sont opérationnels.

**Réponse 200 :**
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-03-17T14:00:00.000Z"
}
```

---

### Ingestion WordPress

#### `POST /api/v1/ingest`

Ingestion **synchrone** de tous les articles d'un site WordPress. Adapté aux petits volumes ou au développement. Pour les gros sites, préférer `/ingest/enqueue`.

**Body :**
```json
{
  "siteId": "site_abc",
  "siteUrl": "https://mon-site.fr",
  "jwtToken": "eyJ...",
  "destinationIds": ["dest_123"],
  "languages": ["fr", "en", "es"],
  "analyzeImages": false
}
```

| Champ | Type | Requis | Description |
|---|---|---|---|
| `siteId` | string | Oui | Identifiant unique du site dans la base |
| `siteUrl` | string (URL) | Oui | URL racine du site WordPress |
| `jwtToken` | string | Oui | Token JWT WordPress (WP Application Passwords) |
| `destinationIds` | string[] | Non | IDs de destination pour filtrer les articles |
| `languages` | string[] | Non | Langues à ingérer (défaut : fr, it, es, de, da, sv, en, pt, nl) |
| `analyzeImages` | boolean | Non | Active l'analyse d'images par IA (défaut : false) |

**Réponse 200 :**
```json
{
  "success": true,
  "count": 142,
  "errors": ["Article ID 55 : timeout"]
}
```

---

#### `POST /api/v1/ingest/enqueue`

Ingestion **asynchrone** via QStash. Répond immédiatement avec un `jobId`. QStash appelle ensuite `POST /api/v1/ingest/run` pour exécuter le travail.

**Body :** identique à `POST /ingest`

**Réponse 202 :**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued"
}
```

**Réponse 503** si `QSTASH_TOKEN` ou `INGEST_WORKER_URL` ne sont pas configurés.

---

#### `GET /api/v1/ingest/status/:jobId`

Retourne le statut d'un job d'ingestion asynchrone.

**Réponse 200 :**
```json
{
  "status": "completed",
  "result": {
    "count": 142
  }
}
```

Valeurs de `status` : `queued` | `processing` | `completed` | `failed`

---

#### `POST /api/v1/ingest/single-url`

Ingère un **article unique** depuis son URL publique. Utile pour ajouter un article manquant sans relancer toute l'ingestion.

**Body :**
```json
{
  "siteId": "site_abc",
  "siteUrl": "https://mon-site.fr",
  "jwtToken": "eyJ...",
  "articleUrl": "https://mon-site.fr/mon-article-slug/",
  "destinationIds": ["dest_123"]
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "title": "Titre de l'article",
  "slug": "mon-article-slug",
  "inserted": true,
  "updated": false,
  "imagesCount": 8,
  "langs": ["fr", "en", "es"]
}
```

---

#### `POST /api/v1/ingest/sync-translations`

Synchronise uniquement les **URLs de traduction** (via WPML) pour un site déjà ingéré. Appel léger, sans re-téléchargement du contenu.

**Body :**
```json
{
  "siteId": "site_abc",
  "siteUrl": "https://mon-site.fr",
  "jwtToken": "eyJ...",
  "languages": ["en", "es", "de"]
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "updated": 98,
  "skipped": 12
}
```

---

### Détection POI

La détection POI est un processus en deux phases, toutes deux **asynchrones** :

1. **Extraction** (`/guides/:guideId/pois/generate`) — classifie les articles et extrait les lieux
2. **Déduplication** (`/guides/:guideId/pois/jobs/:jobId/deduplicate`) — fusionne les doublons algorithmiquement puis par LLM

Les résultats sont stockés dans la collection MongoDB `pois_generation_jobs` et récupérables via polling.

---

#### `POST /api/v1/guides/:guideId/pois/generate`

Lance l'extraction des POIs pour un guide. Le guide doit déjà avoir des articles ingérés filtrés par sa `destination`.

**Réponse 200 :**
```json
{
  "success": true,
  "jobId": "65f3c2a1b4e8d92a1c3f4b5e",
  "message": "Génération des POIs lancée en arrière-plan"
}
```

**Réponse 503** si QStash n'est pas configuré.

---

#### `GET /api/v1/guides/:guideId/pois/job-status/:jobId`

Statut détaillé d'un job d'extraction.

**Réponse 200 :**
```json
{
  "status": "extraction_complete",
  "raw_count": 87,
  "progress": null,
  "preview_pois": [
    {
      "poi_id": "plage_de_los_gigantes",
      "nom": "Plage de Los Gigantes",
      "type": "plage",
      "article_source": "Les plus belles plages de Tenerife",
      "url_source": "https://canarias-lovers.com/plages-tenerife/",
      "mentions": "principale"
    }
  ],
  "classification_log": [...],
  "mono_count": 34,
  "multi_count": 18,
  "excluded_count": 6
}
```

Valeurs de `status` : `pending` | `processing` | `extraction_complete` | `deduplicating` | `dedup_complete` | `completed` | `failed` | `cancelled`

---

#### `GET /api/v1/guides/:guideId/pois/latest-job`

Retourne le job le plus récent en attente d'action (statuts `extraction_complete`, `deduplicating`, `dedup_complete`). Utile pour reprendre le workflow après un rechargement de page.

---

#### `POST /api/v1/guides/:guideId/pois/jobs/:jobId/deduplicate`

Déclenche la déduplication asynchrone des POIs extraits. Répond immédiatement — la progression est suivie via `/job-status/:jobId`.

**Réponse 200 :**
```json
{
  "success": true,
  "message": "Dédoublonnage lancé en arrière-plan"
}
```

---

### Matching clusters

Ces routes comparent les POIs sélectionnés aux `place_instances` Region Lovers et les affectent aux clusters correspondants par similarité de nom (algorithme Levenshtein + seuil de confiance).

> **Authentification Region Lovers :** les routes de matching transmettent le token JWT de l'utilisateur final à l'API Region Lovers. Inclure le header `Authorization: Bearer <token>` ou le cookie `accessToken` dans la requête.

---

#### `POST /api/v1/guides/:guideId/matching/generate`

Lance le matching automatique : charge les POIs depuis `pois_selection`, récupère les clusters Region Lovers pour la région du guide, effectue l'auto-matching et sauvegarde le résultat.

**Headers requis :**
```
X-Api-Key: <secret>
Authorization: Bearer <token_region_lovers>
```

**Réponse 200 :**
```json
{
  "success": true,
  "assignment": {
    "clusters": {
      "cluster_abc": [
        {
          "poi": { "nom": "Teide", "type": "site_naturel" },
          "current_cluster_id": "cluster_abc",
          "place_instance_id": "pi_xyz",
          "suggested_match": { "score": 0.97, "confidence": "high" },
          "matched_automatically": true
        }
      ]
    },
    "unassigned": [...]
  },
  "stats": {
    "total_pois": 45,
    "assigned": 38,
    "unassigned": 7,
    "auto_matched": 38
  },
  "clusters_metadata": [
    { "cluster_id": "cluster_abc", "cluster_name": "Nord de l'île", "place_count": 12 }
  ]
}
```

---

#### `GET /api/v1/guides/:guideId/matching`

Récupère l'état actuel du matching sauvegardé en base.

---

#### `POST /api/v1/guides/:guideId/matching/save`

Sauvegarde l'état du matching après modifications manuelles (drag & drop dans l'UI).

**Body :**
```json
{
  "assignment": { "clusters": {...}, "unassigned": [...] }
}
```

---

#### `POST /api/v1/guides/:guideId/clusters`

Crée un cluster manuellement.

**Body :**
```json
{ "cluster_name": "Nouveau cluster" }
```

---

#### `DELETE /api/v1/guides/:guideId/clusters/:clusterId`

Supprime un cluster et réaffecte ses POIs à "non affecté".

---

#### `PATCH /api/v1/guides/:guideId/clusters/:clusterId`

Renomme un cluster et met à jour `cluster_name` sur tous ses POIs.

**Body :**
```json
{ "cluster_name": "Nouveau nom" }
```

---

## Flux typiques

### Flux complet d'ingestion + détection POI

```
1. POST /api/v1/ingest/enqueue          → jobId
   GET  /api/v1/ingest/status/:jobId    → polling jusqu'à "completed"

2. POST /api/v1/guides/:id/pois/generate  → jobId
   GET  /api/v1/guides/:id/pois/job-status/:jobId
       → polling jusqu'à "extraction_complete"

3. POST /api/v1/guides/:id/pois/jobs/:jobId/deduplicate
   GET  /api/v1/guides/:id/pois/job-status/:jobId
       → polling jusqu'à "dedup_complete"

4. POST /api/v1/guides/:id/matching/generate  → résultat immédiat
```

### Ingestion d'un article manquant

```
POST /api/v1/ingest/single-url
  { "articleUrl": "https://mon-site.fr/mon-article/" }
→ article ajouté / mis à jour en base, URLs de traduction résolues
```

---

## Architecture interne

```
apps/ingestion-service/
├── src/
│   ├── index.ts               Point d'entrée (bootstrap)
│   ├── server.ts              Fastify + auth middleware X-Api-Key
│   ├── config/
│   │   ├── env.ts             Validation des variables d'environnement (Zod)
│   │   ├── collections.ts     Noms des collections MongoDB
│   │   └── database.ts        Connexion MongoDB (singleton)
│   ├── routes/
│   │   ├── ingest.routes.ts   Routes /ingest/*
│   │   ├── pois.routes.ts     Routes /guides/:id/pois/* + /workers/generate-pois + /workers/deduplicate-pois
│   │   └── matching.routes.ts Routes /guides/:id/matching/* + /guides/:id/clusters/*
│   └── services/
│       ├── cluster-matching.service.ts  Algorithme Levenshtein + auto-assign
│       └── openai.service.ts            Wrapper OpenAI (Chat Completions + Responses API)
```

### Dépendances clés

| Package | Rôle |
|---|---|
| `fastify` | Framework HTTP |
| `mongodb` | Driver MongoDB natif |
| `@redactor-guide/ingestion-wp` | Logique d'ingestion WP (package workspace partagé) |
| `openai` | SDK officiel OpenAI |
| `zod` | Validation des schemas et variables d'environnement |

### Modèle de données MongoDB

| Collection | Contenu |
|---|---|
| `articles_raw` | Articles WordPress ingérés (markdown, images, URLs par langue) |
| `ingest_jobs` | Jobs d'ingestion asynchrones |
| `pois_generation_jobs` | Jobs d'extraction et déduplication POI |
| `pois_selection` | POIs confirmés pour un guide |
| `cluster_assignments` | Résultat du matching POI ↔ clusters |
| `guides` | Métadonnées des guides (destination, destination_rl_id…) |
| `prompts` | Prompts IA utilisés par l'extraction et la déduplication |
