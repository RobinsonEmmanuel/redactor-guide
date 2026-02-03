'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon, EyeIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

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
  const [allArticles, setAllArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filterByDestination, setFilterByDestination] = useState(true);

  useEffect(() => {
    loadArticles(1);
  }, [guideId, filterByDestination]);

  const loadArticles = async (page: number = pagination.page) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/articles?page=${page}&limit=${pagination.limit}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        const fetchedArticles = data.articles || [];
        setAllArticles(fetchedArticles);
        
        // Filtrer par destination si activé
        const filtered = filterByDestination && guide?.destination
          ? fetchedArticles.filter((article: Article) => 
              article.categories?.some(cat => 
                cat.toLowerCase() === guide.destination.toLowerCase()
              )
            )
          : fetchedArticles;
        
        setArticles(filtered);
        setPagination(prev => ({ 
          ...prev,
          total: data.pagination?.total || filtered.length,
          totalPages: Math.ceil(filtered.length / prev.limit)
        }));
      }
    } catch (err) {
      console.error('Erreur chargement articles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadArticles(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Articles WordPress</h2>
            <p className="text-sm text-gray-600 mt-1">
              {pagination.total} article{pagination.total > 1 ? 's' : ''}
              {filterByDestination && guide?.destination && (
                <span className="ml-2 text-blue-600">
                  (filtré par catégorie "{guide.destination}")
                </span>
              )}
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

        {/* Filtre destination */}
        {guide?.destination && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterByDestination}
                onChange={(e) => setFilterByDestination(e.target.checked)}
                className="rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-blue-900 font-medium">
                Afficher uniquement les articles de la destination "{guide.destination}"
              </span>
            </label>
            {!filterByDestination && (
              <span className="ml-auto text-xs text-blue-700">
                ({allArticles.length} articles au total)
              </span>
            )}
          </div>
        )}
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

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Affichage {((pagination.page - 1) * pagination.limit) + 1} à{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} sur {pagination.total}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>

                {/* Numéros de page */}
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    let pageNum;
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (pagination.page <= 3) {
                      pageNum = i + 1;
                    } else if (pagination.page >= pagination.totalPages - 2) {
                      pageNum = pagination.totalPages - 4 + i;
                    } else {
                      pageNum = pagination.page - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-1 rounded-lg text-sm font-medium ${
                          pagination.page === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-700 hover:bg-gray-50 border border-gray-300'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
