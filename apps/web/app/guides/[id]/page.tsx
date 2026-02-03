'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';
import ArticlesTab from '@/components/guide/ArticlesTab';
import CheminDeFerTab from '@/components/guide/CheminDeFerTab';

export default function GuideDetailPage() {
  const router = useRouter();
  const params = useParams();
  const guideId = params.id as string;

  const [guide, setGuide] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'articles' | 'chemin-de-fer'>('chemin-de-fer');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadGuide();
  }, [guideId]);

  const loadGuide = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setGuide(data);
      }
    } catch (err) {
      console.error('Erreur chargement guide:', err);
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

  if (!guide) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Guide introuvable</div>
      </div>
    );
  }

  const tabs = [
    { id: 'chemin-de-fer', label: 'Chemin de fer', count: guide.chemin_de_fer?.nombre_pages || 0 },
    { id: 'articles', label: 'Articles WordPress', count: null },
  ];

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-8 py-6">
          <button
            onClick={() => router.push('/guides')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Retour aux guides
          </button>
          
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{guide.name}</h1>
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
              <span>Version {guide.year}</span>
              <span>•</span>
              <span className="capitalize">{guide.status}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-6 flex gap-4 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-4 px-2 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
                {tab.count !== null && (
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-8">
          {activeTab === 'articles' && (
            <ArticlesTab guideId={guideId} guide={guide} apiUrl={apiUrl} />
          )}
          {activeTab === 'chemin-de-fer' && (
            <CheminDeFerTab guideId={guideId} cheminDeFer={guide.chemin_de_fer} apiUrl={apiUrl} />
          )}
        </div>
      </main>
    </div>
  );
}
