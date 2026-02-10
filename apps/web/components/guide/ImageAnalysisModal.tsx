'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, CheckCircleIcon, XCircleIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface ImageAnalysis {
  image_id: string;
  url: string;
  shows_entire_site: boolean;
  shows_detail: boolean;
  detail_type: string;
  is_iconic_view: boolean;
  is_contextual: boolean;
  visual_clarity_score: number;
  composition_quality_score: number;
  lighting_quality_score: number;
  readability_small_screen_score: number;
  has_text_overlay: boolean;
  has_graphic_effects: boolean;
  editorial_relevance: string;
  analysis_summary: string;
}

interface ImageAnalysisModalProps {
  guideId: string;
  pageId: string;
  apiUrl: string;
  onClose: () => void;
}

export default function ImageAnalysisModal({
  guideId,
  pageId,
  apiUrl,
  onClose,
}: ImageAnalysisModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageAnalysis[]>([]);

  useEffect(() => {
    loadImageAnalysis();
  }, []);

  const loadImageAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}/image-analysis`,
        {
          credentials: 'include',
        }
      );

      if (res.ok) {
        const data = await res.json();
        setImages(data.images || []);
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Erreur lors du chargement des analyses');
      }
    } catch (err: any) {
      console.error('Erreur chargement analyses:', err);
      setError('Erreur réseau lors du chargement des analyses');
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 bg-green-50';
    if (score >= 0.6) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 0.8) return 'Excellent';
    if (score >= 0.6) return 'Bon';
    if (score >= 0.4) return 'Moyen';
    return 'Faible';
  };

  const getRelevanceColor = (relevance: string) => {
    if (relevance === 'forte') return 'text-green-700 bg-green-100';
    if (relevance === 'moyenne') return 'text-yellow-700 bg-yellow-100';
    return 'text-red-700 bg-red-100';
  };

  const getRelevanceLabel = (relevance: string) => {
    if (relevance === 'forte') return 'Forte';
    if (relevance === 'moyenne') return 'Moyenne';
    return 'Faible';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <PhotoIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Analyse des images</h2>
              <p className="text-sm text-gray-600">
                {images.length} image{images.length !== 1 ? 's' : ''} analysée{images.length !== 1 ? 's' : ''} par IA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-200 border-t-purple-600 mb-4"></div>
                <p className="text-gray-600">Chargement des analyses...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-red-700 font-medium">{error}</p>
            </div>
          )}

          {!loading && !error && images.length === 0 && (
            <div className="text-center py-12">
              <PhotoIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg font-medium">Aucune image analysée</p>
              <p className="text-gray-500 text-sm mt-2">
                Les images seront analysées lors de la génération du contenu
              </p>
            </div>
          )}

          {!loading && !error && images.length > 0 && (
            <div className="space-y-6">
              {images.map((img, idx) => (
                <div
                  key={img.image_id || idx}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg transition-shadow"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                    {/* Image */}
                    <div className="md:col-span-1">
                      <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                        <img
                          src={img.url}
                          alt={`Image ${idx + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2 truncate" title={img.url}>
                        {img.url}
                      </p>
                    </div>

                    {/* Analysis */}
                    <div className="md:col-span-2 space-y-4">
                      {/* Summary */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 mb-1">Résumé de l'analyse</h3>
                        <p className="text-sm text-gray-600 italic">
                          "{img.analysis_summary || 'Aucun résumé disponible'}"
                        </p>
                      </div>

                      {/* Scores */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Clarté visuelle</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  img.visual_clarity_score >= 0.8
                                    ? 'bg-green-500'
                                    : img.visual_clarity_score >= 0.6
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${img.visual_clarity_score * 100}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getScoreColor(img.visual_clarity_score)}`}>
                              {getScoreLabel(img.visual_clarity_score)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Composition</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  img.composition_quality_score >= 0.8
                                    ? 'bg-green-500'
                                    : img.composition_quality_score >= 0.6
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${img.composition_quality_score * 100}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getScoreColor(img.composition_quality_score)}`}>
                              {getScoreLabel(img.composition_quality_score)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Lumière</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  img.lighting_quality_score >= 0.8
                                    ? 'bg-green-500'
                                    : img.lighting_quality_score >= 0.6
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${img.lighting_quality_score * 100}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getScoreColor(img.lighting_quality_score)}`}>
                              {getScoreLabel(img.lighting_quality_score)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Lisibilité mobile</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  img.readability_small_screen_score >= 0.8
                                    ? 'bg-green-500'
                                    : img.readability_small_screen_score >= 0.6
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${img.readability_small_screen_score * 100}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getScoreColor(img.readability_small_screen_score)}`}>
                              {getScoreLabel(img.readability_small_screen_score)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${getRelevanceColor(
                            img.editorial_relevance
                          )}`}
                        >
                          Pertinence: {getRelevanceLabel(img.editorial_relevance)}
                        </span>

                        {img.shows_entire_site && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            Vue d'ensemble
                          </span>
                        )}

                        {img.is_iconic_view && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            Vue iconique
                          </span>
                        )}

                        {img.shows_detail && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                            Détail: {img.detail_type}
                          </span>
                        )}

                        {img.has_text_overlay && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
                            <XCircleIcon className="w-3.5 h-3.5" />
                            Texte incrusté
                          </span>
                        )}

                        {img.has_graphic_effects && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
                            <XCircleIcon className="w-3.5 h-3.5" />
                            Effets graphiques
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
