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

export function TemplatePaletteItem({ template }: TemplatePaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template._id}`,
    data: { type: 'template', template },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`relative bg-gradient-to-br from-white to-gray-50 rounded-lg border-2 cursor-grab transition-all ${
        isDragging 
          ? 'opacity-50 scale-95 border-blue-400' 
          : 'border-gray-300 hover:border-blue-500 hover:shadow-lg hover:scale-105'
      }`}
      style={{ minHeight: '240px' }}
    >
      {/* Badge nombre de champs */}
      <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">
        {template.fields.length}
      </div>

      <div className="p-4 h-full flex flex-col">
        {/* Icône et nom */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <DocumentTextIcon className="h-7 w-7 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-base text-gray-900 line-clamp-2">
              {template.name}
            </div>
          </div>
        </div>

        {/* Description */}
        {template.description && (
          <div className="text-sm text-gray-600 line-clamp-3 mb-3 flex-1">
            {template.description}
          </div>
        )}

        {/* Instruction */}
        <div className="mt-auto pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-500 font-medium text-center">
            🖱️ Glissez dans la grille
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
    <div className="h-full bg-gradient-to-br from-gray-100 to-gray-50 border-r-2 border-gray-300 p-4 overflow-auto">
      <div className="mb-4 pb-4 border-b-2 border-gray-300">
        <h3 className="text-base font-bold text-gray-900 mb-2 flex items-center gap-2">
          <DocumentTextIcon className="h-5 w-5 text-blue-600" />
          Templates
        </h3>
        <p className="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
          💡 Glissez un template dans une case numérotée
        </p>
      </div>

      <div className="space-y-3">
        {templates.length === 0 && (
          <div className="text-center py-12 px-4">
            <div className="text-gray-400 mb-2">📝</div>
            <div className="text-sm text-gray-500 font-medium mb-1">
              Aucun template
            </div>
            <div className="text-xs text-gray-400">
              Créez-en un dans la section Templates
            </div>
          </div>
        )}
        {templates.map((template) => (
          <TemplatePaletteItem key={template._id} template={template} />
        ))}
      </div>
    </div>
  );
}
