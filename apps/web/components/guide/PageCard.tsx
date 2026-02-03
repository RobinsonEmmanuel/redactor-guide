'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PencilIcon, TrashIcon, Bars3Icon } from '@heroicons/react/24/outline';

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_name?: string;
  ordre: number;
  type_de_page?: string;
  statut_editorial?: string;
}

interface PageCardProps {
  page: Page;
  onEdit: () => void;
  onDelete: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  generee_ia: 'bg-blue-100 text-blue-700',
  relue: 'bg-yellow-100 text-yellow-700',
  validee: 'bg-green-100 text-green-700',
  texte_coule: 'bg-cyan-100 text-cyan-700',
  visuels_montes: 'bg-purple-100 text-purple-700',
  texte_recu: 'bg-orange-100 text-orange-700',
  en_attente: 'bg-pink-100 text-pink-700',
  non_conforme: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  generee_ia: 'Générée IA',
  relue: 'Relue',
  validee: 'Validée',
  texte_coule: 'Texte coulé',
  visuels_montes: 'Visuels montés',
  texte_recu: 'Texte reçu',
  en_attente: 'En attente',
  non_conforme: 'Non conforme',
};

export default function PageCard({ page, onEdit, onDelete }: PageCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const statusColor = STATUS_COLORS[page.statut_editorial || 'draft'];
  const statusLabel = STATUS_LABELS[page.statut_editorial || 'draft'];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
    >
      {/* Miniature */}
      <div className="h-32 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative">
        <div className="absolute top-2 left-2 bg-white rounded px-2 py-1 text-xs font-bold text-gray-700">
          {page.ordre}
        </div>
        <div
          className="cursor-grab active:cursor-grabbing p-2 hover:bg-white/50 rounded"
          {...attributes}
          {...listeners}
        >
          <Bars3Icon className="h-6 w-6 text-gray-400" />
        </div>
        {page.template_name && (
          <div className="absolute bottom-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded font-mono">
            {page.template_name}
          </div>
        )}
      </div>

      {/* Contenu */}
      <div className="p-3">
        <h3 className="font-medium text-gray-900 text-sm mb-2 line-clamp-2 min-h-[2.5rem]">
          {page.titre}
        </h3>

        {/* Statut */}
        <div className="mb-3">
          <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Type */}
        {page.type_de_page && (
          <div className="text-xs text-gray-500 mb-3 capitalize">
            {page.type_de_page.replace('_', ' ')}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            <PencilIcon className="h-3.5 w-3.5" />
            Modifier
          </button>
          <button
            onClick={onDelete}
            className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
