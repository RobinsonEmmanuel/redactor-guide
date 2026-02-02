# Ingestion WordPress : worker + queue (production)

Pour **~272 articles × 9 langues**, l'ingestion peut dépasser les limites de temps des plateformes :

- **Vercel Pro** : timeout ~60 s (fonctions serverless)
- **Railway** : requête HTTP peut expirer (souvent 5 min) si l'ingestion dure longtemps

## Recommandation : worker + queue

1. **Upstash QStash** : file de jobs HTTP (publish → QStash appelle une URL avec le payload).
2. **Worker sur Railway** : service dédié qui expose une route reçue par QStash et exécute `WordPressIngestionService.ingestArticlesToRaw`.

### Flux proposé

```
[Front Vercel]  →  POST /ingest/enqueue (API Railway)
                        ↓
                  API enregistre un job dans QStash (payload: siteId, destinationIds, siteUrl, jwtToken)
                  et renvoie 202 Accepted + jobId
                        ↓
[QStash]        →  POST <WORKER_URL>/ingest/run  (payload + messageId)
                        ↓
[Worker Railway]   exécute ingestArticlesToRaw, met à jour le statut (MongoDB ou Redis)
                        ↓
[Front]          polling GET /ingest/status/:jobId  →  quand "completed", activer « Créer le guide »
```

### Implémentation actuelle

- **Sans queue** : `POST /ingest` exécute l'ingestion de façon synchrone. Adapté aux petits volumes ou aux tests. Pour 272 articles, le risque de timeout est élevé.
- **Avec queue** : à ajouter (Upstash QStash + worker Railway) pour la production avec gros volumes.

---

## 1. Upstash QStash

### Créer un projet QStash

