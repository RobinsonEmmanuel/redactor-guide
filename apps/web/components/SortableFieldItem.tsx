'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars3Icon, TrashIcon } from '@heroicons/react/24/outline';

interface TemplateField {
  id: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta' | 'liste';
  name: string;
  label?: string;
  description?: string;
  ai_instructions?: string;
  default_value?: string;
  skip_ai?: boolean;
  service_id?: string;
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
  titre: 'bg-purple-100 text-purple-700',
  texte: 'bg-blue-100 text-blue-700',
  image: 'bg-green-100 text-green-700',
  lien: 'bg-orange-100 text-orange-700',
  meta: 'bg-gray-100 text-gray-700',
  liste: 'bg-pink-100 text-pink-700',
};

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

          {/* Toggle : 4 modes de remplissage */}
          {(() => {
            const mode = field.service_id ? 'service'
              : field.default_value !== undefined ? 'default'
              : field.skip_ai ? 'manual'
              : 'ai';

            const setMode = (m: 'ai' | 'default' | 'manual' | 'service') => {
              if (m === 'ai')      onChange({ default_value: undefined, skip_ai: undefined, service_id: undefined });
              if (m === 'default') onChange({ ai_instructions: undefined, skip_ai: undefined, service_id: undefined, default_value: field.default_value ?? '' });
              if (m === 'manual')  onChange({ ai_instructions: undefined, default_value: undefined, service_id: undefined, skip_ai: true });
              if (m === 'service') onChange({ ai_instructions: undefined, default_value: undefined, skip_ai: undefined, service_id: availableServices[0]?.service_id ?? '' });
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
                <textarea
                  value={field.default_value}
                  onChange={(e) => onChange({ default_value: e.target.value })}
                  placeholder="Contenu identique sur toutes les nouvelles pages..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-emerald-50/30"
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
                    onChange={(e) => onChange({ service_id: e.target.value })}
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

          {/* Mode : Instructions IA */}
          {!field.default_value && !field.skip_ai && !field.service_id && (
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

          {/* Options spécifiques */}
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
