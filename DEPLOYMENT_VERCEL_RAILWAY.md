# Déploiement Vercel + Railway

Architecture en deux services :
- **Frontend Next.js** → Vercel
- **Backend API Fastify** → Railway

## 🚀 1. Déploiement Railway (API Backend)

### Configuration actuelle
Railway est déjà configuré et déploie l'API Fastify automatiquement.

### Variables d'environnement Railway

Dans le dashboard Railway, configurez :

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=redactor_guide
NODE_ENV=production
PORT=3000
API_REGION_LOVERS=votre-clé-api
```

### URL de l'API
Notez l'URL générée par Railway :
```
https://redactor-guide-production.up.railway.app
```

✅ **L'API est déjà déployée sur Railway**

## 🎨 2. Déploiement Vercel (Frontend)

### Étape 1 : Connecter le projet à Vercel

1. Allez sur [vercel.com](https://vercel.com)
2. Cliquez sur **"New Project"**
3. Importez le repository GitHub : `RobinsonEmmanuel/redactor-guide`
4. Vercel détectera automatiquement Next.js

### Étape 2 : Configuration du projet

**Root Directory** : Laissez vide (Vercel utilisera `vercel.json`)

**Build Command** :
```bash
cd apps/web && npm install && npm run build
```

**Output Directory** :
```
apps/web/.next
```

**Install Command** :
```bash
npm install
```

### Étape 3 : Variables d'environnement Vercel

Dans **Project Settings** → **Environment Variables**, ajoutez :

```env
# URL de l'API Railway
NEXT_PUBLIC_API_URL=https://redactor-guide-production.up.railway.app

# Clé API Region Lovers
API_REGION_LOVERS=votre-clé-api-region-lovers
```

**Important** : Ajoutez ces variables pour tous les environnements :
- ✅ Production
- ✅ Preview
- ✅ Development

### Étape 4 : Déployer

Cliquez sur **"Deploy"** !

Vercel va :
1. ✅ Installer les dépendances
2. ✅ Builder Next.js
3. ✅ Déployer sur le CDN global
4. ✅ Générer une URL (ex: `redactor-guide.vercel.app`)

## 🔗 3. URLs finales

Une fois déployé, vous aurez :

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | `https://redactor-guide.vercel.app` | Interface utilisateur |
| **API Backend** | `https://redactor-guide-production.up.railway.app` | API REST + MongoDB |

## 🔐 4. Test de connexion

1. Allez sur `https://redactor-guide.vercel.app`
2. Vous serez redirigé vers `/login`
3. Connectez-vous avec :
   - Email : `manu@regionlovers.fr`
   - Password : `emmanuel123`
4. Accédez à l'interface de gestion des guides

## 🛠 5. CORS Configuration

L'API Railway accepte les requêtes de :
- ✅ `http://localhost:3001` (dev local)
- ✅ `https://*.vercel.app` (tous les domaines Vercel)

Si vous utilisez un domaine custom sur Vercel, ajoutez-le dans `apps/api/src/server.ts` :

```typescript
origin: [
  'http://localhost:3001',
  'https://*.vercel.app',
  'https://votre-domaine-custom.com', // Ajoutez ici
],
```

## 🔄 6. Déploiements automatiques

- **Vercel** : Se redéploie automatiquement à chaque push sur `main`
- **Railway** : Se redéploie automatiquement à chaque push sur `main`

## 📊 7. Monitoring

**Vercel Dashboard** :
- Logs de déploiement
- Analytics
- Performance metrics

**Railway Dashboard** :
- Logs du serveur API
- Métriques de performance
- Utilisation des ressources

## 🐛 8. Troubleshooting

### Frontend ne charge pas les guides
- Vérifiez `NEXT_PUBLIC_API_URL` dans Vercel
- Vérifiez les logs Vercel
- Testez l'API directement : `https://redactor-guide-production.up.railway.app/health`

### Erreur CORS
- Vérifiez que le domaine Vercel est dans la config CORS de l'API
- Redéployez l'API après modification

### Erreur d'authentification
- Vérifiez `API_REGION_LOVERS` dans Vercel
- Testez l'endpoint : `/api/auth/login`

## 🎉 Prochaines étapes

Une fois déployé avec succès :
1. ✅ Configurez un domaine custom (optionnel)
2. ✅ Activez les logs automatiques
3. ✅ Configurez les alertes de monitoring
4. ✅ Testez toutes les fonctionnalités

---

**Architecture finale** :

```
┌─────────────────────────────┐
│      Utilisateur            │
└──────────┬──────────────────┘
           │
           ↓
┌─────────────────────────────┐
│  Vercel (Frontend)          │
│  - Next.js                  │
│  - Pages /login, /          │
│  - API Routes /api/auth/*   │
└──────────┬──────────────────┘
           │
           │ API Calls
           │ HTTPS + CORS
           ↓
┌─────────────────────────────┐
│  Railway (Backend)          │
│  - Fastify API              │
│  - MongoDB Connection       │
│  - Services (WP, AI, etc)   │
└─────────────────────────────┘
```
