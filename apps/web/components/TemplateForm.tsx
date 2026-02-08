'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';
import SortableFieldItem from '@/components/SortableFieldItem';
import { nanoid } from 'nanoid';

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

interface Template {
  _id?: string;
  name: string;
  description?: string;
  fields: TemplateField[];
}

interface TemplateFormProps {
  templateId?: string;
}

const FIELD_TYPES: Array<{ value: TemplateField['type']; label: string; description: string }> = [
  { value: 'titre', label: 'Titre', description: 'Texte court servant de titre ou sous-titre' },
  { value: 'texte', label: 'Texte', description: 'Texte informatif court, calibré' },
  { value: 'image', label: 'Image', description: 'Référence à une image locale' },
  { value: 'lien', label: 'Lien', description: 'URL pointant vers un contenu externe' },
  { value: 'meta', label: 'Métadonnée', description: 'Métadonnée éditoriale normée' },
  { value: 'liste', label: 'Liste', description: 'Liste courte avec nombre fixe de champs' },
];

export default function TemplateForm({ templateId }: TemplateFormProps) {
  const router = useRouter();
  const [template, setTemplate] = useState<Template>({
    name: '',
    description: '',
    fields: [],
  });
  const [loading, setLoading] = useState(!!templateId);
  const [saving, setSaving] = useState(false);
  const [showAddField, setShowAddField] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    }
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/templates/${templateId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTemplate(data);
      }
    } catch (err) {
      console.error('Erreur chargement template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = (type: TemplateField['type']) => {
    const fieldIndex = template.fields.filter((f) => f.type === type).length + 1;
    const fieldName = `${template.name}_${type}_${fieldIndex}`;

    const newField: TemplateField = {
      id: nanoid(),
      type,
      name: fieldName,
      order: template.fields.length,
    };

    setTemplate({
      ...template,
      fields: [...template.fields, newField],
    });
    setShowAddField(false);
  };

  const handleRemoveField = (id: string) => {
    setTemplate({
      ...template,
      fields: template.fields.filter((f) => f.id !== id),
    });
  };

  const handleFieldChange = (id: string, updates: Partial<TemplateField>) => {
    setTemplate({
      ...template,
      fields: template.fields.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setTemplate((prev) => {
        const oldIndex = prev.fields.findIndex((f) => f.id === active.id);
        const newIndex = prev.fields.findIndex((f) => f.id === over.id);
        const newFields = arrayMove(prev.fields, oldIndex, newIndex);
        
        // Mettre à jour l'ordre
        return {
          ...prev,
          fields: newFields.map((f, idx) => ({ ...f, order: idx })),
        };
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template.name) {
      alert('Le nom du template est requis');
      return;
    }

    if (!/^[A-Z][A-Z0-9_]*$/.test(template.name)) {
      alert('Le nom doit être en MAJUSCULES (ex: POI, RESTAURANT)');
      return;
    }

    if (template.fields.length === 0) {
      alert('Ajoutez au moins un champ au template');
      return;
    }

    setSaving(true);
    try {
      const url = templateId
        ? `${apiUrl}/api/v1/templates/${templateId}`
        : `${apiUrl}/api/v1/templates`;
      const method = templateId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(template),
      });

      if (res.ok) {
        router.push('/templates');
      } else {
        const error = await res.json();
        alert(error.error || 'Erreur lors de la sauvegarde');
      }
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const regenerateFieldNames = () => {
    const typeCounters: Record<string, number> = {};
    
    setTemplate({
      ...template,
      fields: template.fields.map((field) => {
        typeCounters[field.type] = (typeCounters[field.type] || 0) + 1;
        return {
          ...field,
          name: `${template.name}_${field.type}_${typeCounters[field.type]}`,
        };
      }),
    });
  };

  useEffect(() => {
    if (template.name && template.fields.length > 0) {
      regenerateFieldNames();
    }
  }, [template.name]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/templates')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Retour aux templates
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            {templateId ? 'Modifier le template' : 'Nouveau template'}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="max-w-4xl">
          {/* Informations de base */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Informations</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nom du template *
                </label>
                <input
                  type="text"
                  value={template.name}
                  onChange={(e) => setTemplate({ ...template, name: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                  placeholder="POI"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  En MAJUSCULES (ex: POI, RESTAURANT, PLAGE)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={template.description || ''}
                  onChange={(e) => setTemplate({ ...template, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Décrivez l'usage de ce template..."
                />
              </div>
            </div>
          </div>

          {/* Champs du template */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Champs ({template.fields.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowAddField(!showAddField)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <PlusIcon className="h-4 w-4" />
                Ajouter un champ
              </button>
            </div>

            {/* Menu d'ajout de champ */}
            {showAddField && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-3">Type de champ</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {FIELD_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => handleAddField(type.value)}
                      className="p-3 text-left border border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                    >
                      <div className="font-medium text-gray-900 text-sm">{type.label}</div>
                      <div className="text-xs text-gray-600 mt-1">{type.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Liste des champs (drag-and-drop) */}
            {template.fields.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                Aucun champ. Cliquez sur "Ajouter un champ" pour commencer.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={template.fields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {template.fields.map((field) => (
                      <SortableFieldItem
                        key={field.id}
                        field={field}
                        templateName={template.name}
                        onRemove={() => handleRemoveField(field.id)}
                        onChange={(updates) => handleFieldChange(field.id, updates)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/templates')}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving || !template.name || template.fields.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Enregistrement...' : templateId ? 'Mettre à jour' : 'Créer le template'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
