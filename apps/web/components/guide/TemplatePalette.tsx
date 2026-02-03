'use client';

import { useDraggable } from '@dnd-kit/core';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

interface Template {
  _id: string;
  name: string;
  description?: string;
  fields: any[];
}

interface TemplatePaletteItemProps {
  template: Template;
}

function TemplatePaletteItem({ template }: TemplatePaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template._id}`,
    data: { type: 'template', template },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`p-3 border border-gray-300 rounded-lg bg-white cursor-grab hover:border-blue-500 hover:shadow-md transition-all ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <DocumentTextIcon className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 truncate">
            {template.name}
          </div>
          {template.description && (
            <div className="text-xs text-gray-500 mt-1 line-clamp-2">
              {template.description}
            </div>
          )}
          <div className="text-xs text-gray-400 mt-1">
            {template.fields.length} champs
          </div>
        </div>
      </div>
    </div>
  );
}

interface TemplatePaletteProps {
  templates: Template[];
}

export default function TemplatePalette({ templates }: TemplatePaletteProps) {
  return (
    <div className="h-full bg-gray-50 border-r border-gray-200 p-4 overflow-auto">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          Templates disponibles
        </h3>
        <p className="text-xs text-gray-500">
          Glissez un template dans le chemin de fer
        </p>
      </div>

      <div className="space-y-2">
        {templates.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8">
            Aucun template disponible.
            <br />
            Créez-en un d'abord.
          </div>
        )}
        {templates.map((template) => (
          <TemplatePaletteItem key={template._id} template={template} />
        ))}
      </div>
    </div>
  );
}
