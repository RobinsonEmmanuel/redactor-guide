'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, PencilIcon, EyeIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface Guide {
  _id: string;
  name: string;
  slug: string;
  year: number;
  version: string;
  language: string;
  status: string;
  destinations?: string[];
  createdAt?: string;
}

export default function GuidesPage() {
  const router = useRouter();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadGuides();
  }, []);

  const loadGuides = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setGuides(data.guides || []);
      }
    } catch (err) {
      console.error('Erreur chargement guides:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, string> = {
    draft: 'Brouillon',
    in_progress: 'En cours',
    review: 'Révision',
    ready: 'Prêt',
    published: 'Publié',
    archived: 'Archivé',
  };

  const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-blue-100 text-blue-700',
    review: 'bg-yellow-100 text-yellow-700',
    ready: 'bg-green-100 text-green-700',
    published: 'bg-green-600 text-white',
    archived: 'bg-gray-400 text-white',
  };

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Guides</h1>
            <p className="mt-2 text-gray-600">
              {guides.length} guide{guides.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => router.push('/guides/new')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            Nouveau guide
          </button>
        </div>

        {/* Liste vide */}
        {guides.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-4">Aucun guide</div>
            <button
              onClick={() => router.push('/guides/new')}
              className="text-blue-600 hover:underline"
            >
              Créer votre premier guide
            </button>
          </div>
        )}

        {/* Grille de guides */}
        {guides.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {guides.map((guide) => (
              <div
                key={guide._id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/guides/${guide._id}`)}
              >
                {/* Header */}
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    {guide.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="font-medium">{guide.year}</span>
                    <span>•</span>
                    <span className="uppercase">{guide.language}</span>
                  </div>
                </div>

                {/* Statut */}
                <div className="mb-4">
                  <span
                    className={`inline-block px-3 py-1 text-xs font-medium rounded-full ${
                      STATUS_COLORS[guide.status] || STATUS_COLORS.draft
                    }`}
                  >
                    {STATUS_LABELS[guide.status] || guide.status}
                  </span>
                </div>

                {/* Info */}
                <div className="text-sm text-gray-500 mb-4">
                  <div>Version {guide.version}</div>
                  {guide.destinations && guide.destinations.length > 0 && (
                    <div className="mt-1">
                      {guide.destinations.length} destination{guide.destinations.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t border-gray-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/guides/${guide._id}`);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <EyeIcon className="h-4 w-4" />
                    Voir
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/guides/${guide._id}/edit`);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <PencilIcon className="h-4 w-4" />
                    Modifier
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
