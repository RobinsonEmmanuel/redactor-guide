'use client';

import { useRef, useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars3Icon, TrashIcon } from '@heroicons/react/24/outline';

/** Sous-champs par défaut pré-configurés pour le service inspiration_poi_cards.
 *  Mode "auto" = aucun flag = le service utilise sa logique intégrée.
 *  L'utilisateur ne modifie que les champs qu'il veut surcharger. */
const INSPIRATION_POI_CARDS_DEFAULT_SUBFIELDS: SubField[] = [
  { name: 'nom',         type: 'texte', label: 'Nom du lieu'        },
  { name: 'hashtag',     type: 'texte', label: 'Hashtag'            },
  { name: 'image',       type: 'image', label: 'Image emblématique' },
  { name: 'url_article', type: 'lien',  label: 'URL article (picto lien)' },
  { name: 'url_maps',    type: 'lien',  label: 'URL Google Maps (picto carte)' },
];

interface LinkPartConfig {
  ai_instructions?: string;
  default_value?: string;
  skip_ai?: boolean;
}

interface SubField {
  name: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta';
  label?: string;
  ai_instructions?: string;
  default_value?: string;
  skip_ai?: boolean;
  source?: 'destination_pool';
  link_label?: LinkPartConfig;
  link_url?: LinkPartConfig;
}

interface TemplateField {
  id: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta' | 'liste' | 'picto' | 'repetitif';
  name: string;
  label?: string;
  description?: string;
  ai_instructions?: string;
  default_value?: string;
  skip_ai?: boolean;
  service_id?: string;
  options?: string[];
  sub_fields?: SubField[];
  max_repetitions?: number;
  source?: 'destination_pool';
  pool_tags?: string[];
  pool_instructions?: string;
  search_keywords?: string[];
  link_label?: LinkPartConfig;
  link_url?: LinkPartConfig;
  validation?: {
    required?: boolean;
    max_length?: number;
    min_length?: number;
    sentence_count?: number;
    forbidden_words?: string[];
    forbidden_patterns?: string[];
    forbidden_temporal_terms?: string[];
    messages?: Record<string, string>;
    severity?: 'error' | 'warning';
  };
  order: number;
  max_chars?: number;
  list_size?: number;
}

export interface AvailableService {
  _id: string;
  service_id: string;
  label: string;
  description?: string;
  output_type: 'text' | 'json';
  implemented: boolean;
}

interface SortableFieldItemProps {
  field: TemplateField;
  templateName: string;
  availableServices: AvailableService[];
  onRemove: () => void;
  onChange: (updates: Partial<TemplateField>) => void;
}

const FIELD_TYPE_COLORS: Record<TemplateField['type'], string> = {
  titre:     'bg-purple-100 text-purple-700',
  texte:     'bg-blue-100 text-blue-700',
  image:     'bg-green-100 text-green-700',
  lien:      'bg-orange-100 text-orange-700',
  meta:      'bg-gray-100 text-gray-700',
  liste:     'bg-pink-100 text-pink-700',
  picto:     'bg-teal-100 text-teal-700',
  repetitif: 'bg-rose-100 text-rose-700',
};

// ─── DefaultValueInput ────────────────────────────────────────────────────────
// Input/textarea pour la valeur par défaut avec toolbar de styles (G, O, C).
// Affiché uniquement pour les types texte, titre, meta, liste.

interface DefaultValueInputProps {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}

function DefaultValueInput({ value, onChange, multiline = false, placeholder }: DefaultValueInputProps) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const applyStyle = (open: string, close: string) => {
    const el = ref.current;
    if (!el) return;
    const start    = el.selectionStart ?? 0;
    const end      = el.selectionEnd   ?? 0;
    if (start === end) return;

    const selected = value.slice(start, end);
    let newValue: string;
    let newStart: number;
    let newEnd:   number;

    if (selected.startsWith(open) && selected.endsWith(close) &&
        selected.length > open.length + close.length) {
      const inner = selected.slice(open.length, -close.length);
      newValue = value.slice(0, start) + inner + value.slice(end);
      newStart = start;
      newEnd   = start + inner.length;
    } else {
      newValue = value.slice(0, start) + open + selected + close + value.slice(end);
      newStart = start + open.length;
      newEnd   = end   + open.length;
    }

    onChange(newValue);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.setSelectionRange(newStart, newEnd);
        ref.current.focus();
      }
    });
  };

  const toolbar = (
    <div className="flex items-center gap-1 mb-1">
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); applyStyle('**', '**'); }}
        title="Gras"
        className="px-1.5 py-0.5 text-xs font-bold border border-gray-300 rounded hover:bg-gray-100 select-none"
      >G</button>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); applyStyle('{', '}'); }}
        title="Orange (#f39428)"
        className="px-1.5 py-0.5 text-xs font-bold border rounded hover:opacity-80 select-none"
        style={{ color: '#f39428', borderColor: '#f39428', background: '#fff8f0' }}
      >O</button>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); applyStyle('^', '^'); }}
        title="Chiffre (18pt)"
        className="px-1.5 py-0.5 text-xs font-semibold border border-purple-400 rounded text-purple-700 bg-purple-50 hover:bg-purple-100 select-none"
      >C</button>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); applyStyle('~', '~'); }}
        title="Gras-orange (gras + #f39428)"
        className="px-1.5 py-0.5 text-xs font-black border rounded hover:opacity-80 select-none"
        style={{ color: '#f39428', borderColor: '#f39428', background: '#fff8f0' }}
      >GO</button>
    </div>
  );

  const inputClass = "w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-emerald-50/30";

  return (
    <div>
      {toolbar}
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={inputClass}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}

