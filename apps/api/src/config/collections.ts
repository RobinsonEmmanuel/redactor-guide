/**
 * Noms des collections MongoDB.
 * Centralise les magic strings pour éviter les fautes de frappe
 * et faciliter les renommages futurs.
 */
export const COLLECTIONS = {
  articles_raw:           'articles_raw',
  chemins_de_fer:         'chemins_de_fer',
  cluster_assignments:    'cluster_assignments',
  destinations:           'destinations',
  field_services:         'field_services',
  guide_templates:        'guide_templates',
  guide_translation_jobs: 'guide_translation_jobs',
  guides:                 'guides',
  image_analyses:         'image_analyses',
  inspirations:           'inspirations',
  pages:                  'pages',
  pois_generation_jobs:   'pois_generation_jobs',
  pois_selection:         'pois_selection',
  prompts:                'prompts',
  sections:               'sections',
  sites:                  'sites',
  sommaire_proposals:     'sommaire_proposals',
  templates:              'templates',
  translation_jobs:       'translation_jobs',
  settings:               'settings',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
