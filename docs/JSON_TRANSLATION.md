# JSON Translation Tool - Documentation

## Vue d'ensemble

L'outil de traduction JSON permet de traduire automatiquement tous les champs `value` d'un fichier JSON du français vers l'anglais, en utilisant ChatGPT 4o-mini.

## Fonctionnalités

### 1. Traduction des strings simples ✅

```json
{
  "field_id": "name",
  "value": "Musée du Monde des Arts de la Parure"
}
```

→ Traduit en : `"Museum of the World of Adornment Arts"`

---

### 2. Traduction des arrays de strings ✅

```json
{
  "field_id": "price_reduced_fee",
  "value": [
    "Citoyen marocain : 70 MAD",
    "Étudiant : 50 MAD"
  ]
}
```

→ Traduit en :
```json
{
  "field_id": "price_reduced_fee",
  "value": [
    "Moroccan citizen: 70 MAD",
    "Student: 50 MAD"
  ]
}
```

---

### 3. Skip automatique des URLs ✅

Les URLs ne sont **jamais traduites**, qu'elles soient :

**En string simple :**
```json
{
  "field_id": "website",
  "value": "https://lemapmarrakech.com/"
}
```
→ **Reste inchangé**

**Dans un array :**
```json
{
  "field_id": "website_collections",
  "value": [
    "https://www.lemapmarrakech.com/visite",
    "https://www.lemapmarrakech.com/lieu"
  ]
}
```
→ **Reste inchangé**

---

### 4. Gestion des arrays d'objets ✅

Les objets dans les arrays sont **traversés récursivement** pour extraire et traduire leurs strings :

```json
{
  "field_id": "kid_play_area",
  "value": [
    {
      "kid_play_area_location": "Au jardin",
      "kid_play_area_age_group": "3-10 ans",
      "kid_play_area_description": "Espace de jeux sécurisé"
    }
  ]
}
```

→ Traduit en :
```json
{
  "field_id": "kid_play_area",
  "value": [
    {
      "kid_play_area_location": "In the garden",
      "kid_play_area_age_group": "3-10 years",
      "kid_play_area_description": "Secure play area"
    }
  ]
}
```

---

## Logique de détection des URLs

Une chaîne est considérée comme URL si elle :
- Commence par `http://` ou `https://`
- Commence par `www.`

**Exemples :**
- ✅ `"https://example.com"` → Skip
- ✅ `"http://example.com"` → Skip
- ✅ `"www.example.com"` → Skip
- ❌ `"Musée de Paris"` → Traduit

---

## Traitement par batch

- **Taille des batchs** : 30 champs à la fois
- **Modèle** : GPT-4o-mini
- **Max tokens** : 2000 par batch
- **Retry** : Jusqu'à 3 tentatives en cas d'erreur
- **Backoff** : Exponentiel (1s, 2s, 3s)

---

## Statistiques fournies

Après traduction, tu reçois :
```json
{
  "success": true,
  "output_json": {...},
  "stats": {
    "totalFields": 268,
    "translatedFields": 268,
    "errors": 0,
    "retries": 2
  }
}
```

---

## Cas non gérés

### Champs `value` avec des types complexes

Si `value` contient autre chose que `string`, `array` ou `object`, il est ignoré :

```json
{
  "field_id": "geo_lat",
  "value": 31.622522
}
```
→ **Reste inchangé** (nombre)

```json
{
  "field_id": "parking_existence",
  "value": true
}
```
→ **Reste inchangé** (booléen)

---

## Utilisation

### 1. Upload du JSON

Accède à `/translator` et upload ton fichier JSON source.

### 2. Lancement de la traduction

Clique sur "Traduire" pour lancer le job asynchrone via QStash.

### 3. Suivi en temps réel

Le frontend affiche :
- ⏳ Statut du job (`processing`, `completed`, `failed`)
- 📊 Statistiques de progression
- 🔄 Mise à jour toutes les 2 secondes

### 4. Téléchargement du résultat

Une fois terminé, clique sur "Télécharger le JSON traduit".

---

## Architecture technique

```
Frontend (/translator)
    ↓
POST /translator/translate
    ↓
MongoDB (jobs collection)
    ↓
QStash Worker (/workers/translate-json)
    ↓
JsonTranslatorService
    ↓
ChatGPT 4o-mini (batches de 30 champs)
    ↓
MongoDB (mise à jour du job)
    ↓
GET /translator/status/:jobId (polling frontend)
    ↓
GET /translator/result/:jobId (téléchargement)
```

---

## Améliorations futures possibles

- [ ] Support de plus de langues (FR → ES, FR → DE, etc.)
- [ ] Détection de noms propres (pour skip)
- [ ] Support de formats de date (skip automatique)
- [ ] Traduction de clés spécifiques (pas seulement `value`)
- [ ] Interface pour comparer avant/après
- [ ] Export en CSV pour validation manuelle

---

## Exemples réels

### Avant traduction
```json
{
  "field_id": "museum_experience_general_review_description",
  "value": "Un des plus beaux musées de Marrakech selon moi, à la fois du fait de la beauté du lieu, de la mise en scène mais aussi de la collection."
}
```

### Après traduction
```json
{
  "field_id": "museum_experience_general_review_description",
  "value": "One of the most beautiful museums in Marrakech in my opinion, both because of the beauty of the place, the staging and also the collection."
}
```

---

## Logs et debugging

Les logs côté worker incluent :
- `✅ Batch X traduit` : Succès
- `❌ Erreur batch X` : Échec
- `🔄 Cache hit` : Détection de doublons (si implémenté)
- `📊 Traduction terminée` : Statistiques finales
