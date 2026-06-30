'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowPathIcon,
  EyeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  CheckCircleIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

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

  // Articles
  const [displayedArticles, setDisplayedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  // Catégories
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [savedCategories, setSavedCategories] = useState<string[] | null>(null);
  const [categoriesDirty, setCategoriesDirty] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  // Ingestion
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionError, setIngestionError] = useState<string | null>(null);

  // Ajout par URL
  const [singleUrl, setSingleUrl] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<{ title: string; inserted: boolean; updated: boolean; imagesCount: number } | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  // Chargement initial
  useEffect(() => {
    loadCategories();
  }, [guideId]);

  useEffect(() => {
    loadArticles();
  }, [guideId, pagination.page]);

  const loadCategories = async () => {
    setCategoriesLoading(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/articles/categories`);
      if (!res.ok) return;
      const data = await res.json();
      setAllCategories(data.categories || []);
      const saved: string[] | null = data.selected_categories;
      setSavedCategories(saved);
      // Si aucune sélection sauvegardée → tout coché par défaut
      setSelectedCategories(saved ?? data.categories ?? []);
    } catch (err) {
      console.error('Erreur chargement catégories:', err);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const loadArticles = useCallback(async () => {
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
          setPagination(prev => ({ ...prev, total: data.pagination.total, totalPages: data.pagination.totalPages }));
        }
      }
    } catch (err) {
      console.error('Erreur chargement articles:', err);
    } finally {
      setLoading(false);
    }
  }, [guideId, pagination.page, pagination.limit, apiUrl]);

  const handleCategoryToggle = (cat: string) => {
    setSelectedCategories(prev => {
      const next = prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat];
      setCategoriesDirty(true);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedCategories(allCategories);
    setCategoriesDirty(true);
  };

  const handleSelectNone = () => {
    setSelectedCategories([]);
    setCategoriesDirty(true);
  };

  const saveCategories = async () => {
    setSavingCategories(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ selected_categories: selectedCategories }),
      });
      if (res.ok) {
        setSavedCategories(selectedCategories);
        setCategoriesDirty(false);
        // Recharger les articles avec le nouveau filtre
        setPagination(prev => ({ ...prev, page: 1 }));
        await loadArticles();
      }
    } catch (err) {
      console.error('Erreur sauvegarde catégories:', err);
    } finally {
      setSavingCategories(false);
    }
  };

  const syncTranslationUrls = async (payload: Record<string, unknown>) => {
    try {
      setIngestionStatus('Synchronisation des URLs traduites...');
      await authFetch(`${apiUrl}/api/v1/ingest/sync-translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('[Ingestion] sync-translations ignoré:', err);
    }
  };

  const launchIngestion = async () => {
    const wpSiteId = guide?.wp_site_id;
    if (!wpSiteId) {
      setIngestionError('Site ID manquant — sélectionnez une région dans le Paramétrage');
      return;
    }

    setIngesting(true);
    setIngestionError(null);
    setIngestionStatus('Démarrage de la récupération...');

    const payload = {
      siteId: wpSiteId,
      languages: guide.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'],
    };

    try {
      const triggerRes = await authFetch(`${apiUrl}/api/v1/ingest/articles-raw-sync/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: wpSiteId }),
      });
      const triggerData = await triggerRes.json().catch(() => ({}));

      if (!triggerRes.ok) {
        if (triggerRes.status === 409) {
          setIngestionStatus('Une synchronisation est déjà en cours...');
        } else {
          const detail = triggerData.details
            ? JSON.stringify(triggerData.details).slice(0, 200)
            : triggerData.message || '';
          setIngestionError(`${triggerData.error || 'Erreur lors de la récupération'}${detail ? ` — ${detail}` : ''}`);
          setIngesting(false);
          return;
        }
      } else {
        setIngestionStatus('Synchronisation lancée...');
      }

      const pollIntervalMs = 2500;
      const maxPollCount = 240;
      let pollCount = 0;

      const pollStatus = async () => {
        try {
          const statusRes = await authFetch(`${apiUrl}/api/v1/ingest/articles-raw-sync/status`);
          const statusData = await statusRes.json().catch(() => ({}));
          const status = statusData.status || statusData.latestRun?.status || statusData.run?.status;

          if (status === 'completed' || status === 'done' || status === 'success') {
            await syncTranslationUrls(payload);
            setIngestionStatus('Récupération terminée !');
            setIngesting(false);
            await loadCategories();
            await loadArticles();
            onArticlesImported?.();
            return;
          }
          if (status === 'failed' || status === 'error') {
            setIngestionError(statusData.error || 'Erreur lors de la récupération');
            setIngesting(false);
            return;
          }

          setIngestionStatus(statusData.progress || statusData.step || 'Synchronisation en cours...');
          pollCount++;
          if (pollCount < maxPollCount) {
            setTimeout(pollStatus, pollIntervalMs);
          } else {
            setIngestionError('Timeout : vérifiez les logs');
            setIngesting(false);
          }
        } catch {
          setIngestionError('Erreur lors du suivi');
          setIngesting(false);
        }
      };

      setTimeout(pollStatus, pollIntervalMs);
    } catch {
      setIngestionError('Erreur lors de la récupération');
      setIngesting(false);
    }
  };

  const handleSingleUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleUrl.trim() || !guide?.wp_site_id) return;

    setSingleLoading(true);
    setSingleError(null);
    setSingleResult(null);

    try {
      const res = await authFetch(`${apiUrl}/api/v1/ingest/single-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: guide.wp_site_id,
          articleUrl: singleUrl.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSingleError(data.error || 'Erreur lors de l\'ajout');
      } else {
        await syncTranslationUrls({
          siteId: guide.wp_site_id,
          articleUrl: singleUrl.trim(),
          languages: guide.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'],
        });
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

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const languages = guide?.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'];
  const categoriesMatchSaved = savedCategories === null
    ? selectedCategories.length === allCategories.length
    : JSON.stringify([...selectedCategories].sort()) === JSON.stringify([...(savedCategories ?? [])].sort());

  return (
    <div>
      {/* En-tête */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Articles WordPress</h2>
            <p className="text-sm text-gray-600 mt-1">
              {pagination.total} article{pagination.total > 1 ? 's' : ''}
              {savedCategories && savedCategories.length < allCategories.length && (
                <span className="ml-2 text-xs text-blue-600">
                  · {savedCategories.length} catégorie{savedCategories.length > 1 ? 's' : ''} filtrée{savedCategories.length > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCategories(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
                showCategories
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FunnelIcon className="h-4 w-4" />
              Catégories
              {categoriesDirty && <span className="w-2 h-2 rounded-full bg-orange-400" />}
            </button>
            {pagination.total > 0 && (
              <button
                onClick={loadArticles}
                disabled={loading || ingesting}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Recharger
              </button>
            )}
            <button
              onClick={launchIngestion}
              disabled={ingesting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowPathIcon className={`h-5 w-5 ${ingesting ? 'animate-spin' : ''}`} />
              {ingesting ? 'Sync en cours...' : pagination.total === 0 ? 'Récupérer les articles' : 'Sync WordPress'}
            </button>
          </div>
        </div>

        {/* Panel catégories */}
        {showCategories && (
          <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  Catégories du site
                  {categoriesLoading && <ArrowPathIcon className="inline w-3 h-3 ml-1 animate-spin text-gray-400" />}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedCategories.length}/{allCategories.length} sélectionnée{selectedCategories.length > 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSelectAll} className="text-xs text-blue-600 hover:underline">Tout</button>
                <span className="text-gray-300">|</span>
                <button onClick={handleSelectNone} className="text-xs text-blue-600 hover:underline">Aucun</button>
                {categoriesDirty && !categoriesMatchSaved && (
                  <button
                    onClick={saveCategories}
                    disabled={savingCategories}
                    className="ml-2 px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingCategories ? 'Sauvegarde...' : 'Appliquer'}
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allCategories.map(cat => (
                <label
                  key={cat}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                    selectedCategories.includes(cat)
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selectedCategories.includes(cat)}
                    onChange={() => handleCategoryToggle(cat)}
                  />
                  {cat}
                </label>
              ))}
              {allCategories.length === 0 && !categoriesLoading && (
                <p className="text-xs text-gray-400">Aucune catégorie trouvée — synchronisez d&apos;abord les articles.</p>
              )}
            </div>
          </div>
        )}

        {/* Statut ingestion */}
        {ingesting && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
            <ArrowPathIcon className="h-5 w-5 text-blue-600 animate-spin" />
            <span className="text-sm font-medium text-blue-800">{ingestionStatus || 'Synchronisation en cours...'}</span>
          </div>
        )}
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

        {/* Ajout par URL */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Ajouter un article par URL</p>
          <p className="text-xs text-gray-500 mb-3">
            Ingère immédiatement un article WordPress sans relancer la synchronisation complète.
          </p>
          <form onSubmit={handleSingleUrl} className="flex gap-2">
            <input
              type="url"
              value={singleUrl}
              onChange={e => { setSingleUrl(e.target.value); setSingleResult(null); setSingleError(null); }}
              placeholder="https://provence-lovers.com/article..."
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
                <strong>«{singleResult.title}»</strong>{' '}
                {singleResult.inserted ? 'ajouté' : singleResult.updated ? 'mis à jour' : 'déjà à jour'}
                {' '}· {singleResult.imagesCount} image{singleResult.imagesCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
          {singleError && (
            <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{singleError}</div>
          )}
        </div>
      </div>

      {/* Liste articles */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : displayedArticles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {guide?.wp_site_id
            ? 'Aucun article. Cliquez sur "Récupérer les articles" pour synchroniser depuis WordPress.'
            : 'Site ID manquant — configurez le périmètre géographique dans l\'onglet Paramétrage.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titre</th>
                {languages.map((lang: string) => (
                  <th key={lang} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">{lang.toUpperCase()}</th>
                ))}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayedArticles.map(article => (
                <tr key={article._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{article.title || article.titre}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{article.slug}</span>
                      {article.categories?.map(cat => (
                        <span key={cat} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 rounded">{cat}</span>
                      ))}
                    </div>
                  </td>
                  {languages.map((lang: string) => (
                    <td key={lang} className="px-3 py-4 text-center">
                      {article.urls_by_lang?.[lang] ? (
                        <a href={article.urls_by_lang[lang]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                          🔗
                        </a>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  ))}
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => router.push(`/guides/${guideId}/articles/${article._id}`)} className="text-blue-600 hover:text-blue-800">
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
                  className="px-3 py-1 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    let pageNum: number;
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
                  className="px-3 py-1 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
