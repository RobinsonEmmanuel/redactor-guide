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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`p-4 bg-white border-2 border-${color}-200 rounded-lg shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition-all`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 bg-${color}-100 rounded-lg flex-shrink-0`}>
          <Icon className={`w-5 h-5 text-${color}-600`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 text-sm truncate">{title}</h4>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{description}</p>
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
    <div className="h-full flex flex-col bg-gradient-to-br from-purple-50 to-blue-50 border-l border-gray-200">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-purple-100 rounded-lg">
            <SparklesIcon className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Proposition IA</h3>
            <p className="text-xs text-gray-500">Générer le sommaire automatiquement</p>
          </div>
        </div>

        <button
          onClick={generateSommaire}
          disabled={loading}
          className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
        >
          <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Génération en cours...' : 'Générer le sommaire'}
        </button>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!proposal && !loading && (
          <div className="text-center py-12">
            <SparklesIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-sm text-gray-500">Cliquez sur "Générer le sommaire"</p>
            <p className="text-xs text-gray-400 mt-2">
              L'IA analysera vos articles WordPress et proposera une structure
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <ArrowPathIcon className="w-16 h-16 text-purple-600 mx-auto mb-4 animate-spin" />
            <p className="text-sm text-gray-600 font-medium">Génération en cours...</p>
            <p className="text-xs text-gray-400 mt-2">Cela peut prendre quelques minutes</p>
          </div>
        )}

        {proposal && (
          <>
            {/* Sections */}
            {proposal.sections && proposal.sections.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <RectangleStackIcon className="w-5 h-5 text-blue-600" />
                  <h4 className="font-semibold text-gray-900 text-sm">
                    Sections ({proposal.sections.length})
                  </h4>
                </div>
                <div className="space-y-3">
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
                <div className="flex items-center gap-2 mb-3">
                  <MapPinIcon className="w-5 h-5 text-green-600" />
                  <h4 className="font-semibold text-gray-900 text-sm">
                    Lieux (POI) ({proposal.pois.length})
                  </h4>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
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
                <div className="flex items-center gap-2 mb-3">
                  <LightBulbIcon className="w-5 h-5 text-amber-600" />
                  <h4 className="font-semibold text-gray-900 text-sm">
                    Pages inspiration ({proposal.inspirations.length})
                  </h4>
                </div>
                <div className="space-y-3">
                  {proposal.inspirations.map((inspiration) => (
                    <ProposalCard
                      key={inspiration.theme_id}
                      id={inspiration.theme_id}
                      type="inspiration"
                      title={inspiration.titre}
                      description={inspiration.angle_editorial}
                      icon={LightBulbIcon}
                      color="amber"
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
        <div className="p-4 border-t border-gray-200 bg-white/80">
          <p className="text-xs text-gray-500 text-center">
            💡 Glissez-déposez les cards dans le chemin de fer
          </p>
        </div>
      )}
    </div>
  );
}
