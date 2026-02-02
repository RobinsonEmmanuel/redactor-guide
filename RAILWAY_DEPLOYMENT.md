# 🚂 Déploiement sur Railway

Guide complet pour déployer Redactor Guide sur Railway.

## 🎯 Prérequis

1. Compte Railway (gratuit) : https://railway.app
2. Repository Git (GitHub, GitLab, ou Bitbucket)

## 🚀 Déploiement en 5 minutes

### Étape 1 : Préparer le repository

```bash
# Vérifier que tout est commité
git status

# Si nécessaire, commiter les fichiers
git add .
git commit -m "Prêt pour Railway"
git push origin main
```

### Étape 2 : Créer le projet sur Railway

1. **Allez sur https://railway.app**
2. **Cliquez sur "New Project"**
3. **Choisissez "Deploy from GitHub repo"**
4. **Sélectionnez votre repository** `redactor-guide`
5. **Railway détectera automatiquement** votre projet Node.js

### Étape 3 : Configurer les variables d'environnement

Dans le Dashboard Railway, allez dans **Variables** et ajoutez :

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://travmatter:MlojoS4FzEb4Ob7u@internalrl.pqxqt94.mongodb.net/?retryWrites=true&w=majority&appName=InternalRL
MONGODB_DB_NAME=redactor_guide
```

### Étape 4 : Déployer !

Railway déploiera automatiquement votre projet.

Vous verrez :
```
✓ Building...
✓ Deploying...
✓ Live!
```

### Étape 5 : Obtenir l'URL

1. Cliquez sur votre service
2. Allez dans **Settings**
3. Sous **Networking**, cliquez sur **Generate Domain**
4. Vous obtiendrez une URL type : `https://redactor-guide-production.up.railway.app`

## 🌐 Déployer l'Interface Web (Option 1 : Même projet)

### Ajouter un service Web

1. Dans votre projet Railway, cliquez **New Service**
2. Choisissez **From GitHub repo** (même repo)
3. Nommez-le `redactor-guide-web`

### Configurer le service Web

**Variables d'environnement :**
```env
NEXT_PUBLIC_API_URL=https://[VOTRE-URL-API].up.railway.app
```

**Settings → Start Command:**
```bash
cd apps/web && npm run build && npm run start
```

**Settings → Root Directory:**
```
apps/web
```

### Générer le domaine

Comme pour l'API, générez un domaine public.

## 🌐 Déployer l'Interface Web (Option 2 : Vercel pour le frontend)

Si vous préférez garder le frontend sur Vercel :

1. Déployez seulement l'API sur Railway
2. Déployez le frontend sur Vercel
3. Configurez `NEXT_PUBLIC_API_URL` dans Vercel avec l'URL Railway de l'API

## ⚙️ Configuration avancée

### Custom Domain

1. Allez dans **Settings → Networking**
2. Cliquez sur **Custom Domain**
3. Ajoutez votre domaine : `api.monsite.com`
4. Configurez le DNS selon les instructions

### Scaling

Railway scale automatiquement, mais vous pouvez :
1. **Settings → Resources** : Ajuster RAM/CPU
2. **Settings → Replicas** : Ajouter des instances

### Monitoring

- **Metrics** : CPU, RAM, Network usage
- **Logs** : Logs en temps réel
- **Deployments** : Historique des déploiements

## 🔄 Redéploiement automatique

Railway redéploie automatiquement à chaque push sur `main` :

```bash
git add .
git commit -m "Mise à jour"
git push origin main
```

Railway rebuildera et redéploiera automatiquement ! 🎉

## 🛠️ Commandes utiles

### Voir les logs

Dans le Dashboard → **Deployments** → Cliquez sur le dernier déploiement

Ou via CLI :
```bash
railway logs
```

### Rollback

Dans **Deployments**, cliquez sur une ancienne version et **Redeploy**.

### Variables locales vs Production

**Local (.env) :**
```env
MONGODB_URI=mongodb://localhost:27017  # MongoDB local
```

**Production (Railway) :**
```env
MONGODB_URI=mongodb+srv://...  # MongoDB Atlas
```

## 🐛 Dépannage

### Erreur de build

**Problème** : `npm install` échoue

**Solution** :
```bash
# Localement, vérifiez que tout build
npm run build

# Committez le package-lock.json
git add package-lock.json
git commit -m "Fix package-lock"
git push
```

### Connexion MongoDB échoue

**Problème** : Cannot connect to MongoDB

**Solutions** :
1. Vérifiez `MONGODB_URI` dans Railway Variables
2. Dans MongoDB Atlas → **Network Access** :
   - Ajoutez `0.0.0.0/0` (toutes IPs)
3. Vérifiez que le nom d'utilisateur/mot de passe est correct

### Port déjà utilisé

Railway gère le port automatiquement via `process.env.PORT`.

Notre code utilise déjà :
```typescript
const port = env.PORT; // Lit PORT depuis l'environnement
```

### L'API fonctionne mais le frontend ne se connecte pas

**Vérifiez** :
1. `NEXT_PUBLIC_API_URL` est bien défini
2. CORS est configuré dans l'API pour autoriser l'URL du frontend
3. L'URL de l'API est bien en HTTPS

## 💰 Coûts

### Plan Gratuit
- $5 de crédit/mois
- Suffisant pour débuter
- Hiberne après inactivité

### Plan Developer ($5/mois)
- $5 + usage
- Pas d'hibernation
- Meilleur pour production

### Estimation pour votre projet
- API seule : ~$3-5/mois
- API + Frontend : ~$8-12/mois

## 📊 Après le déploiement

Votre stack sera :

```
Frontend (Next.js)         →  Railway ou Vercel
    ↓
API (Fastify)             →  Railway
    ↓
MongoDB                   →  MongoDB Atlas
```

URLs :
- **API** : `https://redactor-guide-api-xxx.up.railway.app`
- **Frontend** : `https://redactor-guide-web-xxx.up.railway.app`

## ✅ Checklist finale

- [ ] Code commité et pushé sur GitHub
- [ ] Projet créé sur Railway
- [ ] Variables d'environnement configurées
- [ ] MongoDB Atlas accessible (0.0.0.0/0 dans Network Access)
- [ ] Domaine généré sur Railway
- [ ] Frontend configuré avec la bonne API URL
- [ ] CORS configuré dans l'API
- [ ] Test de l'API : `https://[URL]/health`
- [ ] Test du frontend
- [ ] Création d'un guide de test

## 🎉 Vous êtes prêt !

Railway est parfait pour votre projet car :
- ✅ Setup ultra-rapide
- ✅ Redéploiement automatique
- ✅ Logs en temps réel
- ✅ Scaling automatique
- ✅ Excellent support MongoDB

**Besoin d'aide ?** Je suis là ! 🚀
