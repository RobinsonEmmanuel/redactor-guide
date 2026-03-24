export const COLLECTIONS = {
  articles_raw:           'articles_raw',
  cluster_assignments:    'cluster_assignments',
  guides:                 'guides',
  image_analyses:         'image_analyses',
  ingest_jobs:            'ingest_jobs',
  pois_generation_jobs:   'pois_generation_jobs',
  pois_selection:         'pois_selection',
  prompts:                'prompts',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
