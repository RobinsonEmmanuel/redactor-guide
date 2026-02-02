# Informations de déploiement Redactor Guide

## Architecture

Le projet est un monorepo contenant :
- **Frontend** : Next.js (`apps/web`) - Interface utilisateur avec authentification
- **Backend** : Fastify (`apps/api`) - API REST pour la gestion des guides

## Configuration Railway actuelle

### Service déployé : Frontend Next.js

**URL** : `redactor-guide-production.up.railway.app`

Le frontend Next.js inclut :
- Pages d'interface (`/`, `/login`)
- Routes API Next.js (`/api/auth/login`) pour proxy sécurisé vers Region Lovers API

### Variables d'environnement requises

```env
# MongoDB
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=redactor_guide

# Region Lovers API
API_REGION_LOVERS=your-api-key

# Next.js (optionnel)
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Commandes de déploiement

- **Build** : `npm run build` (Turbo build tous les packages)
- **Start** : `npm run start --workspace=apps/web` (Lance Next.js)

## Notes

- Le frontend écoute sur `$PORT` (défini par Railway)
- L'API Fastify n'est pas déployée séparément actuellement
- Les routes API Next.js servent de proxy pour l'authentification Region Lovers
