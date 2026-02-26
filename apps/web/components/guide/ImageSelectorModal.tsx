'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, ArrowPathIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface ImageSelectorModalProps {
  guideId: string;
  pageId: string;
  /** 'page' : images de l'article lié à la page (POI/INSPIRATION)
   *  'guide': toutes les images analysées du guide (autres types) */
  scope?: 'page' | 'guide';
  currentImageUrl?: string;
  apiUrl: string;
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
}

interface ImageAnalysis {
  image_id: string;
  url: string;
  source_article_title?: string;
  source_article_slug?: string;
  analysis_summary?: string;
  editorial_relevance?: string;
  visual_clarity_score?: number;
  composition_quality_score?: number;
  is_iconic_view?: boolean;
  shows_entire_site?: boolean;
}

export default function ImageSelectorModal({
  guideId,
  pageId,
  scope = 'page',
  currentImageUrl,
  apiUrl,
  onSelect,
  onClose,
}: ImageSelectorModalProps) {
  const [images, setImages] = useState<ImageAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(currentImageUrl || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'relevance' | 'clarity' | 'composition'>('relevance');
  // activeScope peut être basculé par l'utilisateur, initialisé depuis la prop scope
  const [activeScope, setActiveScope] = useState<'page' | 'guide'>(scope);

  useEffect(() => { loadImages(); }, [activeScope]);
  useEffect(() => { if (activeScope === 'guide') loadImages(); }, [sortBy]);

  const loadImages = async () => {
    setLoading(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const url = activeScope === 'guide'
        ? `${apiUrl}/api/v1/guides/${guideId}/images?sort=${sortBy}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ''}`
        : `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}/image-analysis`;

      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setImages(data.images || []);
      } else {
        console.error('Erreur chargement images:', res.status);
      }
    } catch (err) {
      console.error('Erreur chargement images:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadImages();
  };

  const handleScopeChange = (newScope: 'page' | 'guide') => {
    if (newScope === activeScope) return;
    setSearchQuery('');
    setImages([]);
    setActiveScope(newScope);
  };

  const handleSelect = () => {
    if (selectedImage) {
      onSelect(selectedImage);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <PhotoIcon className="h-6 w-6" />
              <div>
                <h2 className="text-xl font-semibold">Sélectionner une image</h2>
                <p className="text-sm text-purple-100 mt-0.5">
                  {images.length} image{images.length !== 1 ? 's' : ''}
                  {activeScope === 'guide' && searchQuery && ` · "${searchQuery}"`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-white hover:text-purple-100 transition-colors">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Toggle source + filtres */}
          <div className="flex flex-col gap-2">
            {/* Toggle Article / Destination */}
            <div className="flex bg-white/10 rounded-lg p-0.5 w-fit">
              <button
                onClick={() => handleScopeChange('page')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeScope === 'page'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                Article lié
              </button>
              <button
                onClick={() => handleScopeChange('guide')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeScope === 'guide'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                Toute la destination
              </button>
            </div>

            {/* Filtres recherche + tri (scope destination uniquement) */}
            {activeScope === 'guide' && (
              <div className="flex gap-2">
                <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Filtrer par article source..."
                    className="flex-1 px-3 py-1.5 rounded-lg text-sm text-gray-900 bg-white/90 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50"
                  />
                  <button type="submit" className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors">
                    Filtrer
                  </button>
                </form>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="px-2 py-1.5 rounded-lg text-sm text-gray-900 bg-white/90 focus:outline-none"
                >
                  <option value="relevance">Pertinence</option>
                  <option value="clarity">Clarté</option>
                  <option value="composition">Composition</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <ArrowPathIcon className="h-12 w-12 text-purple-600 mx-auto mb-4 animate-spin" />
                <p className="text-gray-600">Chargement des images...</p>
              </div>
            </div>
          ) : images.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <PhotoIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">Aucune image disponible</p>
                <p className="text-sm text-gray-500">
                  {activeScope === 'page'
                    ? "Les images de l'article n'ont pas encore été analysées"
                    : searchQuery
                    ? `Aucune image trouvée pour "${searchQuery}"`
                    : "Aucune image analysée pour cette destination"}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map((image, index) => (
                <div
                  key={image.image_id || index}
                  onClick={() => setSelectedImage(image.url)}
                  className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                    selectedImage === image.url
                      ? 'border-purple-600 ring-2 ring-purple-300 shadow-lg scale-105'
                      : 'border-gray-200 hover:border-purple-400 hover:shadow-md'
                  }`}
                >
                  {/* Indicateur de sélection */}
                  {selectedImage === image.url && (
                    <div className="absolute top-2 right-2 z-10 bg-purple-600 text-white rounded-full p-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}

                  {/* Badge image actuelle */}
                  {image.url === currentImageUrl && (
                    <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-xs font-medium px-2 py-1 rounded">
                      Actuelle
                    </div>
                  )}

                  {/* Source article (scope destination) */}
                  {activeScope === 'guide' && image.source_article_title && !image.is_iconic_view && (
                    <div className="absolute bottom-2 left-2 right-2 z-10">
                      <span className="block text-[9px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded truncate">
                        {image.source_article_title}
                      </span>
                    </div>
                  )}

                  {/* Badge iconique */}
                  {image.is_iconic_view && (
                    <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-0.5 items-start">
                      <span className="bg-purple-600 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">⭐ Iconique</span>
                      {activeScope === 'guide' && image.source_article_title && (
                        <span className="bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded max-w-[120px] truncate block">
                          {image.source_article_title}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Image */}
                  <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img
                      src={image.url}
                      alt={image.analysis_summary || `Image ${index + 1}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center gap-2 p-2 bg-gray-50">
                            <svg class="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span class="text-[10px] text-gray-400 text-center break-all line-clamp-2">Image non accessible</span>
                          </div>`;
                        }
                      }}
                    />
                  </div>

                  {/* Résumé analyse */}
                  {image.analysis_summary && (
                    <div className="p-2 bg-white border-t border-gray-100">
                      <p className="text-xs text-gray-600 line-clamp-2">
                        {image.analysis_summary}
                      </p>
                    </div>
                  )}

                  {/* Score pertinence */}
                  {image.editorial_relevance && (
                    <div className="px-2 pb-2 bg-white">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        image.editorial_relevance === 'forte' ? 'bg-green-100 text-green-700' :
                        image.editorial_relevance === 'moyenne' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        Pertinence : {image.editorial_relevance}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex gap-3 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedImage}
            className="flex-1 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {selectedImage === currentImageUrl ? 'Conserver cette image' : 'Sélectionner'}
          </button>
        </div>
      </div>
    </div>
  );
}
