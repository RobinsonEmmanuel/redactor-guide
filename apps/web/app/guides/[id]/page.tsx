'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface Article {
  _id: string;
  title: string;
  wpml_urls: Record<string, string>;
  categories?: string[];
  tags?: string[];
  updated_at: string;
}

export default function GuideDetailPage() {
  const router = useRouter();
  const params = useParams();
  const guideId = params.id as string;

  const [guide, setGuide] = useState<any>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionError, setIngestionError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadGuide();
    loadArticles();
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

  const loadArticles = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles || []);
      }
    } catch (err) {
      console.error('Erreur chargement articles:', err);
    }
  };

  const launchIngestion = async () => {
    if (!guide?.wpConfig?.siteUrl || !guide?.wpConfig?.jwtToken) {
      setIngestionError('Configuration WordPress manquante');
      return;
    }

    setIngesting(true);
    setIngestionError(null);
    setIngestionStatus('Démarrage de la récupération...');

    const payload = {
      siteId: guide.slug,
      destinationIds: guide.destinations || [],
      siteUrl: guide.wpConfig.siteUrl,
      jwtToken: guide.wpConfig.jwtToken,
    };

    try {
      // Tenter la file d'attente
      const enqueueRes = await fetch(`${apiUrl}/api/v1/ingest/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const enqueueData = await enqueueRes.json().catch(() => ({}));

      if (enqueueRes.status === 202 && enqueueData.jobId) {
        // Queue active : poll
        const jobId = enqueueData.jobId;
        setIngestionStatus("En file d'attente...");
        const pollIntervalMs = 2500;
        const maxAttempts = 600;
        let attempts = 0;

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          const statusRes = await fetch(`${apiUrl}/api/v1/ingest/status/${jobId}`, {
            credentials: 'include',
          });
          const statusData = await statusRes.json().catch(() => ({}));

          if (statusData.status === 'processing') {
            setIngestionStatus('Récupération en cours...');
          }
          if (statusData.status === 'completed') {
            setIngestionStatus(`✅ ${statusData.result?.count || 0} articles récupérés`);
            setIngesting(false);
            loadArticles(); // Rafraîchir la liste
            return;
          }
          if (statusData.status === 'failed') {
            setIngestionError(statusData.error || 'Échec de la récupération');
            setIngesting(false);
            return;
          }
          attempts += 1;
        }
        setIngestionError('Délai dépassé');
        setIngesting(false);
        return;
      }

      if (enqueueRes.status === 503) {
        // Fallback synchrone
        setIngestionStatus('Mode synchrone...');
        const syncRes = await fetch(`${apiUrl}/api/v1/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const syncData = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok) {
          setIngestionError(syncData.error || `Erreur ${syncRes.status}`);
        } else {
          setIngestionStatus(`✅ ${syncData.count || 0} articles récupérés`);
          loadArticles();
        }
        setIngesting(false);
        return;
      }

      setIngestionError(enqueueData.error || enqueueData.message || `Erreur ${enqueueRes.status}`);
      setIngesting(false);
    } catch (err) {
      setIngestionError(err instanceof Error ? err.message : 'Erreur réseau');
      setIngesting(false);
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

  const languages = ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru'];

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Retour aux guides
          </button>

          <h1 className="text-3xl font-bold text-gray-900">{guide.name}</h1>
          <p className="text-gray-500 mt-1">
            {guide.slug} · Année {guide.year}
          </p>
        </div>

        {/* Info guide */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Configuration</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">Site WordPress :</span>
              <span className="ml-2 text-gray-600">{guide.wpConfig?.siteUrl || 'Non configuré'}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">JWT Token :</span>
              <span className="ml-2 text-gray-600">{guide.wpConfig?.jwtToken ? '✓ Configuré' : '✗ Manquant'}</span>
            </div>
          </div>
        </div>

        {/* Récupération */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Récupération des articles</h2>
            <button
              onClick={launchIngestion}
              disabled={ingesting || !guide.wpConfig?.siteUrl || !guide.wpConfig?.jwtToken}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowPathIcon className={`w-5 h-5 ${ingesting ? 'animate-spin' : ''}`} />
              {ingesting ? 'Récupération en cours...' : 'Récupérer les articles WordPress'}
            </button>
          </div>

          {ingestionStatus && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg mb-4">
              {ingestionStatus}
            </div>
          )}

          {ingestionError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg">
              {ingestionError}
            </div>
          )}
        </div>

        {/* Liste des articles */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Articles récupérés ({articles.length})
          </h2>

          {articles.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Aucun article récupéré pour l'instant. Cliquez sur "Récupérer les articles WordPress" pour démarrer.
            </p>
          ) : (
            <div className="space-y-4">
              {articles.map((article) => (
                <div key={article._id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">{article.title}</h3>
                  
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {languages.map((lang) => {
                      const url = article.wpml_urls?.[lang];
                      return (
                        <div key={lang} className="flex items-center gap-2">
                          <span className="font-mono text-gray-500 uppercase text-xs w-6">{lang}:</span>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline truncate flex-1"
                            >
                              {url}
                            </a>
                          ) : (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(article.categories?.length || article.tags?.length) ? (
                    <div className="mt-3 flex gap-4 text-xs">
                      {article.categories && article.categories.length > 0 && (
                        <div>
                          <span className="font-medium text-gray-600">Catégories:</span>{' '}
                          <span className="text-gray-500">{article.categories.join(', ')}</span>
                        </div>
                      )}
                      {article.tags && article.tags.length > 0 && (
                        <div>
                          <span className="font-medium text-gray-600">Tags:</span>{' '}
                          <span className="text-gray-500">{article.tags.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
