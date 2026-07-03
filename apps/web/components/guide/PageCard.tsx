'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TrashIcon, DocumentTextIcon, XMarkIcon, ArrowPathIcon, MapPinIcon, RectangleStackIcon, LightBulbIcon, SparklesIcon } from '@heroicons/react/24/outline';

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
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}

interface PageCardProps {
  page: Page;
  onEdit: () => void;
  onDelete: () => void;
  onOpenContent: () => void;
  onReset: () => void; // ✅ Nouveau: réinitialiser le statut
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generee_ia: 'bg-[#191E55]/10 text-[#191E55]',
  relue: 'bg-yellow-100 text-yellow-700',
  validee: 'bg-green-100 text-green-700',
  texte_coule: 'bg-gray-100 text-gray-600',
  visuels_montes: 'bg-gray-100 text-gray-600',
  texte_recu: 'bg-orange-100 text-orange-700',
  en_attente: 'bg-gray-100 text-gray-500',
  non_conforme: 'bg-red-100 text-red-700',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  draft: 'bg-gray-400',
  generee_ia: 'bg-[#191E55]',
  relue: 'bg-yellow-500',
  validee: 'bg-green-500',
  texte_coule: 'bg-gray-400',
  visuels_montes: 'bg-gray-400',
  texte_recu: 'bg-orange-500',
  en_attente: 'bg-gray-400',
  non_conforme: 'bg-red-500',
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

// ── Couleur par type de page ─────────────────────────────────────────────────
const tplUpper = (tpl: string) => tpl.toUpperCase();

function getPageTypeMeta(page: Page): { leftBorder: string; thumbColor: string; cardBg: string } {
  const tpl = tplUpper(page.template_name || '');
  const type = (page.type_de_page || '').toLowerCase();

  if (type.startsWith('poi') || tpl.startsWith('POI') || tpl.match(/^[A-Z]-POI/)) {
    return { leftBorder: 'border-l-4 border-l-emerald-300', thumbColor: 'rgba(5, 150, 105, 0.20)', cardBg: 'bg-white' };
  }
  if (type === 'cluster' || tpl.includes('CLUSTER')) {
    return { leftBorder: 'border-l-4 border-l-emerald-500', thumbColor: '#059669', cardBg: 'bg-white' };
  }
  if (type === 'inspiration' || tpl.startsWith('INSPIRATION') || tpl.match(/^[A-Z]-INSPIRATION/)) {
    return { leftBorder: 'border-l-4 border-l-orange-500', thumbColor: '#ea580c', cardBg: 'bg-white' };
  }
  if (tpl.startsWith('SAISON') || tpl.match(/^[A-Z]-SAISON/) || tpl.match(/^I-SAISON/)) {
    return { leftBorder: 'border-l-4 border-l-amber-500', thumbColor: '#b45309', cardBg: 'bg-white' };
  }
  return { leftBorder: 'border-l-4 border-l-gray-300', thumbColor: '#9ca3af', cardBg: 'bg-white' };
}

function getTypeIcon(page: Page) {
  const tpl = tplUpper(page.template_name || '');
  const type = (page.type_de_page || '').toLowerCase();
  if (type.startsWith('poi') || tpl.startsWith('POI') || tpl.match(/^[A-Z]-POI/)) return MapPinIcon;
  if (type === 'cluster' || tpl.includes('CLUSTER')) return RectangleStackIcon;
  if (type === 'inspiration' || tpl.startsWith('INSPIRATION') || tpl.match(/^[A-Z]-INSPIRATION/)) return LightBulbIcon;
  if (tpl.startsWith('SAISON') || tpl.match(/^[A-Z]-SAISON/) || tpl.match(/^I-SAISON/)) return SparklesIcon;
  return DocumentTextIcon;
}

export default function PageCard({ page, onEdit, onDelete, onOpenContent, onReset }: PageCardProps) {
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
  const statusDot = STATUS_DOT_COLORS[page.statut_editorial || 'draft'];
  const statusLabel = STATUS_LABELS[page.statut_editorial || 'draft'];

  const { leftBorder, thumbColor, cardBg } = getPageTypeMeta(page);
  const TypeIcon = getTypeIcon(page);

  // Déterminer la bordure et l'effet selon le statut
  const isGenerating = page.statut_editorial === 'en_attente';
  const isGenerated = page.statut_editorial === 'generee_ia';
  const isNonConforme = page.statut_editorial === 'non_conforme';
  const isValidated = page.statut_editorial === 'validee';
  
  let cardBorderClass = 'border-gray-200';
  let cardExtraClass = '';
  
  if (isGenerating) {
    cardBorderClass = 'border-[#191E55]/30';
    cardExtraClass = 'animate-pulse-slow ring-2 ring-[#191E55]/10';
  } else if (isNonConforme) {
    cardBorderClass = 'border-red-300';
    cardExtraClass = 'ring-1 ring-red-200';
  } else if (isGenerated) {
    cardBorderClass = 'border-[#191E55]/20';
  } else if (isValidated) {
    cardBorderClass = 'border-green-300';
    cardExtraClass = 'ring-1 ring-green-100';
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${cardBg} rounded-lg border overflow-hidden hover:shadow-lg transition-all group ${cardBorderClass} ${cardExtraClass} ${leftBorder}`}
    >
      {/* Miniature avec image de fond si disponible - TOUTE LA ZONE EST DRAGGABLE */}
      <div
        className="h-32 relative flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage: page.image_url ? `url(${page.image_url})` : undefined,
          backgroundSize: page.image_url ? 'cover' : undefined,
          backgroundPosition: page.image_url ? 'center' : undefined,
          backgroundColor: page.image_url ? undefined : thumbColor,
        }}
        {...attributes}
        {...listeners}
      >
        {/* Overlay sombre pour lisibilité */}
        {page.image_url && <div className="absolute inset-0 bg-black/20 pointer-events-none" />}
        
        {/* Numéro de page */}
        <div className="absolute top-2 left-2 bg-white/95 backdrop-blur rounded px-2 py-1 text-xs font-bold text-gray-700 shadow-sm z-10 pointer-events-none">
          {page.ordre}
        </div>
        
        {/* Bouton supprimer (visible au hover) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-20 shadow-md"
          title="Supprimer la page"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
        
        {/* Icône type (indicateur visuel au centre) */}
        <div className="pointer-events-none">
          <TypeIcon className={`h-8 w-8 ${page.image_url ? 'text-white/70 drop-shadow-md' : 'text-white/25'}`} />
        </div>
      </div>

      {/* Contenu */}
      <div className="p-3">
        <h3 className="font-medium text-gray-900 text-sm mb-2 line-clamp-2 min-h-[2.5rem]">
          {page.titre}
        </h3>

        {/* Statut avec code couleur pour lecture rapide */}
        <div className="mb-3">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
            {statusLabel}
          </span>
        </div>

        {/* Actions */}
        {(() => {
          const isGenerating = page.statut_editorial === 'en_attente';
          const hasContent = ['generee_ia', 'non_conforme', 'relue', 'validee'].includes(page.statut_editorial || '');
          const isNonConforme = page.statut_editorial === 'non_conforme';

          return (
            <div className="flex gap-1.5 pt-2 border-t border-gray-100">
              {isGenerating ? (
                <>
                  <button
                    disabled
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-[#191E55]/50 bg-[#191E55]/5 rounded cursor-wait"
                  >
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Générer
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm('Annuler la génération en cours ?')) onReset(); }}
                    className="flex items-center justify-center px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-50 rounded transition-colors"
                    title="Annuler"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : hasContent ? (
                <>
                  <button
                    onClick={onOpenContent}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${isNonConforme ? 'text-red-600 hover:bg-red-50 border border-red-200' : 'text-[#191E55] hover:bg-[#191E55]/5'}`}
                    title={isNonConforme ? 'Erreur de génération — cliquez pour corriger' : 'Modifier le contenu'}
                  >
                    <DocumentTextIcon className="h-3.5 w-3.5" />
                    Éditer
                  </button>
                  {isNonConforme && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('Réinitialiser cette page ?')) onReset(); }}
                      className="flex items-center justify-center px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-50 rounded transition-colors"
                      title="Réinitialiser"
                    >
                      <ArrowPathIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={onOpenContent}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-[#191E55] hover:bg-[#191E55]/5 rounded transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Générer
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