1. Aller sur [Upstash Console](https://console.upstash.com/).
2. Créer un compte ou se connecter.
3. Créer un projet (ou utiliser un existant) et activer **QStash**.
4. Dans QStash, récupérer :
   - **QSTASH_TOKEN** (pour publier des messages depuis l'API Railway).
   - Optionnel : **QSTASH_CURRENT_SIGNING_KEY** / **QSTASH_NEXT_SIGNING_KEY** pour vérifier les webhooks côté worker.

### Publier un job (depuis l'API Railway)

QStash fonctionne en « push » : vous envoyez un message à QStash avec l'URL à appeler ; QStash fait ensuite un POST vers cette URL avec le body que vous avez fourni.

Exemple depuis l'API (route `POST /ingest/enqueue`) :

```ts
// Pseudocode pour enqueue
const jobId = randomUUID();
await fetch('https://qstash.upstash.io/v2/publish/' + encodeURIComponent(WORKER_URL + '/ingest/run'), {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
    'Content-Type': 'application/json',
    'Upstash-Callback': API_BASE_URL + '/ingest/callback?jobId=' + jobId,  // optionnel
    'Upstash-Retries': '3',
  },
  body: JSON.stringify({
    jobId,
    siteId: body.siteId,
    destinationIds: body.destinationIds,
    siteUrl: body.siteUrl,
    jwtToken: body.jwtToken,
  }),
});
// Enregistrer jobId en base (collection ingest_jobs) avec status: 'queued'
return reply.status(202).send({ jobId, status: 'queued' });
```

- **WORKER_URL** : URL publique du worker sur Railway (ex. `https://votre-worker.up.railway.app`).
- **Callback** : si vous configurez `Upstash-Callback`, QStash enverra le résultat (succès/échec) à votre API pour mettre à jour le statut sans polling.

---

## 2. Worker sur Railway

### Option A : même projet API, route dédiée

Vous pouvez exposer une route **sur l'API Railway existante** que QStash appellera (ex. `POST /ingest/run`). Cette route reçoit le body (jobId, siteId, destinationIds, siteUrl, jwtToken), appelle `ingestArticlesToRaw`, puis met à jour le statut du job en base.

- **Avantage** : un seul déploiement, réutilisation du même MongoDB et du même DI.
- **Inconvénient** : si l'exécution dépasse le timeout HTTP de Railway, la requête peut être coupée. Pour 272 articles, il peut falloir augmenter le timeout ou utiliser un worker séparé sans timeout court.

### Option B : service Worker séparé sur Railway

Créer un second service sur Railway (même repo ou repo dédié) qui :

1. Expose une seule route : `POST /ingest/run`.
2. Reçoit le payload envoyé par QStash (jobId, siteId, destinationIds, siteUrl, jwtToken).
3. Se connecte au **même MongoDB** que l'API (variable `MONGODB_URI`).
4. Instancie `WordPressIngestionService` et appelle `ingestArticlesToRaw`.
5. Met à jour le statut du job (collection `ingest_jobs`) : `processing` → `completed` ou `failed`.

Variables d'environnement du worker : `MONGODB_URI`, `MONGODB_DB_NAME`, et éventuellement `QSTASH_CURRENT_SIGNING_KEY` pour vérifier la signature QStash.

### Vérification de signature QStash (recommandé)

Pour que le worker n'exécute que les requêtes vraiment envoyées par QStash, vérifier les headers de signature. Voir [Upstash - Verifying signatures](https://upstash.com/docs/qstash/security/verifying).

---

## 3. Statut des jobs (polling ou callback)

### Collection MongoDB `ingest_jobs`

Exemple de document :

```ts
{
  _id: ObjectId,
  jobId: string,        // UUID renvoyé au front
  siteId: string,
  status: 'queued' | 'processing' | 'completed' | 'failed',
  createdAt: Date,
  updatedAt: Date,
  result?: { count: number; errors?: string[] },
  error?: string,
}
```

- Lors de l'enqueue : créer le document avec `status: 'queued'`.
- Lors du démarrage du worker : passer à `processing`.
- À la fin : `completed` + `result` ou `failed` + `error`.

### Route API pour le front

- **GET /ingest/status/:jobId** : lit le document dans `ingest_jobs` et renvoie `{ status, result?, error? }`. Le front peut poller toutes les 2–5 s jusqu'à `completed` ou `failed`.

### Callback QStash (optionnel)

Si vous avez configuré `Upstash-Callback`, QStash enverra un POST à votre API avec le résultat. Vous pourrez alors mettre à jour `ingest_jobs` sans attendre que le worker appelle lui-même l'API (utile si le worker est dans un autre service).

---

## 4. Variables d'environnement

| Variable | Où | Description |
|----------|-----|-------------|
| `QSTASH_TOKEN` | API Railway | Token pour publier des messages vers QStash |
| `WORKER_URL` ou `INGEST_WORKER_URL` | API Railway | URL du worker (ex. `https://xxx.railway.app`) pour construire l'URL de publish QStash |
| `MONGODB_URI` | API + Worker | URI MongoDB (même base pour jobs + articles_raw) |
| `MONGODB_DB_NAME` | API + Worker | Nom de la base |
| `QSTASH_CURRENT_SIGNING_KEY` | Worker | Clé pour vérifier la signature des requêtes QStash |

---

## 5. Résumé des ajouts à prévoir

1. **API (Railway)**
   - Route **POST /ingest/enqueue** : valide le body (siteId, destinationIds, siteUrl, jwtToken), génère un `jobId`, enregistre un job en `ingest_jobs` (status `queued`), publie le message à QStash vers `WORKER_URL/ingest/run`, renvoie **202** + `jobId`.
   - Route **GET /ingest/status/:jobId** : renvoie le statut du job depuis `ingest_jobs`.

2. **Worker (Railway)**
   - Route **POST /ingest/run** : vérifie la signature QStash (optionnel mais recommandé), met le job en `processing`, appelle `WordPressIngestionService.ingestArticlesToRaw`, met à jour le job en `completed` ou `failed`.

3. **Front (Vercel)**
   - Au lieu d'appeler directement `POST /ingest`, appeler **POST /ingest/enqueue**.
   - Afficher « Récupération en cours » et faire un polling sur **GET /ingest/status/:jobId**.
   - Quand `status === 'completed'`, activer le bouton « Créer le guide » (et éventuellement afficher le nombre d'articles ingérés).

---

## Références

- [Upstash QStash - Publish](https://upstash.com/docs/qstash/howto/publishing)
- [Upstash QStash - Verifying signatures](https://upstash.com/docs/qstash/security/verifying)
- [Railway - Deploy a worker](https://docs.railway.app/)
