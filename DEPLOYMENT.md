# Déploiement sur Vercel

## 🚀 Prérequis

1. Compte Vercel (gratuit) : https://vercel.com
2. CLI Vercel : `npm install -g vercel`

## 📦 Déploiement

### Option 1 : Via le Dashboard Vercel (Recommandé)

#### 1. Connecter le repository

1. Allez sur https://vercel.com/new
2. Importez votre repository GitHub/GitLab
3. Sélectionnez `redactor-guide`

#### 2. Configurer le projet Web (Next.js)

**Project Name:** `redactor-guide-web`

**Framework Preset:** Next.js

**Root Directory:** `apps/web`

**Build Command:**
```bash
cd ../.. && npm install && npm run build --workspace=apps/web
```

**Install Command:**
```bash
npm install
```

**Output Directory:** `.next`

#### 3. Variables d'environnement (Web)

Ajoutez dans Settings → Environment Variables :

```
NEXT_PUBLIC_API_URL=https://redactor-guide-api.vercel.app
```

#### 4. Configurer le projet API

Créez un nouveau projet pour l'API :

**Project Name:** `redactor-guide-api`

**Framework Preset:** Other

**Root Directory:** `apps/api`

**Build Command:**
```bash
cd ../.. && npm install && npm run build --workspace=apps/api
```

**Output Directory:** `dist`

#### 5. Variables d'environnement (API)

Ajoutez dans Settings → Environment Variables :

```
NODE_ENV=production
MONGODB_URI=mongodb+srv://travmatter:MlojoS4FzEb4Ob7u@internalrl.pqxqt94.mongodb.net/?retryWrites=true&w=majority&appName=InternalRL
MONGODB_DB_NAME=redactor_guide
```

### Option 2 : Via la CLI

#### 1. Installer Vercel CLI

```bash
npm install -g vercel
```

#### 2. Se connecter

```bash
vercel login
```

#### 3. Déployer l'API

```bash
cd apps/api
vercel --prod
```

Suivez les instructions et configurez :
- Project name: `redactor-guide-api`
- Ajoutez les variables d'environnement quand demandé

#### 4. Déployer le Web

```bash
cd ../web
vercel --prod
```

Configurez :
- Project name: `redactor-guide-web`
- Ajoutez `NEXT_PUBLIC_API_URL` avec l'URL de l'API déployée

## ⚙️ Configuration post-déploiement

### 1. Mettre à jour l'URL de l'API dans le frontend

Une fois l'API déployée, vous aurez une URL type :
```
https://redactor-guide-api.vercel.app
```

Mettez à jour les fichiers du frontend :

**apps/web/components/GuidesList.tsx** et **GuideForm.tsx** :

Remplacez `http://localhost:3000` par votre URL Vercel.

Ou mieux, créez un fichier de configuration :

**apps/web/lib/config.ts**
```typescript
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
```

Et utilisez-le partout :
```typescript
import { API_URL } from '@/lib/config';

const response = await fetch(`${API_URL}/api/v1/guides`);
```

### 2. Configurer CORS dans l'API

Mettez à jour **apps/api/src/server.ts** :

```typescript
await fastify.register(import('@fastify/cors'), {
  origin: [
    'https://redactor-guide-web.vercel.app',
    'http://localhost:3001', // Pour le dev local
  ],
});
```

## 🔄 Redéploiement

### Automatique (GitHub)

Chaque push sur `main` redéploiera automatiquement.

### Manuel

```bash
# API
cd apps/api
vercel --prod

# Web
cd apps/web
vercel --prod
```

## 🐛 Dépannage

### L'API ne se connecte pas à MongoDB

Vérifiez que :
1. Les variables d'environnement sont bien configurées dans Vercel
2. L'IP de Vercel est autorisée dans MongoDB Atlas (Network Access)
   - Ajoutez `0.0.0.0/0` pour autoriser toutes les IPs

### L'interface ne se connecte pas à l'API

1. Vérifiez `NEXT_PUBLIC_API_URL` dans les variables d'environnement
2. Vérifiez CORS dans l'API
3. Regardez les logs dans Vercel Dashboard

### Erreur de build

1. Vérifiez que toutes les dépendances sont dans `package.json`
2. Vérifiez les logs de build dans Vercel Dashboard
3. Testez le build localement : `npm run build`

## 📊 Monitoring

- **Logs** : Vercel Dashboard → Deployment → Logs
- **Analytics** : Vercel Dashboard → Analytics
- **Erreurs** : Vercel Dashboard → Error Tracking

## 💰 Limites du plan gratuit

- 100 GB bandwidth / mois
- 100 GB-heures compute / mois
- Pas de limite de déploiements

Pour un usage intensif, considérez le plan Pro ($20/mois).

## 🎯 URLs finales

Après déploiement, vous aurez :

- **API** : `https://redactor-guide-api.vercel.app`
- **Interface** : `https://redactor-guide-web.vercel.app`

Vous pouvez aussi configurer des domaines personnalisés !
