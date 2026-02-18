'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, BookOpenIcon } from '@heroicons/react/24/outline';
import GuideBookCard from './guide/GuideBookCard';

interface Guide {
  _id: string;
  name: string;
  year: number;
  version: string;
  language: string;
  status: string;
  destinations: string[];
  image_principale?: string;
}

interface GuidesListProps {
  onCreateGuide: () => void;
  onEditGuide: (guide: Guide) => void;
}

export default function GuidesList({ onCreateGuide, onEditGuide }: GuidesListProps) {
  const router = useRouter();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchGuides();
  }, []);

  const fetchGuides = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/v1/guides`, {
        credentials: 'include',
      });
      const data = await response.json();
      setGuides(data.guides || []);
    } catch (error) {
      console.error('Erreur lors du chargement des guides:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredGuides = guides.filter(guide => {
    if (filter === 'all') return true;
    return guide.status === filter;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Guides touristiques</h1>
            <p className="text-gray-600">
              {filteredGuides.length} guide{filteredGuides.length > 1 ? 's' : ''} • Triés par année
            </p>
          </div>
          <button
            onClick={onCreateGuide}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-lg hover:shadow-xl font-medium"
          >
            <PlusIcon className="w-5 h-5" />
            Ajouter un guide
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Tous
          </button>
          <button
            onClick={() => setFilter('draft')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'draft'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Brouillons
          </button>
          <button
            onClick={() => setFilter('in_progress')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'in_progress'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            En cours
          </button>
          <button
            onClick={() => setFilter('published')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'published'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Publiés
          </button>
        </div>
      </div>

      {/* Guides grid */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="text-center py-24">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Chargement des guides...</p>
          </div>
        ) : filteredGuides.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl shadow-lg border border-gray-200">
            <BookOpenIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {filter === 'all' ? 'Aucun guide' : 'Aucun guide dans cette catégorie'}
            </h3>
            <p className="text-gray-600 mb-6">
              {filter === 'all'
                ? 'Commencez par créer votre premier guide touristique'
                : 'Changez de filtre ou créez un nouveau guide'}
            </p>
            {filter === 'all' && (
              <button
                onClick={onCreateGuide}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 shadow-lg hover:shadow-xl transition-all font-medium"
              >
                <PlusIcon className="w-5 h-5" />
                Créer un guide
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
            {filteredGuides.map((guide) => (
              <GuideBookCard key={guide._id} guide={guide} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
