'use client';

import { useState, useEffect } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Guide {
  _id: string;
  name: string;
  year: number;
  version: string;
  language: string;
  status: string;
  destinations: string[];
  wpConfig?: {
    siteUrl: string;
    jwtToken: string;
  };
}

interface GuidesListProps {
  onCreateGuide: () => void;
  onEditGuide: (guide: Guide) => void;
}

export default function GuidesList({ onCreateGuide, onEditGuide }: GuidesListProps) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGuides();
  }, []);

  const fetchGuides = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/v1/guides`);
      const data = await response.json();
      setGuides(data.guides || []);
    } catch (error) {
      console.error('Erreur lors du chargement des guides:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce guide ?')) return;
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      await fetch(`${apiUrl}/api/v1/guides/${id}`, {
        method: 'DELETE',
      });
      fetchGuides();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-blue-100 text-blue-700',
      review: 'bg-yellow-100 text-yellow-700',
      ready: 'bg-green-100 text-green-700',
      published: 'bg-purple-100 text-purple-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: 'Brouillon',
      in_progress: 'En cours',
      review: 'En revue',
      ready: 'Prêt',
      published: 'Publié',
    };
    return labels[status] || status;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Guides touristiques</h1>
          <p className="text-gray-500 mt-1">
            {guides.length} guide{guides.length > 1 ? 's' : ''} • Triés par année
          </p>
        </div>
        <button
          onClick={onCreateGuide}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
        >
          <PlusIcon className="w-5 h-5" />
          Ajouter un guide
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        <button className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium">
          Tous
        </button>
        <button className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          Brouillons
        </button>
        <button className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          En cours
        </button>
        <button className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          Publiés
        </button>
      </div>

      {/* Guides list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : guides.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <BookOpenIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            Aucun guide
          </h3>
          <p className="text-gray-500 mb-4">
            Commencez par créer votre premier guide touristique
          </p>
          <button
            onClick={onCreateGuide}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <PlusIcon className="w-4 h-4" />
            Créer un guide
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Guide
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Année
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Destinations
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  WordPress
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {guides.map((guide) => (
                <tr key={guide._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <div className="font-medium text-gray-900">{guide.name}</div>
                      <div className="text-sm text-gray-500">v{guide.version}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {guide.year}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {guide.destinations?.length || 0} destination{(guide.destinations?.length || 0) > 1 ? 's' : ''}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(guide.status)}`}>
                      {getStatusLabel(guide.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {guide.wpConfig?.siteUrl ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm text-gray-600">Configuré</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                        <span className="text-sm text-gray-400">Non configuré</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onEditGuide(guide)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Modifier"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(guide._id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Supprimer"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
