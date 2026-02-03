'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon, EyeIcon } from '@heroicons/react/24/outline';

interface Article {
  _id: string;
  title: string;
  slug: string;
  urls_by_lang: Record<string, string>;
  images?: string[];
  categories?: string[];
  tags?: string[];
  updated_at: string;
}

interface ArticlesTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
  onArticlesImported?: () => void;
}

export default function ArticlesTab({ guideId, guide, apiUrl, onArticlesImported }: ArticlesTabProps) {
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionError, setIngestionError] = useState<string | null>(null);

  useEffect(() => {
    loadArticles();
  }, [guideId]);

  const loadArticles = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
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
      languages: guide.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'],
    };

    try {
      const enqueueRes = await fetch(`${apiUrl}/api/v1/ingest/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const enqueueData = await enqueueRes.json().catch(() => ({}));

      if (enqueueRes.status === 202 && enqueueData.jobId) {
        const jobId = enqueueData.jobId;
        setIngestionStatus("En file d'attente...");
        const pollIntervalMs = 2500;
        const maxPollCount = 240;
        let pollCount = 0;

        const pollStatus = async () => {
          try {
            const statusRes = await fetch(`${apiUrl}/api/v1/ingest/status/${jobId}`, {
              credentials: 'include',
            });
            const statusData = await statusRes.json();

            if (statusData.status === 'completed') {
              setIngestionStatus('Récupération terminée !');
              setIngesting(false);
              await loadArticles();
              onArticlesImported?.();
              return;
            } else if (statusData.status === 'failed') {
              setIngestionError(statusData.error || 'Erreur lors de la récupération');
              setIngesting(false);
              return;
            } else if (statusData.status === 'running') {
              setIngestionStatus('Récupération en cours...');
            }

            pollCount++;
            if (pollCount < maxPollCount) {
              setTimeout(pollStatus, pollIntervalMs);
            } else {
              setIngestionError('Timeout : vérifiez les logs');
              setIngesting(false);
            }
          } catch (err) {
            console.error('Erreur poll:', err);
            setIngestionError('Erreur lors du suivi');
            setIngesting(false);
          }
        };

        setTimeout(pollStatus, pollIntervalMs);
      } else {
        const ingestRes = await fetch(`${apiUrl}/api/v1/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });

        if (ingestRes.ok) {
          const data = await ingestRes.json();
          setIngestionStatus(`Récupération terminée ! ${data.totalArticles || 0} articles`);
          loadArticles();
        } else {
          const errorData = await ingestRes.json().catch(() => ({}));
          setIngestionError(errorData.error || 'Erreur lors de la récupération');
        }
        setIngesting(false);
      }
    } catch (err) {
      console.error('Erreur ingestion:', err);
      setIngestionError('Erreur lors de la récupération');
      setIngesting(false);
    }
  };

  const languages = guide?.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];

  return (
    <div>
      {/* Actions */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Articles WordPress</h2>
          <p className="text-sm text-gray-600 mt-1">
            {articles.length} articles récupérés
          </p>
        </div>
        <button
          onClick={launchIngestion}
          disabled={ingesting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <ArrowPathIcon className={`h-5 w-5 ${ingesting ? 'animate-spin' : ''}`} />
          {ingesting ? 'Récupération...' : 'Récupérer les articles'}
        </button>
      </div>

      {/* Status */}
      {ingestionStatus && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">{ingestionStatus}</p>
        </div>
      )}

      {ingestionError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{ingestionError}</p>
        </div>
      )}

      {/* Liste des articles */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : articles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          Aucun article. Cliquez sur "Récupérer les articles" pour démarrer.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Titre
                </th>
                {languages.map((lang: string) => (
                  <th key={lang} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    {lang.toUpperCase()}
                  </th>
                ))}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {articles.map((article) => (
                <tr key={article._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{article.title}</div>
                    <div className="text-sm text-gray-500">{article.slug}</div>
                  </td>
                  {languages.map((lang: string) => (
                    <td key={lang} className="px-3 py-4 text-center">
                      {article.urls_by_lang?.[lang] ? (
                        <a
                          href={article.urls_by_lang[lang]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          🔗
                        </a>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  ))}
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => router.push(`/guides/${guideId}/articles/${article._id}`)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <EyeIcon className="h-5 w-5" />
                    </button>
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
