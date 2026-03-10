'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PencilIcon, TrashIcon, Bars3Icon, DocumentTextIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

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

// ── Couleur par type de page ─────────────────────────────────────────────────
const tplUpper = (tpl: string) => tpl.toUpperCase();

function getPageTypeMeta(page: Page): { label: string; leftBorder: string; badgeClass: string; thumbBg: string } {
  const tpl = tplUpper(page.template_name || '');
  const type = (page.type_de_page || '').toLowerCase();

  if (type.startsWith('poi') || tpl.startsWith('POI') || tpl.match(/^[A-Z]-POI/)) {
    return { label: 'POI', leftBorder: 'border-l-4 border-l-blue-400', badgeClass: 'bg-blue-100 text-blue-700', thumbBg: 'bg-blue-50' };
  }
  if (type === 'cluster' || tpl.includes('CLUSTER')) {
    return { label: 'Cluster', leftBorder: 'border-l-4 border-l-green-400', badgeClass: 'bg-green-100 text-green-700', thumbBg: 'bg-green-50' };
  }
  if (type === 'inspiration' || tpl.startsWith('INSPIRATION') || tpl.match(/^[A-Z]-INSPIRATION/)) {
    return { label: 'Inspiration', leftBorder: 'border-l-4 border-l-orange-400', badgeClass: 'bg-orange-100 text-orange-700', thumbBg: 'bg-orange-50' };
  }
  if (tpl.startsWith('SAISON') || tpl.match(/^[A-Z]-SAISON/) || tpl.match(/^I-SAISON/)) {
    return { label: 'Saison', leftBorder: 'border-l-4 border-l-purple-400', badgeClass: 'bg-purple-100 text-purple-700', thumbBg: 'bg-purple-50' };
  }
  return { label: '', leftBorder: 'border-l-4 border-l-gray-300', badgeClass: 'bg-gray-100 text-gray-600', thumbBg: 'bg-gray-100' };
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
  const statusLabel = STATUS_LABELS[page.statut_editorial || 'draft'];
  
  const { label: typeLabel, leftBorder, badgeClass, thumbBg } = getPageTypeMeta(page);

  // Déterminer la bordure et l'effet selon le statut
  const isGenerating = page.statut_editorial === 'en_attente';
  const isGenerated = page.statut_editorial === 'generee_ia';
  const isNonConforme = page.statut_editorial === 'non_conforme';
  const isValidated = page.statut_editorial === 'validee';
  
  let cardBorderClass = 'border-gray-200';
  let cardExtraClass = '';
  
  if (isGenerating) {
    cardBorderClass = 'border-blue-300 shadow-blue-100';
    cardExtraClass = 'animate-pulse-slow ring-2 ring-blue-200';
  } else if (isNonConforme) {
    cardBorderClass = 'border-red-300';
    cardExtraClass = 'ring-1 ring-red-200';
  } else if (isGenerated) {
    cardBorderClass = 'border-blue-200';
  } else if (isValidated) {
    cardBorderClass = 'border-green-300';
    cardExtraClass = 'ring-1 ring-green-100';
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border overflow-hidden hover:shadow-lg transition-all group ${cardBorderClass} ${cardExtraClass} ${leftBorder}`}
    >
      {/* Miniature avec image de fond si disponible - TOUTE LA ZONE EST DRAGGABLE */}
      <div 
        className={`h-32 relative flex items-center justify-center cursor-grab active:cursor-grabbing ${!page.image_url ? thumbBg : ''}`}
        style={{
          backgroundImage: page.image_url ? `url(${page.image_url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
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
        
        {/* Icône drag (indicateur visuel au centre) */}
        <div className="pointer-events-none">
          <Bars3Icon className={`h-8 w-8 ${page.image_url ? 'text-white/70 drop-shadow-md' : 'text-gray-300'}`} />
        </div>
        
        {/* Pastille de statut (bottom-left) */}
        <div className={`absolute bottom-2 left-2 w-2.5 h-2.5 rounded-full border border-white shadow-md pointer-events-none ${
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

        {/* Type de page + Statut sur la même ligne */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {typeLabel && (
            <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide ${badgeClass}`}>
              {typeLabel}
            </span>
          )}
          <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Coordonnées GPS */}
        {page.coordinates && (
          <div className="text-[10px] text-gray-400 font-mono mb-3 flex items-center gap-1">
            <span>📍</span>
            <span title={page.coordinates.display_name || 'Coordonnées GPS'}>
              {page.coordinates.lat.toFixed(5)}, {page.coordinates.lon.toFixed(5)}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          {/* Bouton Rédiger avec état visuel selon statut */}
          {(() => {
            const isGenerating = page.statut_editorial === 'en_attente';
            const isGenerated = page.statut_editorial === 'generee_ia';
            const isNonConforme = page.statut_editorial === 'non_conforme';
            const hasContent = isGenerated || isNonConforme || page.statut_editorial === 'relue' || page.statut_editorial === 'validee';
            
            if (isGenerating) {
              return (
                <>
                  <button
                    onClick={onOpenContent}
                    disabled
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded cursor-wait"
                    title="Génération en cours..."
                  >
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Génération...
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Annuler la génération en cours ?')) {
                        onReset();
                      }
                    }}
                    className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded transition-colors"
                    title="Annuler la génération"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              );
            }
            
            if (isNonConforme) {
              return (
                <>
                  <button
                    onClick={onOpenContent}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors border border-red-200"
                    title="Erreur de génération - Cliquez pour corriger"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Corriger
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Réinitialiser cette page (supprime le contenu et passe en brouillon) ?')) {
                        onReset();
                      }
                    }}
                    className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded transition-colors"
                    title="Réinitialiser"
                  >
                    <ArrowPathIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              );
            }
            
            if (hasContent) {
              return (
                <>
                  <button
                    onClick={onOpenContent}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 rounded transition-colors"
                    title="Modifier le contenu généré"
                  >
                    <DocumentTextIcon className="h-3.5 w-3.5" />
                    Éditer
                  </button>
                  <button
                    onClick={onEdit}
                    className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded transition-colors"
                    title="Modifier les paramètres"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              );
            }
            
            return (
              <>
                <button
                  onClick={onOpenContent}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title="Générer le contenu automatiquement"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Générer
                </button>
                <button
                  onClick={onEdit}
                  className="flex items-center justify-center px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded transition-colors"
                  title="Modifier les paramètres"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
