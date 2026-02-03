'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import {
  SparklesIcon,
  ArrowPathIcon,
  MapPinIcon,
  LightBulbIcon,
  RectangleStackIcon,
} from '@heroicons/react/24/outline';

interface Section {
  section_id: string;
  section_nom: string;
  description_courte: string;
  articles_associes: string[];
}

interface POI {
  poi_id: string;
  nom: string;
  type: string;
  article_source: string;
  raison_selection: string;
}

interface Inspiration {
  theme_id: string;
  titre: string;
  angle_editorial: string;
  lieux_associes: string[];
}

interface SommaireProposalProps {
  guideId: string;
  apiUrl: string;
}

function ProposalCard({ id, type, title, description, icon: Icon, color }: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `proposal-${type}-${id}`,
    data: { type, id, title, description },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  const colorClasses = {
    blue: 'border-blue-200 hover:border-blue-400 bg-blue-50/50',
    green: 'border-green-200 hover:border-green-400 bg-green-50/50',
    orange: 'border-orange-200 hover:border-orange-400 bg-orange-50/50',
  };

  const iconColorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`p-3 bg-white border-2 rounded-lg cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${colorClasses[color as keyof typeof colorClasses]}`}
    >
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded flex-shrink-0 ${iconColorClasses[color as keyof typeof iconColorClasses]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 text-xs line-clamp-1">{title}</h4>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function SommaireProposal({ guideId, apiUrl }: SommaireProposalProps) {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<{
    sections: Section[];
    pois: POI[];
    inspirations: Inspiration[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadExistingProposal = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/sommaire-proposal`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
      }
    } catch (err) {
      console.log('Aucune proposition existante');
    }
  };

  const generateSommaire = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/generate-sommaire`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Erreur lors de la génération');
      }
    } catch (err) {
      console.error('Erreur génération sommaire:', err);
      setError('Erreur lors de la génération du sommaire');
    } finally {
      setLoading(false);
    }
  };

  // Charger proposition existante au montage
  useState(() => {
    loadExistingProposal();
  });

  return (
    <div className="h-full flex flex-col bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <SparklesIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Proposition IA</h3>
            <p className="text-xs text-gray-500">Générer le sommaire automatiquement</p>
          </div>
        </div>

        <button
          onClick={generateSommaire}
          disabled={loading}
          className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Génération en cours...' : 'Générer le sommaire'}
        </button>

        {error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
            {error}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!proposal && !loading && (
          <div className="text-center py-8">
            <SparklesIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium">Générer le sommaire</p>
            <p className="text-xs text-gray-400 mt-1">
              L'IA analysera vos articles WordPress
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <ArrowPathIcon className="w-12 h-12 text-blue-600 mx-auto mb-3 animate-spin" />
            <p className="text-sm text-gray-600 font-medium">Génération en cours...</p>
            <p className="text-xs text-gray-400 mt-1">Quelques minutes d'attente</p>
          </div>
        )}

        {proposal && (
          <>
            {/* Sections */}
            {proposal.sections && proposal.sections.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-2">
                  <RectangleStackIcon className="w-4 h-4 text-blue-600" />
                  <h4 className="font-semibold text-gray-700 text-xs uppercase tracking-wide">
                    Sections ({proposal.sections.length})
                  </h4>
                </div>
                <div className="space-y-2">
                  {proposal.sections.map((section) => (
                    <ProposalCard
                      key={section.section_id}
                      id={section.section_id}
                      type="section"
                      title={section.section_nom}
                      description={section.description_courte}
                      icon={RectangleStackIcon}
                      color="blue"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* POIs */}
            {proposal.pois && proposal.pois.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-2">
                  <MapPinIcon className="w-4 h-4 text-green-600" />
                  <h4 className="font-semibold text-gray-700 text-xs uppercase tracking-wide">
                    Lieux ({proposal.pois.length})
                  </h4>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {proposal.pois.map((poi) => (
                    <ProposalCard
                      key={poi.poi_id}
                      id={poi.poi_id}
                      type="poi"
                      title={poi.nom}
                      description={`${poi.type} — ${poi.raison_selection}`}
                      icon={MapPinIcon}
                      color="green"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Inspirations */}
            {proposal.inspirations && proposal.inspirations.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-2">
                  <LightBulbIcon className="w-4 h-4 text-orange-600" />
                  <h4 className="font-semibold text-gray-700 text-xs uppercase tracking-wide">
                    Inspiration ({proposal.inspirations.length})
                  </h4>
                </div>
                <div className="space-y-2">
                  {proposal.inspirations.map((inspiration) => (
                    <ProposalCard
                      key={inspiration.theme_id}
                      id={inspiration.theme_id}
                      type="inspiration"
                      title={inspiration.titre}
                      description={inspiration.angle_editorial}
                      icon={LightBulbIcon}
                      color="orange"
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {proposal && (
        <div className="p-3 border-t border-gray-200 bg-white">
          <p className="text-xs text-gray-500 text-center font-medium">
            🖱️ Glissez les cards dans le chemin de fer
          </p>
        </div>
      )}
    </div>
  );
}