const SUB_FIELD_TYPES: Array<{ value: SubField['type']; label: string; icon: string }> = [
  { value: 'image',  label: 'Image',  icon: '🖼️' },
  { value: 'titre',  label: 'Titre',  icon: '🔤' },
  { value: 'texte',  label: 'Texte',  icon: '📝' },
  { value: 'meta',   label: 'Méta',   icon: '🏷️' },
  { value: 'lien',   label: 'Lien',   icon: '🔗' },
];

export default function SortableFieldItem({
  field,
  templateName,
  availableServices,
  onRemove,
  onChange,
}: SortableFieldItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  // État local pour l'input des tags du pool — évite que le split sur virgule
  // consomme le caractère pendant la frappe (on ne splitte qu'au onBlur)
  const [poolTagsRaw, setPoolTagsRaw] = useState(
    (field.pool_tags ?? []).join(', ')
  );

  // Synchroniser si pool_tags change depuis l'extérieur (ex: chargement template)
  useEffect(() => {
    setPoolTagsRaw((field.pool_tags ?? []).join(', '));
  }, [field.pool_tags?.join(',')]);

  const [searchKeywordsRaw, setSearchKeywordsRaw] = useState(
    (field.search_keywords ?? []).join(', ')
  );

  useEffect(() => {
    setSearchKeywordsRaw((field.search_keywords ?? []).join(', '));
  }, [field.search_keywords?.join(',')]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          type="button"
          className="mt-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <Bars3Icon className="h-5 w-5" />
        </button>

        {/* Contenu du champ */}
        <div className="flex-1 space-y-3">
          {/* Type et nom */}
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                FIELD_TYPE_COLORS[field.type]
              }`}
            >
              {field.type}
            </span>
            <span className="font-mono text-sm text-gray-700">{field.name}</span>
          </div>

          {/* Label */}
          <div>
            <input
              type="text"
              value={field.label || ''}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="Label (optionnel)"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <textarea
              value={field.description || ''}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Description (optionnelle)"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Toggle : modes de remplissage */}
          {(() => {
            const mode = field.service_id ? 'service'
              : field.default_value !== undefined ? 'default'
              : field.skip_ai ? 'manual'
              : field.source === 'destination_pool' ? 'pool'
              : 'ai';

            const setMode = (m: 'ai' | 'default' | 'manual' | 'service' | 'pool') => {
              if (m === 'ai')      onChange({ default_value: undefined, skip_ai: undefined, service_id: undefined, source: undefined, pool_tags: undefined, pool_instructions: undefined, search_keywords: undefined });
              if (m === 'default') onChange({ ai_instructions: undefined, skip_ai: undefined, service_id: undefined, source: undefined, pool_tags: undefined, pool_instructions: undefined, search_keywords: undefined, default_value: field.default_value ?? '' });
              if (m === 'manual')  onChange({ ai_instructions: undefined, default_value: undefined, service_id: undefined, source: undefined, pool_tags: undefined, pool_instructions: undefined, search_keywords: undefined, skip_ai: true });
              if (m === 'service') onChange({ ai_instructions: undefined, default_value: undefined, skip_ai: undefined, source: undefined, pool_tags: undefined, pool_instructions: undefined, search_keywords: undefined, service_id: availableServices[0]?.service_id ?? '' });
              if (m === 'pool')    onChange({ ai_instructions: undefined, default_value: undefined, skip_ai: undefined, service_id: undefined, source: 'destination_pool', pool_tags: field.pool_tags ?? [], search_keywords: field.search_keywords ?? [] });
            };

            return (
              <div className="flex flex-wrap items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                <button type="button" onClick={() => setMode('ai')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'ai' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>🤖</span> Généré par IA
                </button>
                <button type="button" onClick={() => setMode('default')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'default' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>📌</span> Valeur par défaut
                </button>
                <button type="button" onClick={() => setMode('manual')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'manual' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>✏️</span> Saisie manuelle
                </button>
                <button type="button" onClick={() => setMode('service')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'service' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>⚙️</span> Calculé par service
                </button>
                {field.type === 'image' && (
                  <button type="button" onClick={() => setMode('pool')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'pool' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <span>🖼️</span> Pool destination
                  </button>
                )}
              </div>
            );
          })()}

          {/* Mode : Valeur par défaut */}
          {field.default_value !== undefined && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Valeur par défaut
              </label>
              {field.type === 'texte' || field.type === 'liste' ? (
                <DefaultValueInput
                  value={field.default_value}
                  onChange={(v) => onChange({ default_value: v })}
                  multiline
                  placeholder="Contenu identique sur toutes les nouvelles pages..."
                />
              ) : field.type === 'titre' || field.type === 'meta' ? (
                <DefaultValueInput
                  value={field.default_value}
                  onChange={(v) => onChange({ default_value: v })}
                  placeholder="Valeur par défaut..."
                />
              ) : (
                <input
                  type="text"
                  value={field.default_value}
                  onChange={(e) => onChange({ default_value: e.target.value })}
                  placeholder={
                    field.type === 'lien' ? 'https://...' :
                    field.type === 'image' ? 'URL de l\'image par défaut' :
                    'Valeur par défaut...'
                  }
                  className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-emerald-50/30"
                />
              )}
              <p className="mt-1 text-xs text-gray-500">
                Même valeur copiée sur toutes les pages — l'IA ignore ce champ.
              </p>
            </div>
          )}

          {/* Mode : Saisie manuelle */}
          {field.skip_ai && (
            <>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="text-amber-600 text-sm mt-0.5">✏️</span>
                <p className="text-xs text-amber-800">
                  Ce champ sera <strong>laissé vide</strong> après la génération IA.
                  Tu le rempliras manuellement dans l'éditeur de contenu, page par page.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Règles de validation (JSON optionnel)
                </label>
                <textarea
                  value={field.validation ? JSON.stringify(field.validation, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                      onChange({ validation: parsed });
                    } catch (err) {
                      // JSON invalide, on attend que l'utilisateur finisse de saisir
                    }
                  }}
                  placeholder={`{
  "required": true,
  "pattern": "^https?://.+\\.(jpg|jpeg|png|webp)$",
  "max_length": 120,
  "forbidden_words": ["incontournable", "magnifique"],
  "severity": "error"
}`}
                  rows={6}
                  className="w-full px-3 py-2 text-xs font-mono border border-red-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-red-50/20"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Validation appliquée lors de la saisie manuelle dans l'éditeur de contenu
                </p>
              </div>
            </>
          )}

          {/* Mode : Calculé par service */}
          {field.service_id !== undefined && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Service à appeler
                </label>
                {availableServices.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">
                    Aucun service disponible. Lancez{' '}
                    <code className="font-mono bg-gray-100 px-1 rounded">node scripts/seed-field-services.js</code>{' '}
                    pour enregistrer les services natifs.
                  </p>
                ) : (
                  <select
                    value={field.service_id}
                    onChange={(e) => {
                      const newServiceId = e.target.value;
                      // Auto-remplir les sous-champs par défaut si on sélectionne inspiration_poi_cards
                      // et que le champ n'en a pas encore (ou qu'ils sont vides)
                      if (newServiceId === 'inspiration_poi_cards' && !(field.sub_fields?.length)) {
                        onChange({ service_id: newServiceId, sub_fields: INSPIRATION_POI_CARDS_DEFAULT_SUBFIELDS });
                      } else {
                        onChange({ service_id: newServiceId });
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-sky-200 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-sky-50/30"
                  >
                    <option value="">-- Sélectionner un service --</option>
                    {availableServices.map((svc) => (
                      <option key={svc.service_id} value={svc.service_id} disabled={!svc.implemented}>
                        {svc.label}
                        {!svc.implemented ? ' (non implémenté)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Description du service sélectionné */}
              {field.service_id && (() => {
                const svc = availableServices.find((s) => s.service_id === field.service_id);
                if (!svc) return null;
                return (
                  <div className="flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-lg">
                    <span className="text-sky-600 text-sm mt-0.5">⚙️</span>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-sky-800">{svc.label}</p>
                      {svc.description && (
                        <p className="text-xs text-sky-700">{svc.description}</p>
                      )}
                      <p className="text-xs text-sky-600">
                        Sortie : <span className="font-mono">{svc.output_type}</span>
                        {!svc.implemented && (
                          <span className="ml-2 text-amber-600 font-medium">⚠️ Handler non implémenté</span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Mode : Pool destination */}
          {field.source === 'destination_pool' && (
            <>
              <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                <span className="text-teal-600 text-sm mt-0.5">🖼️</span>
                <p className="text-xs text-teal-800">
                  L'IA choisira l'image dans le <strong>pool des photos analysées de la destination</strong>.
                  Utilise <code className="bg-teal-100 px-1 rounded">{'{{IMAGES_DESTINATION}}'}</code> dans les instructions pour lui passer la liste.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Filtres par type (optionnel)
                </label>
                <input
                  type="text"
                  value={poolTagsRaw}
                  onChange={(e) => setPoolTagsRaw(e.target.value)}
                  onBlur={(e) => {
                    const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                    onChange({ pool_tags: tags });
                  }}
                  placeholder="Ex: paysage, vue_aerienne, détail"
                  className="w-full px-3 py-2 text-sm border border-teal-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-teal-50/30"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Filtre sur <code>detail_type</code> des analyses — séparer par virgules. Laisse vide pour tout inclure.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Mots-clés de recherche (optionnel)
                </label>
                <input
                  type="text"
                  value={searchKeywordsRaw}
                  onChange={(e) => setSearchKeywordsRaw(e.target.value)}
                  onBlur={(e) => {
                    const kws = e.target.value.split(',').map((k) => k.trim()).filter(Boolean);
                    onChange({ search_keywords: kws });
                  }}
                  placeholder="Ex: hotel, piscine, chambre, terrasse, resort"
                  className="w-full px-3 py-2 text-sm border border-teal-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-teal-50/30"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Filtre les images dont la description contient au moins un de ces mots. Séparer par virgules.
                  Laisse vide pour utiliser toutes les meilleures photos de la destination.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Critères de sélection (optionnel)
                </label>
                <textarea
                  value={field.pool_instructions || ''}
                  onChange={(e) => onChange({ pool_instructions: e.target.value })}
                  placeholder={`Ex: Choisir la photo la plus emblématique et panoramique de la destination.\nPréférer une image sans texte superposé, avec un score de clarté élevé.`}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-teal-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-teal-50/30"
                />
                <p className="mt-1 text-xs text-gray-500">
                  La liste des photos filtrées est injectée automatiquement. Décris ici les critères de choix final.
                </p>
              </div>
            </>
          )}

          {/* Mode : Instructions IA */}
          {!field.default_value && !field.skip_ai && !field.service_id && field.source !== 'destination_pool' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Instructions pour l'IA (optionnel)
                </label>
                <textarea
                  value={field.ai_instructions || ''}
                  onChange={(e) => onChange({ ai_instructions: e.target.value })}
                  placeholder="Ex: Générer un titre court et accrocheur à partir du titre de l'article WordPress, maximum 60 caractères..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-purple-50/30"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Guide l'IA pour remplir automatiquement ce champ
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Règles de validation (JSON optionnel)
                </label>
                <textarea
                  value={field.validation ? JSON.stringify(field.validation, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                      onChange({ validation: parsed });
                    } catch (err) {
                      // JSON invalide, on attend que l'utilisateur finisse de saisir
                    }
                  }}
                  placeholder={`{
  "required": true,
  "pattern": "^https?://.+\\.(jpg|jpeg|png|webp)$",
  "max_length": 120,
  "forbidden_words": ["incontournable", "magnifique"],
  "severity": "error"
}`}
                  rows={6}
                  className="w-full px-3 py-2 text-xs font-mono border border-red-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-red-50/20"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Validation automatique lors de la saisie (erreurs ou warnings selon severity)
                </p>
              </div>
            </>
          )}

          {/* ── Lien : configuration séparée intitulé + URL ───────────────────── */}
          {field.type === 'lien' && (() => {
            const useSplit = !!(field.link_label || field.link_url);

            const getLinkPartMode = (part?: LinkPartConfig) =>
              !part                        ? 'ai'
              : part.default_value !== undefined ? 'default'
              : part.skip_ai               ? 'manual'
              : 'ai';

            const setLinkPartMode = (
              partKey: 'link_label' | 'link_url',
              m: 'ai' | 'default' | 'manual'
            ) => {
              const base: LinkPartConfig =
                m === 'default' ? { default_value: '' }
                : m === 'manual' ? { skip_ai: true }
                : {};
              onChange({ [partKey]: base });
            };

            const modeBtn = (
              partKey: 'link_label' | 'link_url',
              current: 'ai' | 'default' | 'manual',
              m: 'ai' | 'default' | 'manual',
              icon: string,
              label: string,
              activeColor: string
            ) => (
              <button type="button"
                onClick={() => setLinkPartMode(partKey, m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  current === m ? `bg-white ${activeColor} shadow-sm` : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{icon}</span>{label}
              </button>
            );

            return (
              <div className="space-y-3">
                {/* Basculer entre mode simple et mode séparé */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                    🔗 Configuration du lien
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (useSplit) {
                        // Revenir au mode simple
                        onChange({ link_label: undefined, link_url: undefined });
                      } else {
                        // Activer le mode séparé
                        onChange({
                          link_label: {},
                          link_url: { default_value: '{{URL_ARTICLE_SOURCE}}' },
                          ai_instructions: undefined, default_value: undefined, skip_ai: undefined,
                        });
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      useSplit
                        ? 'bg-orange-100 border-orange-300 text-orange-700 hover:bg-orange-200'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {useSplit ? '⬆ Revenir au mode simple' : '⬇ Configurer intitulé et URL séparément'}
                  </button>
                </div>

                {useSplit ? (
                  <div className="space-y-4 pl-3 border-l-2 border-orange-200">
                    {/* ── Intitulé ── */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Intitulé du lien</p>
                      <div className="flex flex-wrap items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                        {modeBtn('link_label', getLinkPartMode(field.link_label), 'ai',      '🤖', 'Généré par IA',      'text-purple-700')}
                        {modeBtn('link_label', getLinkPartMode(field.link_label), 'default', '📌', 'Valeur par défaut',  'text-emerald-700')}
                        {modeBtn('link_label', getLinkPartMode(field.link_label), 'manual',  '✏️', 'Saisie manuelle',    'text-amber-700')}
                      </div>
                      {getLinkPartMode(field.link_label) === 'ai' && (
                        <textarea
                          value={field.link_label?.ai_instructions ?? ''}
                          onChange={(e) => onChange({ link_label: { ...field.link_label, ai_instructions: e.target.value || undefined } })}
                          placeholder="Ex: Rédiger un intitulé court et incitatif comme «Découvrir l'article complet»"
                          rows={2}
                          className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg bg-purple-50/30 focus:ring-2 focus:ring-purple-400"
                        />
                      )}
                      {getLinkPartMode(field.link_label) === 'default' && (
                        <input
                          type="text"
                          value={field.link_label?.default_value ?? ''}
                          onChange={(e) => onChange({ link_label: { ...field.link_label, default_value: e.target.value } })}
                          placeholder="Ex: En savoir plus →"
                          className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg bg-emerald-50/30 focus:ring-2 focus:ring-emerald-400"
                        />
                      )}
                      {getLinkPartMode(field.link_label) === 'manual' && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          L'intitulé sera saisi manuellement dans l'éditeur de contenu, page par page.
                        </p>
                      )}
                    </div>

                    {/* ── URL ── */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-700">URL du lien</p>
                      <div className="flex flex-wrap items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                        {modeBtn('link_url', getLinkPartMode(field.link_url), 'ai',      '🤖', 'Généré par IA',      'text-purple-700')}
                        {modeBtn('link_url', getLinkPartMode(field.link_url), 'default', '📌', 'Valeur par défaut',  'text-emerald-700')}
                        {modeBtn('link_url', getLinkPartMode(field.link_url), 'manual',  '✏️', 'Saisie manuelle',    'text-amber-700')}
                      </div>
                      {getLinkPartMode(field.link_url) === 'ai' && (
                        <textarea
                          value={field.link_url?.ai_instructions ?? ''}
                          onChange={(e) => onChange({ link_url: { ...field.link_url, ai_instructions: e.target.value || undefined } })}
                          placeholder="Ex: indique {{URL_ARTICLE_SOURCE}}"
                          rows={2}
                          className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg bg-purple-50/30 focus:ring-2 focus:ring-purple-400"
                        />
                      )}
                      {getLinkPartMode(field.link_url) === 'default' && (
                        <input
                          type="text"
                          value={field.link_url?.default_value ?? ''}
                          onChange={(e) => onChange({ link_url: { ...field.link_url, default_value: e.target.value } })}
                          placeholder="Ex: {{URL_ARTICLE_SOURCE}} ou https://..."
                          className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg bg-emerald-50/30 focus:ring-2 focus:ring-emerald-400"
                        />
                      )}
                      {getLinkPartMode(field.link_url) === 'manual' && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          L'URL sera saisie manuellement dans l'éditeur de contenu, page par page.
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-gray-500">
                      Valeur exportée : <code className="bg-gray-100 px-1 rounded">{`{"label":"…","url":"…"}`}</code>
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })()}

          {/* Options spécifiques selon le type */}
          <div className="flex gap-4">
            {/* Calibre (pour titre et texte) */}
            {(field.type === 'titre' || field.type === 'texte') && (
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Calibre (caractères max)
                </label>
                <input
                  type="number"
                  value={field.max_chars || ''}
                  onChange={(e) =>
                    onChange({ max_chars: e.target.value ? parseInt(e.target.value) : undefined })
                  }
                  placeholder="Ex: 150"
                  min="1"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}

            {/* Taille de liste */}
            {field.type === 'liste' && (
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Nombre d'éléments *
                </label>
                <input
                  type="number"
                  value={field.list_size || ''}
                  onChange={(e) =>
                    onChange({ list_size: e.target.value ? parseInt(e.target.value) : undefined })
                  }
                  placeholder="Ex: 5"
                  min="1"
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
          </div>

          {/* Gabarit répétitif */}
          {field.type === 'repetitif' && (
            <div className="space-y-4">
              {/* Nombre max de répétitions */}
              <div className="flex items-center gap-4">
                <div className="w-40">
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Répétitions max
                  </label>
                  <input
                    type="number"
                    value={field.max_repetitions || ''}
                    onChange={(e) => onChange({ max_repetitions: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Ex: 6"
                    min="1"
                    className="w-full px-3 py-2 text-sm border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-500 bg-rose-50/30"
                  />
                </div>
                <div className="flex-1 flex items-end pb-1">
                  <p className="text-xs text-gray-500">
                    {field.service_id === 'inspiration_poi_cards'
                      ? 'Déterminé automatiquement par le nombre de POIs de la page.'
                      : `L'IA génère entre 1 et ${field.max_repetitions || '?'} entrées selon les contenus disponibles.`}
                  </p>
                </div>
              </div>

              {/* Sous-champs du gabarit — éditeur complet avec onglets */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-gray-700">
                    Sous-champs — configuration par composant
                  </label>
                  <div className="flex items-center gap-2">
                    {field.service_id === 'inspiration_poi_cards' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (field.sub_fields?.length) {
                            if (!confirm('Réinitialiser les sous-champs ? Tes instructions personnalisées seront perdues.')) return;
                          }
                          onChange({ sub_fields: INSPIRATION_POI_CARDS_DEFAULT_SUBFIELDS });
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-sky-600 border border-sky-300 rounded-md hover:bg-sky-50"
                        title="Remettre les 5 sous-champs par défaut du service (nom, hashtag, image, url_article, url_maps)"
                      >
                        ↺ Valeurs par défaut
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const existing = field.sub_fields ?? [];
                        onChange({ sub_fields: [...existing, { name: `champ_${existing.length + 1}`, type: 'texte' as SubField['type'] }] });
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-600 border border-rose-300 rounded-md hover:bg-rose-50"
                    >
                      + Ajouter un sous-champ
                    </button>
                  </div>
                </div>

                {(!field.sub_fields || field.sub_fields.length === 0) ? (
                  <p className="text-xs text-gray-400 italic py-2">
                    {field.service_id === 'inspiration_poi_cards'
                      ? 'Les 7 sous-champs standard ont été initialisés. Clique sur "↺ Valeurs par défaut" si besoin.'
                      : 'Aucun sous-champ défini. Ajoute les champs composant chaque entrée (image, nom, hashtag, lien…).'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {field.sub_fields.map((sf, idx) => {
                      // auto = service intégré (comportement par défaut, aucun flag)
                      // ai   = génération IA (ai_instructions renseigné)
                      // default = valeur fixe (default_value renseigné)
                      // manual  = laissé vide, saisie page par page (skip_ai: true)
                      const sfMode: 'auto' | 'ai' | 'default' | 'manual' =
                        sf.skip_ai                      ? 'manual'
                        : sf.default_value !== undefined ? 'default'
                        : sf.ai_instructions             ? 'ai'
                        : 'auto';

                      const setSfMode = (m: 'auto' | 'ai' | 'default' | 'manual') => {
                        const next = [...(field.sub_fields ?? [])];
                        if (m === 'auto')    next[idx] = { name: sf.name, type: sf.type, label: sf.label };
                        if (m === 'ai')      next[idx] = { name: sf.name, type: sf.type, label: sf.label, ai_instructions: sf.ai_instructions ?? '' };
                        if (m === 'default') next[idx] = { name: sf.name, type: sf.type, label: sf.label, default_value: sf.default_value ?? '' };
                        if (m === 'manual')  next[idx] = { name: sf.name, type: sf.type, label: sf.label, skip_ai: true };
                        onChange({ sub_fields: next });
                      };

                      const updateSf = (patch: Partial<SubField>) => {
                        const next = [...(field.sub_fields ?? [])];
                        next[idx] = { ...sf, ...patch };
                        onChange({ sub_fields: next });
                      };

                      return (
                        <div key={idx} className="border border-rose-200 rounded-xl bg-white overflow-hidden">
                          {/* En-tête du sous-champ */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border-b border-rose-100">
                            <select
                              value={sf.type}
                              onChange={(e) => updateSf({ type: e.target.value as SubField['type'] })}
                              className="px-2 py-1 text-xs border border-rose-200 rounded-md bg-white font-medium"
                            >
                              {SUB_FIELD_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                              ))}
                            </select>

                            <input
                              type="text"
                              value={sf.name}
                              onChange={(e) => updateSf({ name: e.target.value })}
                              placeholder="nom_technique"
                              className="w-36 px-2 py-1 text-xs font-mono border border-rose-200 rounded-md"
                            />

                            <input
                              type="text"
                              value={sf.label ?? ''}
                              onChange={(e) => updateSf({ label: e.target.value || undefined })}
                              placeholder="Label affiché (optionnel)"
                              className="flex-1 px-2 py-1 text-xs border border-rose-200 rounded-md"
                            />

                            <button
                              type="button"
                              onClick={() => {
                                const next = (field.sub_fields ?? []).filter((_, i) => i !== idx);
                                onChange({ sub_fields: next.length ? next : undefined });
                              }}
                              className="text-red-400 hover:text-red-600 p-1 shrink-0"
                              title="Supprimer ce sous-champ"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Corps : onglets de mode identiques aux champs top-level */}
                          <div className="p-3 space-y-3">
                            {/* Onglets */}
                            <div className="flex flex-wrap items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                              <button type="button" onClick={() => setSfMode('ai')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sfMode === 'ai' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                🤖 Généré par IA
                              </button>
                              <button type="button" onClick={() => setSfMode('default')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sfMode === 'default' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                📌 Valeur par défaut
                              </button>
                              <button type="button" onClick={() => setSfMode('manual')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sfMode === 'manual' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                ✏️ Saisie manuelle
                              </button>
                              <button type="button" onClick={() => setSfMode('auto')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sfMode === 'auto' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                ⚙️ Calculé par service
                              </button>
                            </div>

                            {/* Contenu selon le mode */}
                            {sfMode === 'auto' && (
                              <div className="flex items-start gap-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg">
                                <span className="text-sky-500 text-base mt-0.5">⚙️</span>
                                <div className="text-xs text-sky-800 space-y-0.5">
                                  <p className="font-semibold">Ce champ est calculé automatiquement par le service :</p>
                                  {sf.name === 'image' && <p>Sélectionne la <strong>meilleure image taguée avec ce POI</strong> depuis image_analyses (score iconique › pertinence › clarté).</p>}
                                  {sf.name === 'url_maps' && <p>Géocode le POI via <strong>Photon (OpenStreetMap)</strong> et construit l'URL Google Maps pour le <strong>picto carte</strong>.</p>}
                                  {sf.name === 'url_article' && <p>Injecte <strong>l'URL de l'article WordPress</strong> du POI pour le <strong>picto lien</strong> (<code className="bg-sky-100 px-1 rounded">poi.url_source</code>).</p>}
                                  {sf.name === 'nom' && <p>Réécrit le nom du POI via <strong>gpt-4o-mini</strong> avec les instructions par défaut du service.</p>}
                                  {sf.name === 'hashtag' && <p>Génère un <strong>hashtag</strong> via gpt-4o-mini avec les instructions par défaut du service.</p>}
                                  {!['image','url_maps','url_article','nom','hashtag'].includes(sf.name) && <p>Le service utilise sa <strong>logique intégrée</strong> pour remplir ce champ.</p>}
                                </div>
                              </div>
                            )}

                            {sfMode === 'ai' && (
                              <div>
                                <textarea
                                  value={sf.ai_instructions ?? ''}
                                  onChange={(e) => updateSf({ ai_instructions: e.target.value || undefined })}
                                  placeholder={
                                    sf.name === 'image'
                                      ? 'Ex: Choisis parmi {{IMAGES_POI}} la photo la plus emblématique pour le thème {{ANGLE_EDITORIAL}}'
                                      : sf.name === 'hashtag' || sf.type === 'meta'
                                      ? 'Ex: Génère un seul #hashtag court sans espace pour {{POI_NOM}}, thème {{ANGLE_EDITORIAL}}'
                                      : sf.name === 'nom' || sf.type === 'titre'
                                      ? 'Ex: Réécris {{POI_NOM}} en nom court (max 4 mots) pour une carte de guide'
                                      : 'Instructions pour l\'IA…'
                                  }
                                  rows={3}
                                  className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-400 bg-purple-50/20"
                                />
                                <p className="mt-1 text-xs text-gray-400">
                                  Variables :{' '}
                                  {sf.name === 'image'
                                    ? <><code className="bg-gray-100 px-1 rounded text-xs">{'{{POI_NOM}}'}</code> <code className="bg-gray-100 px-1 rounded text-xs">{'{{IMAGES_POI}}'}</code></>
                                    : <><code className="bg-gray-100 px-1 rounded text-xs">{'{{POI_NOM}}'}</code> <code className="bg-gray-100 px-1 rounded text-xs">{'{{POI_URL_ARTICLE}}'}</code> <code className="bg-gray-100 px-1 rounded text-xs">{'{{ANGLE_EDITORIAL}}'}</code> <code className="bg-gray-100 px-1 rounded text-xs">{'{{DESTINATION}}'}</code> <code className="bg-gray-100 px-1 rounded text-xs">{'{{INSPIRATION_TITRE}}'}</code></>
                                  }
                                </p>
                              </div>
                            )}

                            {sfMode === 'default' && (
                              <div>
                                <input
                                  type="text"
                                  value={sf.default_value ?? ''}
                                  onChange={(e) => updateSf({ default_value: e.target.value })}
                                  placeholder={
                                    sf.type === 'image' ? 'URL d\'image par défaut (https://...)'
                                    : 'Valeur identique pour chaque entrée…'
                                  }
                                  className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-400 bg-emerald-50/20"
                                />
                                <p className="mt-1 text-xs text-gray-400">
                                  Même valeur pour toutes les entrées.
                                </p>
                              </div>
                            )}

                            {sfMode === 'manual' && (
                              <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                                <span className="text-amber-600 text-base mt-0.5">✏️</span>
                                <p className="text-xs text-amber-800">
                                  Ce champ sera <strong>laissé vide</strong> après la génération — tu le rempliras manuellement dans la modale de rédaction, page par page.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Aperçu des calques InDesign générés */}
                {(() => {
                  const sep = '_repetitif_';
                  const si  = field.name.indexOf(sep);
                  const pfx = si !== -1 ? field.name.substring(0, si) : 'TEMPLATE';
                  const grp = si !== -1 ? field.name.substring(si + sep.length) : field.name;

                  // Pour inspiration_poi_cards : calques fixes générés par le service
                  const POI_CARDS_FIELDS: Array<{ name: string; label: string; note?: string }> = [
                    { name: 'nom',         label: 'Nom du lieu (réécrit par IA)' },
                    { name: 'hashtag',     label: 'Hashtag éditorial' },
                    { name: 'image',       label: 'Image emblématique' },
                    { name: 'url_article', label: 'URL article WordPress → picto lien' },
                    { name: 'url_maps',    label: 'URL Google Maps → picto carte' },
                  ];

                  const isPoiCards = field.service_id === 'inspiration_poi_cards';
                  const calques = isPoiCards
                    ? POI_CARDS_FIELDS
                    : (field.sub_fields ?? []).map((sf) => ({ name: sf.name, label: sf.label ?? '' }));

                  if (calques.length === 0) return null;

                  // Noms mal configurés (ne correspondent pas aux clés du service)
                  const knownNames = new Set(POI_CARDS_FIELDS.map((f) => f.name));
                  const badSubFields = isPoiCards
                    ? (field.sub_fields ?? []).filter((sf) => !knownNames.has(sf.name))
                    : [];

                  return (
                    <div className="mt-3 space-y-2">
                      {badSubFields.length > 0 && (
                        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                          <span className="text-red-500 mt-0.5">⚠️</span>
                          <div className="text-xs text-red-700">
                            <p className="font-semibold">Noms de sous-champs incorrects — leurs instructions seront ignorées :</p>
                            <p className="mt-0.5">
                              {badSubFields.map((sf) => <code key={sf.name} className="bg-red-100 px-1 rounded mr-1">{sf.name}</code>)}
                              → renomme-les avec les noms exacts du service (voir calques ci-dessous).
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="p-3 bg-gray-900 rounded-lg">
                        <p className="text-xs text-gray-400 mb-1.5 font-mono">// Calques InDesign générés{isPoiCards ? ' par le service inspiration_poi_cards' : ' (convention automatique)'} :</p>
                        <div className="space-y-0.5">
                          {calques.map((c) => {
                            const isDeclared = (field.sub_fields ?? []).some((sf) => sf.name === c.name);
                            return (
                              <div key={c.name} className="flex items-center gap-2">
                                <code className="text-xs text-green-400 font-mono">{pfx}_{grp}_{c.name}_N</code>
                                <span className="text-xs text-gray-500">— {c.label}</span>
                                {isPoiCards && !isDeclared && (
                                  <span className="text-xs text-gray-600 italic">(automatique)</span>
                                )}
                                {isPoiCards && isDeclared && (
                                  <span className="text-xs text-sky-400 italic">(configuré)</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Valeurs autorisées (picto) */}
          {field.type === 'picto' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Valeurs autorisées *
              </label>
              <p className="text-xs text-gray-500 mb-2">
                L'IA choisira <strong>exactement une</strong> valeur dans cette liste. Une valeur par ligne.
              </p>
              <textarea
                value={(field.options ?? []).join('\n')}
                onChange={(e) => {
                  const vals = e.target.value.split('\n').map((v) => v.trim()).filter(Boolean);
                  onChange({ options: vals.length ? vals : undefined });
                }}
                placeholder={'ex-soleil\nex-pluie\nex-nuage\nex-neige'}
                rows={4}
                className="w-full px-3 py-2 text-sm font-mono border border-teal-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-teal-50/30"
              />
              {field.options && field.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {field.options.map((opt) => (
                    <span key={opt} className="px-2 py-0.5 text-xs font-mono bg-teal-100 text-teal-700 rounded-full border border-teal-200">
                      {opt}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bouton supprimer */}
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 text-red-600 hover:text-red-700"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
