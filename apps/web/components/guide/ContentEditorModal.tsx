'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon, PhotoIcon } from '@heroicons/react/24/outline';
import ImageAnalysisModal from './ImageAnalysisModal';
import ImageSelectorModal from './ImageSelectorModal';

interface Template {
  _id: string;
  name: string;
  fields: TemplateField[];
}

interface TemplateField {
  name: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta' | 'liste' | 'picto';
  label: string;
  description?: string;
  ai_instructions?: string;
  max_chars?: number;
  options?: string[];
}

// Labels et icônes pour les valeurs de picto
const PICTO_OPTION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  incontournable: { label: 'Incontournable', icon: '😄', color: 'bg-green-100 border-green-400 text-green-800' },
  interessant:    { label: 'Intéressant',    icon: '😊', color: 'bg-blue-100 border-blue-400 text-blue-800' },
  a_voir:         { label: 'À voir',         icon: '🙂', color: 'bg-gray-100 border-gray-400 text-gray-700' },
  '100':          { label: 'Accessible 100%', icon: '♿', color: 'bg-green-100 border-green-400 text-green-800' },
  '50':           { label: 'Partiellement',   icon: '♿', color: 'bg-yellow-100 border-yellow-400 text-yellow-800' },
  '0':            { label: 'Non accessible',  icon: '🚫', color: 'bg-red-100 border-red-400 text-red-800' },
  oui:            { label: 'Oui',             icon: '✅', color: 'bg-green-100 border-green-400 text-green-800' },
  non:            { label: 'Non',             icon: '❌', color: 'bg-gray-100 border-gray-400 text-gray-600' },
};

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_id: string;
  template_name?: string;
  type_de_page?: string;
  ordre: number;
  url_source?: string;
}

interface ContentEditorModalProps {
  page: Page;
  template: Template | null;
  content: Record<string, any>;
  onClose: () => void;
  onSave: (content: Record<string, any>) => void;
  onGenerationStarted?: () => void; // ✅ Callback pour recharger les pages après lancement génération
  guideId: string;
  apiUrl: string;
}

