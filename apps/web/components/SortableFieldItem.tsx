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
  ai_instructions?: string; // ✅ Ajout
  order: number;
  max_chars?: number;
  list_size?: number;
}

interface SortableFieldItemProps {
  field: TemplateField;
  templateName: string;
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

          {/* Instructions IA */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-2">
              <span className="text-purple-600">🤖</span>
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
              Guide l'IA pour remplir automatiquement ce champ à partir des articles WordPress
            </p>
          </div>

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
