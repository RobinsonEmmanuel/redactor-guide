export const COLLECTIONS = {
  articles_raw: 'articles_raw',
  ingest_jobs:  'ingest_jobs',
  prompts:      'prompts',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