export default function ContentEditorModal({
  page,
  template,
  content,
  onClose,
  onSave,
  onGenerationStarted,
  guideId,
  apiUrl,
}: ContentEditorModalProps) {
  const [formData, setFormData] = useState<Record<string, any>>(content || {});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImageAnalysis, setShowImageAnalysis] = useState(false);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [currentImageField, setCurrentImageField] = useState<string | null>(null);

  useEffect(() => {
    setFormData(content || {});
  }, [content]);

  // POI et INSPIRATION nécessitent un article source ; les autres types génèrent
  // depuis le contexte général du site WordPress.
  const requiresUrlForGeneration = ['poi', 'inspiration'].includes(
    (page.type_de_page ?? page.template_name ?? '').toLowerCase()
  );

  const handleGenerateContent = async () => {
    if (requiresUrlForGeneration && !page.url_source) {
      setError('Aucun article WordPress source associé à cette page. Veuillez lier un article via les paramètres de la page.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      console.log('🤖 Lancement génération contenu (analyse images incluse)...');
      
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/generate-content`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      const data = await res.json();

      if (res.ok) {
        if (data.content) {
          // Génération synchrone (dev) : contenu immédiat
          setFormData(data.content);
          alert('✅ Contenu généré avec succès !');
        } else if (data.async) {
          // Génération asynchrone (prod) : via worker
          console.log('🤖 Génération IA lancée en arrière-plan');
          
          // Appeler le callback pour recharger les pages
          if (onGenerationStarted) {
            onGenerationStarted();
          }
          
          // Fermer la modal
          onClose();
          
          // Notifier l'utilisateur (moins intrusif qu'avant)
          console.log('✅ Modal fermée, polling activé pour suivi auto');
        }
      } else {
        const errorMsg = data.details ? `${data.error}\n\nDétails: ${data.details}` : data.error;
        setError(errorMsg);
        console.error('Erreur serveur:', data);
      }
    } catch (err: any) {
      console.error('Erreur génération:', err);
      setError('Erreur lors de la génération du contenu');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleOpenImageSelector = (fieldName: string) => {
    setCurrentImageField(fieldName);
    setShowImageSelector(true);
  };

  const handleImageSelected = (imageUrl: string) => {
    if (currentImageField) {
      handleFieldChange(currentImageField, imageUrl);
    }
  };

  const getCharacterCount = (fieldName: string, maxChars?: number) => {
    const value = formData[fieldName] || '';
    const count = value.length;
    if (!maxChars) return null;
    const percentage = (count / maxChars) * 100;
    const color = percentage > 100 ? 'text-red-600' : percentage > 90 ? 'text-orange-600' : 'text-gray-500';
    return (
      <span className={`text-xs ${color}`}>
        {count} / {maxChars}
      </span>
    );
  };

  const renderField = (field: TemplateField) => {
    const fieldValue = formData[field.name] || '';

    switch (field.type) {
      case 'titre':
        const isTitleOverLimit = field.max_chars && fieldValue.length > field.max_chars;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isTitleOverLimit 
                  ? 'border-red-500 bg-red-50 text-red-900' 
                  : 'border-gray-300'
              }`}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isTitleOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Titre en dépassement de {fieldValue.length - field.max_chars!} caractères
              </p>
            )}
          </div>
        );

      case 'texte':
        const isOverLimit = field.max_chars && fieldValue.length > field.max_chars;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <textarea
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              rows={4}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isOverLimit 
                  ? 'border-red-500 bg-red-50 text-red-900' 
                  : 'border-gray-300'
              }`}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Texte en dépassement de {fieldValue.length - field.max_chars!} caractères
              </p>
            )}
          </div>
        );

      case 'image':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            
            <div className="flex gap-2">
              <input
                type="text"
                value={fieldValue}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                placeholder="URL de l'image ou chemin local"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => handleOpenImageSelector(field.name)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                title="Choisir parmi les images analysées"
              >
                <PhotoIcon className="h-5 w-5" />
                Choisir
              </button>
            </div>

            {fieldValue && (
              <div
                className="mt-3 relative group cursor-pointer inline-block"
                onClick={() => handleOpenImageSelector(field.name)}
              >
                <img
                  src={fieldValue}
                  alt={field.label}
                  className="max-h-48 rounded-lg border border-gray-200 shadow-sm group-hover:opacity-80 transition-opacity block"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const container = target.parentElement;
                    if (container) {
                      const placeholder = document.createElement('div');
                      placeholder.className = 'flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors';
                      placeholder.innerHTML = `
                        <svg class="w-8 h-8 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <div>
                          <p class="text-xs font-medium text-gray-700">Image non prévisualisable</p>
                          <p class="text-[11px] text-gray-400 mt-0.5 break-all line-clamp-1">${fieldValue}</p>
                          <p class="text-[11px] text-purple-600 mt-1">Cliquer pour changer →</p>
                        </div>
                      `;
                      container.appendChild(placeholder);
                    }
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all rounded-lg pointer-events-none">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                    <PhotoIcon className="h-4 w-4" />
                    Changer l'image
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'lien':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="url"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        );

      case 'meta':
        const isMetaOverLimit = field.max_chars && fieldValue.length > field.max_chars;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="Valeur courte et normée"
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isMetaOverLimit 
                  ? 'border-red-500 bg-red-50 text-red-900' 
                  : 'border-gray-300'
              }`}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isMetaOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Métadonnée en dépassement de {fieldValue.length - field.max_chars!} caractères
              </p>
            )}
          </div>
        );

      case 'liste':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        );

      case 'picto':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            {field.options && field.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {field.options.map((option) => {
                  const config = PICTO_OPTION_CONFIG[option] || { label: option, icon: '●', color: 'bg-gray-100 border-gray-300 text-gray-700' };
                  const isSelected = fieldValue === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleFieldChange(field.name, option)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                        isSelected
                          ? `${config.color} shadow-sm scale-105`
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                      }`}
                    >
                      <span className="text-base">{config.icon}</span>
                      <span>{config.label}</span>
                      {isSelected && <span className="ml-1">✓</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={fieldValue}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            )}
            {!fieldValue && (
              <p className="mt-1 text-xs text-amber-600">⚠️ Valeur non renseignée</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6">
          <p className="text-gray-600">Template introuvable</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xl font-semibold">Rédaction de la page</h2>
              <p className="text-sm text-blue-100 mt-1">
                {page.titre} • Template : {template.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-blue-100 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Bouton génération IA */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGenerateContent}
              disabled={generating || (requiresUrlForGeneration && !page.url_source)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <ArrowPathIcon className="h-5 w-5 animate-spin" />
                  Génération en cours...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-5 w-5" />
                  🤖 Générer le contenu automatiquement
                </>
              )}
            </button>

            {/* Bouton visualiser analyses images (seulement si article source lié) */}
            {page.url_source && (
              <button
                type="button"
                onClick={() => setShowImageAnalysis(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg transition-colors text-sm"
              >
                <PhotoIcon className="h-4 w-4" />
                📊 Voir les analyses d'images
              </button>
            )}
          </div>

          {requiresUrlForGeneration && !page.url_source && (
            <p className="text-xs text-white/70 mt-2 text-center">
              Article WordPress source requis pour ce type de page
            </p>
          )}
          {!requiresUrlForGeneration && !page.url_source && (
            <p className="text-xs text-white/60 mt-2 text-center">
              Génération basée sur le contenu global du site WordPress
            </p>
          )}

          {error && (
            <div className="mt-2 p-2 bg-red-500/20 border border-red-300/30 rounded text-xs text-white">
              {error}
            </div>
          )}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            {template.fields.map((field) => renderField(field))}
          </div>
        </form>

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
            onClick={handleSubmit}
            className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Enregistrer le contenu
          </button>
        </div>
      </div>

      {/* Modal d'analyse des images */}
      {showImageAnalysis && (
        <ImageAnalysisModal
          guideId={guideId}
          pageId={page._id}
          apiUrl={apiUrl}
          onClose={() => setShowImageAnalysis(false)}
        />
      )}

      {/* Modal de sélection d'images */}
      {showImageSelector && currentImageField && (
        <ImageSelectorModal
          guideId={guideId}
          pageId={page._id}
          currentImageUrl={formData[currentImageField]}
          apiUrl={apiUrl}
          onSelect={handleImageSelected}
          onClose={() => {
            setShowImageSelector(false);
            setCurrentImageField(null);
          }}
        />
      )}
    </div>
  );
}
