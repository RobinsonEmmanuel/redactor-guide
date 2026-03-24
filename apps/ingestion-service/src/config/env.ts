import { z } from 'zod';
import dotenv from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';

function findEnvFile(): string | undefined {
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = join(currentDir, '.env');
    if (existsSync(envPath)) return envPath;
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return undefined;
}

const envPath = findEnvFile();
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('4001'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI est requis'),
  MONGODB_DB_NAME: z.string().min(1, 'MONGODB_DB_NAME est requis'),
  /** Clé secrète pour authentifier les appels entrants via X-Api-Key */
  API_KEY_SECRET: z.string().optional(),
  /** Token QStash pour publier des jobs asynchrones */
  QSTASH_TOKEN: z.string().optional(),
  /** URL publique de ce service (utilisée par QStash pour les callbacks worker) */
  INGEST_WORKER_URL: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
