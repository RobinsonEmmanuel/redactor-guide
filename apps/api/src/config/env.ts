import { z } from 'zod';
import dotenv from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';

// Chercher le fichier .env en remontant dans l'arborescence
function findEnvFile(): string | undefined {
  let currentDir = process.cwd();
  
  // Essayer jusqu'à 5 niveaux parents
  for (let i = 0; i < 5; i++) {
    const envPath = join(currentDir, '.env');
    if (existsSync(envPath)) {
      return envPath;
    }
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break; // Racine du système
    currentDir = parentDir;
  }
  
  return undefined;
}

// Charger les variables d'environnement
const envPath = findEnvFile();
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback sur le comportement par défaut
}

/** Accepte `https://host` ou un simple `host` (préfixe https:// ajouté) pour les URLs de microservices. */
function normalizeOptionalServiceUrl(val: string | undefined): string | undefined {
  if (val === undefined || val.trim() === '') return undefined;
  const trimmed = val.trim().replace(/\/$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withScheme);
  } catch {
    throw new Error(`URL de microservice invalide: ${val}`);
  }
  return withScheme;
}

/**
 * Schema de validation des variables d'environnement
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('3000'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI est requis'),
  MONGODB_DB_NAME: z.string().min(1, 'MONGODB_DB_NAME est requis'),
  /** Token Upstash QStash pour publier des jobs (optionnel ; si absent, POST /ingest/enqueue renverra 503) */
  QSTASH_TOKEN: z.string().optional(),
  /** URL publique de l'API (ex. https://xxx.railway.app) pour que QStash appelle POST /ingest/run */
  INGEST_WORKER_URL: z.string().optional(),
  /** Clé API OpenAI pour génération contenu et analyse images (optionnel en dev) */
  OPENAI_API_KEY: z.string().optional(),
  /** URL API Region Lovers (par défaut: https://api-prod.regionlovers.ai) */
  REGION_LOVERS_API_URL: z.string().optional(),
  /** URL du microservice d'ingestion (ex: http://localhost:4001 ou host Railway sans schéma) */
  INGESTION_SERVICE_URL: z
    .string()
    .optional()
    .transform((v) => normalizeOptionalServiceUrl(v)),
  /** Clé API pour s'authentifier auprès du microservice d'ingestion */
  INGESTION_SERVICE_API_KEY: z.string().optional(),
  /** URL du microservice POI (ex: http://localhost:4002 ; sur Railway inclure https:// ou seulement le hostname) */
  POI_SERVICE_URL: z
    .string()
    .optional()
    .transform((v) => normalizeOptionalServiceUrl(v)),
  /** Clé API pour s'authentifier auprès du microservice POI */
  POI_SERVICE_API_KEY: z.string().optional(),
});

/**
 * Variables d'environnement validées
 */
export const env = EnvSchema.parse(process.env);

export type Env = z.infer<typeof EnvSchema>;
