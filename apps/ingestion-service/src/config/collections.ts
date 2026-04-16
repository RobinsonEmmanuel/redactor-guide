export const COLLECTIONS = {
  articles_raw:     'articles_raw',
  ingest_jobs:      'ingest_jobs',
  prompts:          'prompts',
  site_connections: 'site_connections',
  sites:            'sites',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
