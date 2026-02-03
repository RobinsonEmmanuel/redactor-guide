'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface ArticleDetail {
  _id: string;
  site_id: string;
  destination_ids: string[];
  slug: string;
  title: string;
  html_brut: string;
  markdown?: string;
  categories: string[];
  tags: string[];
  urls_by_lang: Record<string, string>;
  images: string[];
  updated_at: string;
}

export default function ArticleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const guideId = params.id as string;
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadArticle();
  }, [articleId]);

  const loadArticle = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/articles/${articleId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setArticle(data);
      }
    } catch (err) {
      console.error('Erreur chargement article:', err);
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

  if (!article) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Article introuvable</div>
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
            onClick={() => router.push(`/guides/${guideId}`)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Retour au guide
          </button>

          <h1 className="text-3xl font-bold text-gray-900">{article.title}</h1>
          <p className="text-gray-500 mt-1">
            Slug: {article.slug} · Mis à jour : {new Date(article.updated_at).toLocaleDateString('fr-FR')}
          </p>
        </div>

        {/* URLs par langue */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">URLs par langue</h2>
          <div className="grid grid-cols-2 gap-4">
            {languages.map((lang) => {
              const url = article.urls_by_lang?.[lang];
              return (
                <div key={lang} className="flex items-start gap-3">
                  <span className="font-mono text-gray-500 uppercase text-sm font-semibold w-8">{lang}:</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all flex-1"
                    >
                      {url}
                    </a>
                  ) : (
                    <span className="text-gray-400 italic">Non disponible</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Métadonnées */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Métadonnées</h2>
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-medium text-gray-700">Site ID:</span>{' '}
              <span className="text-gray-600">{article.site_id}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Destination IDs:</span>{' '}
              <span className="text-gray-600">{article.destination_ids.join(', ') || 'Aucune'}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Catégories:</span>{' '}
              <span className="text-gray-600">{article.categories.join(', ') || 'Aucune'}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Tags:</span>{' '}
              <span className="text-gray-600">{article.tags.join(', ') || 'Aucun'}</span>
            </div>
          </div>
        </div>

        {/* Images */}
        {article.images && article.images.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Images ({article.images.length})
            </h2>
            <div className="space-y-2">
              {article.images.map((imageUrl, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-500 font-mono text-sm">{idx + 1}.</span>
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all flex-1 text-sm"
                  >
                    {imageUrl}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Markdown (pour aide IA) */}
        {article.markdown && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Markdown (pour aide IA)
              </h2>
              <span className="text-sm text-gray-500">
                {article.markdown.length.toLocaleString()} caractères
              </span>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-mono">
                {article.markdown}
              </pre>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              ✨ Version structurée du contenu (titres, listes, emphases) pour une meilleure compréhension par l'IA
            </p>
          </div>
        )}

        {/* HTML Brut */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">HTML Brut</h2>
          <div className="bg-gray-50 p-4 rounded-lg overflow-x-auto">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
              {article.html_brut}
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}
