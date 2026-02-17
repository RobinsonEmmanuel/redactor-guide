'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';
import ArticlesTab from '@/components/guide/ArticlesTab';
import MatchingClusterTab from '@/components/guide/MatchingClusterTab';
import CheminDeFerTab from '@/components/guide/CheminDeFerTab';

export default function GuideDetailPage() {
  const router = useRouter();
  const params = useParams();
  const guideId = params.id as string;

  const [guide, setGuide] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'articles' | 'matching-cluster' | 'chemin-de-fer'>('articles');
  const [articlesCount, setArticlesCount] = useState<number>(0);
  const [hasCheckedArticles, setHasCheckedArticles] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadGuide();
    checkArticles();
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

  const checkArticles = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setArticlesCount(data.articles?.length || 0);
        setHasCheckedArticles(true);
      }
    } catch (err) {
      console.error('Erreur vérification articles:', err);
      setHasCheckedArticles(true);
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

  const canAccessCheminDeFer = articlesCount > 0;
  const canAccessMatchingCluster = articlesCount > 0;

  const tabs = [
    { id: 'articles', label: 'Articles WordPress', count: articlesCount },
    { 
      id: 'matching-cluster', 
      label: 'Matching Cluster', 
      count: null,
      disabled: !canAccessMatchingCluster 
    },
    { 
      id: 'chemin-de-fer', 
      label: 'Chemin de fer', 
      count: null, // Pas de compteur : 1 chemin de fer par guide
      disabled: !canAccessCheminDeFer 
    },
  ];

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto flex flex-col">
        {/* Header compact */}
        <div className="border-b border-gray-200 bg-white px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/guides')}
                className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
              >
                <ArrowLeftIcon className="h-4 w-4" />
              </button>
              
              <div className="border-l border-gray-300 pl-4">
                <h1 className="text-xl font-bold text-gray-900">{guide.name}</h1>
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>Version {guide.year}</span>
                  <span>•</span>
                  <span className="capitalize">{guide.status}</span>
                </div>
              </div>
            </div>

            {/* Tabs inline à droite */}
            <div className="flex gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => !tab.disabled && setActiveTab(tab.id as any)}
                  disabled={tab.disabled}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    tab.disabled
                      ? 'text-gray-400 cursor-not-allowed opacity-50 bg-gray-50'
                      : activeTab === tab.id
                      ? 'text-white bg-blue-600'
                      : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                  }`}
                  title={tab.disabled ? 'Récupérez d\'abord les articles WordPress' : ''}
                >
                  {tab.label}
                  {tab.count !== null && tab.count !== undefined && (
                    <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                      tab.disabled 
                        ? 'bg-gray-200 text-gray-400' 
                        : activeTab === tab.id
                        ? 'bg-blue-700 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content - prend tout l'espace restant */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'articles' && (
            <div className="h-full p-6">
              <ArticlesTab guideId={guideId} guide={guide} apiUrl={apiUrl} onArticlesImported={checkArticles} />
            </div>
          )}
          {activeTab === 'matching-cluster' && canAccessMatchingCluster && (
            <MatchingClusterTab guideId={guideId} apiUrl={apiUrl} />
          )}
          {activeTab === 'matching-cluster' && !canAccessMatchingCluster && (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center max-w-md">
                <div className="text-yellow-800 font-medium mb-2">
                  📝 Récupération des articles WordPress requise
                </div>
                <p className="text-yellow-700 text-sm mb-4">
                  Pour effectuer le matching cluster, vous devez d'abord récupérer les articles WordPress de ce guide.
                </p>
                <button
                  onClick={() => setActiveTab('articles')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Aller aux articles WordPress
                </button>
              </div>
            </div>
          )}
          {activeTab === 'chemin-de-fer' && canAccessCheminDeFer && (
            <CheminDeFerTab guideId={guideId} cheminDeFer={guide.chemin_de_fer} apiUrl={apiUrl} />
          )}
          {activeTab === 'chemin-de-fer' && !canAccessCheminDeFer && (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center max-w-md">
                <div className="text-yellow-800 font-medium mb-2">
                  📝 Récupération des articles WordPress requise
                </div>
                <p className="text-yellow-700 text-sm mb-4">
                  Pour créer le chemin de fer, vous devez d'abord récupérer les articles WordPress de ce guide.
                </p>
                <button
                  onClick={() => setActiveTab('articles')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Aller aux articles WordPress
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
