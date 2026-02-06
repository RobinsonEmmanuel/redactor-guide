'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PencilIcon, TrashIcon, Bars3Icon, DocumentTextIcon } from '@heroicons/react/24/outline';

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_name?: string;
  ordre: number;
  type_de_page?: string;
  statut_editorial?: string;
  url_source?: string;
  image_url?: string; // Image de l'article WordPress
}

interface PageCardProps {
  page: Page;
  onEdit: () => void;
  onDelete: () => void;
  onOpenContent: () => void;
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

export default function PageCard({ page, onEdit, onDelete, onOpenContent }: PageCardProps) {
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
      className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow group"
    >
      {/* Miniature avec image de fond si disponible */}
      <div 
        className="h-32 relative flex items-center justify-center"
        style={{
          backgroundImage: page.image_url ? `url(${page.image_url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: page.image_url ? undefined : '#f3f4f6',
        }}
      >
        {/* Overlay sombre pour lisibilité */}
        {page.image_url && <div className="absolute inset-0 bg-black/20" />}
        
        {/* Numéro de page */}
        <div className="absolute top-2 left-2 bg-white/95 backdrop-blur rounded px-2 py-1 text-xs font-bold text-gray-700 shadow-sm z-10">
          {page.ordre}
        </div>
        
        {/* Bouton supprimer (visible au hover) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10 shadow-md"
          title="Supprimer la page"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
        
        {/* Drag handle (centré, toujours visible) */}
        <div
          className="cursor-grab active:cursor-grabbing p-3 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm z-10"
          {...attributes}
          {...listeners}
        >
          <Bars3Icon className={`h-6 w-6 ${page.image_url ? 'text-white drop-shadow-md' : 'text-gray-400'}`} />
        </div>
        
        {/* Pastille de statut (bottom-left) */}
        <div className={`absolute bottom-2 left-2 w-2.5 h-2.5 rounded-full border border-white shadow-md ${
          page.statut_editorial === 'validee' ? 'bg-green-500' :
          page.statut_editorial === 'relue' ? 'bg-yellow-500' :
          page.statut_editorial === 'generee_ia' ? 'bg-blue-500' :
          page.statut_editorial === 'non_conforme' ? 'bg-red-500' :
          'bg-gray-400'
        }`} title={statusLabel} />
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
            onClick={onOpenContent}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 rounded transition-colors"
            title="Rédiger le contenu"
          >
            <DocumentTextIcon className="h-3.5 w-3.5" />
            Rédiger
          </button>
          <button
            onClick={onEdit}
            className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Modifier les infos"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
