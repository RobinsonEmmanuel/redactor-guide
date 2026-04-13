FROM node:20-alpine AS base
WORKDIR /app

# ── Dépendances ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/ingestion-service/package.json ./apps/ingestion-service/
COPY apps/web/package.json ./apps/web/
COPY packages/ai-services/package.json ./packages/ai-services/
COPY packages/core-model/package.json ./packages/core-model/
COPY packages/exporters/package.json ./packages/exporters/
COPY packages/guide-builder/package.json ./packages/guide-builder/
COPY packages/ingestion-wp/package.json ./packages/ingestion-wp/
COPY packages/validators/package.json ./packages/validators/
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npx turbo run build --filter=@redactor-guide/api...

# ── Image finale ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copier uniquement ce dont le runtime a besoin
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
