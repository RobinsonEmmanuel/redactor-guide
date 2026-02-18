'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, ArrowPathIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface ImageSelectorModalProps {
  guideId: string;
  pageId: string;
  currentImageUrl?: string;
  apiUrl: string;
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
}

interface ImageAnalysis {
  url: string;
  analysis?: {
    description?: string;
    tags?: string[];
    caption?: string;
  };
}

export default function ImageSelectorModal({
  guideId,
  pageId,
  currentImageUrl,
  apiUrl,
  onSelect,
  onClose,
}: ImageSelectorModalProps) {
  const [images, setImages] = useState<ImageAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(currentImageUrl || null);

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    setLoading(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}/image-analyses`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
        }
      );

      if (res.ok) {
        const data = await res.json();
        console.log('📸 Images chargées:', data);
        setImages(data.analyses || []);
      } else {
        console.error('Erreur chargement images:', res.status);
      }
    } catch (err) {
      console.error('Erreur chargement images:', err);
    } finally {
      setLoading(false);
    }
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PhotoIcon className="h-6 w-6" />
              <div>
                <h2 className="text-xl font-semibold">Sélectionner une image</h2>
                <p className="text-sm text-purple-100 mt-1">
                  {images.length} image{images.length !== 1 ? 's' : ''} disponible{images.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-purple-100 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
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
                  Les images de l'article n'ont pas encore été analysées
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map((image, index) => (
                <div
                  key={index}
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
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Image actuelle marquée */}
                  {image.url === currentImageUrl && (
                    <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-xs font-medium px-2 py-1 rounded">
                      Actuelle
                    </div>
                  )}

                  {/* Image */}
                  <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img
                      src={image.url}
                      alt={image.analysis?.caption || `Image ${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder-image.svg';
                      }}
                    />
                  </div>

                  {/* Description */}
                  {image.analysis?.description && (
                    <div className="p-2 bg-white">
                      <p className="text-xs text-gray-600 line-clamp-2">
                        {image.analysis.description}
                      </p>
                    </div>
                  )}

                  {/* Tags */}
                  {image.analysis?.tags && image.analysis.tags.length > 0 && (
                    <div className="p-2 pt-0 flex flex-wrap gap-1">
                      {image.analysis.tags.slice(0, 3).map((tag, tagIndex) => (
                        <span
                          key={tagIndex}
                          className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      {image.analysis.tags.length > 3 && (
                        <span className="text-[10px] text-gray-400">
                          +{image.analysis.tags.length - 3}
                        </span>
                      )}
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
