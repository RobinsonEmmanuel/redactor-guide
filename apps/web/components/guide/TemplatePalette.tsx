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
      className={`bg-white rounded-lg border overflow-hidden cursor-grab transition-all ${
        isDragging 
          ? 'opacity-50 scale-95 border-blue-400 shadow-lg' 
          : 'border-gray-200 hover:border-blue-400 hover:shadow-lg'
      }`}
    >
      {/* Miniature template (même style que PageCard) */}
      <div className="h-32 bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center relative">
        {/* Badge nombre de champs */}
        <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">
          {template.fields.length}
        </div>
        
        {/* Icône template */}
        <DocumentTextIcon className="h-12 w-12 text-blue-600 opacity-50" />
      </div>

      {/* Contenu */}
      <div className="p-3">
        <h4 className="font-semibold text-sm text-gray-900 mb-1 line-clamp-1">
          {template.name}
        </h4>
        {template.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-2">
            {template.description}
          </p>
        )}
        <div className="text-xs text-gray-400 font-medium">
          🖱️ Glissez dans la grille
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
