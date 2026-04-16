'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon, EyeIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface Article {
  _id: string;
  title: string;
  titre: string;
  slug: string;
  urls_by_lang: Record<string, string>;
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
  const [displayedArticles, setDisplayedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    status: string; step: string; processed: number; total: number;
  } | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  // Ajout d'un article par URL
  const [singleUrl, setSingleUrl] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<{ title: string; inserted: boolean; updated: boolean; imagesCount: number } | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  useEffect(() => {
    loadArticles();
  }, [guideId, pagination.page]);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/articles?page=${pagination.page}&limit=${pagination.limit}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setDisplayedArticles(data.articles || []);
        
        if (data.pagination) {
          setPagination(prev => ({ 
            ...prev, 
            total: data.pagination.total,
            totalPages: data.pagination.totalPages
          }));
        }
      }
    } catch (err) {
      console.error('Erreur chargement articles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const launchIngestion = async () => {
    if (!guide?.slug) {
      setIngestionError('Slug du guide manquant');
      return;
    }

    setIngesting(true);
    setIngestionError(null);
    setIngestionStatus('Démarrage de la récupération...');
    setProgress(null);

    // Polling de la progression (toutes les 1,5 s)
    let stopPolling = false;
    const pollProgress = async () => {
      while (!stopPolling) {
        await new Promise(r => setTimeout(r, 1500));
        if (stopPolling) break;
        try {
          const res = await fetch(`${apiUrl}/api/v1/ingest/progress`, { credentials: 'include' });
          if (res.ok) {
            const p = await res.json();
            setProgress(p);
            if (p.status === 'done' || p.status === 'error') break;
          }
        } catch { break; }
      }
    };
    pollProgress();
    const stopPoll = () => { stopPolling = true; };

    // siteUrl uniquement si valide (évite les erreurs de validation Zod .url())
    const rawSiteUrl = guide.wpConfig?.siteUrl?.trim() ?? '';
    const siteUrl = rawSiteUrl && !/^https?:\/\//i.test(rawSiteUrl)
      ? `https://${rawSiteUrl}`
      : rawSiteUrl || undefined;

    const payload: Record<string, unknown> = {
      siteId: guide.slug,
      destinationIds: guide.destinations || [],
      ...(siteUrl ? { siteUrl } : {}),
      languages: guide.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'],
    };

    console.log('[Ingestion] payload →', payload);

    try {
      const enqueueRes = await fetch(`${apiUrl}/api/v1/ingest/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const enqueueData = await enqueueRes.json().catch(() => ({}));
      if (!enqueueRes.ok) console.warn('[Ingestion] enqueue 400 →', JSON.stringify(enqueueData, null, 2));

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
          setIngestionStatus(`Récupération terminée ! ${data.count ?? data.totalArticles ?? 0} articles traités`);
          await loadArticles();
          onArticlesImported?.();
        } else {
          const errorData = await ingestRes.json().catch(() => ({}));
          console.warn('[Ingestion] /ingest 400 →', JSON.stringify(errorData, null, 2));
          const detail = errorData.details
            ? JSON.stringify(errorData.details).slice(0, 200)
            : '';
          setIngestionError(`${errorData.error || 'Erreur lors de la récupération'}${detail ? ` — ${detail}` : ''}`);
        }
        stopPoll();
        setIngesting(false);
      }
    } catch (err) {
      console.error('Erreur ingestion:', err);
      setIngestionError('Erreur lors de la récupération');
      stopPoll();
      setIngesting(false);
    }
  };

  const handleSingleUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleUrl.trim()) return;
    if (!guide?.slug) {
      setSingleError('Slug du guide manquant');
      return;
    }

    setSingleLoading(true);
    setSingleError(null);
    setSingleResult(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/ingest/single-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          siteId:         guide.slug,
          ...(guide.wpConfig?.siteUrl ? { siteUrl: guide.wpConfig.siteUrl } : {}),
          articleUrl:     singleUrl.trim(),
          destinationIds: guide.destinations || [],
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSingleError(data.error || 'Erreur lors de l\'ajout');
      } else {
        setSingleResult(data);
        setSingleUrl('');
        await loadArticles();
        onArticlesImported?.();
      }
    } catch {
      setSingleError('Erreur réseau lors de l\'ajout');
    } finally {
      setSingleLoading(false);
    }
  };

  const languages = guide?.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];

  return (
    <div>
      {/* En-tête + boutons principaux */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Articles WordPress</h2>
            <p className="text-sm text-gray-600 mt-1">
              {pagination.total} article{pagination.total > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={launchIngestion}
              disabled={ingesting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              title="Relance l'ingestion complète et récupère les nouveaux articles"
            >
              <ArrowPathIcon className={`h-5 w-5 ${ingesting ? 'animate-spin' : ''}`} />
              {ingesting ? 'Actualisation...' : pagination.total === 0 ? 'Récupérer les articles' : 'Actualiser'}
            </button>
          </div>
        </div>

        {/* Barre de progression de l'ingestion */}
        {ingesting && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-800">
                {progress?.step || 'Démarrage…'}
              </span>
              {progress && progress.total > 0 && (
                <span className="text-sm text-blue-600 tabular-nums">
                  {progress.processed} / {progress.total}
                </span>
              )}
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2.5 overflow-hidden">
              {progress && progress.total > 0 ? (
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
                />
              ) : (
                <div className="bg-blue-400 h-2.5 rounded-full animate-pulse" style={{ width: '60%' }} />
              )}
            </div>
            {progress && progress.total > 0 && (
              <p className="mt-1.5 text-xs text-blue-500 text-right">
                {Math.round((progress.processed / progress.total) * 100)} %
              </p>
            )}
          </div>
        )}

        {/* Message de statut (succès / erreur) */}
        {!ingesting && ingestionStatus && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            {ingestionStatus}
          </div>
        )}
        {ingestionError && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {ingestionError}
          </div>
        )}

        {/* Ajout d'un article par URL */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Ajouter un article par URL
          </p>
          <p className="text-xs text-gray-500 mb-3">
            Colle l&apos;URL d&apos;un article WordPress pour l&apos;ingérer immédiatement sans relancer la récupération complète.
          </p>
          <form onSubmit={handleSingleUrl} className="flex gap-2">
            <input
              type="url"
              value={singleUrl}
              onChange={e => { setSingleUrl(e.target.value); setSingleResult(null); setSingleError(null); }}
              placeholder="https://canarias-lovers.com/que-faire-candelaria-tenerife/"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={singleLoading}
            />
            <button
              type="submit"
              disabled={singleLoading || !singleUrl.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <PlusIcon className={`h-4 w-4 ${singleLoading ? 'animate-spin' : ''}`} />
              {singleLoading ? 'Ajout...' : 'Ajouter'}
            </button>
          </form>

          {singleResult && (
            <div className="mt-2 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              <CheckCircleIcon className="h-4 w-4 shrink-0" />
              <span>
                <strong>&laquo;{singleResult.title}&raquo;</strong>{' '}
                {singleResult.inserted ? 'ajouté' : singleResult.updated ? 'mis à jour' : 'déjà à jour'}{' '}
                · {singleResult.imagesCount} image{singleResult.imagesCount > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {singleError && (
            <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {singleError}
            </div>
          )}
        </div>
      </div>

      {/* Liste des articles */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : displayedArticles.length === 0 ? (
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
              {displayedArticles.map((article) => (
                <tr key={article._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{article.title || article.titre}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{article.slug}</span>
                      {article.categories?.map((cat) => (
                        <span key={cat} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 rounded">
                          {cat}
                        </span>
                      ))}
                    </div>
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
