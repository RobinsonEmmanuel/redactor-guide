'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface Template {
  _id: string;
  name: string;
  fields: TemplateField[];
}

interface TemplateField {
  name: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta' | 'liste';
  label: string;
  description?: string;
  ai_instructions?: string;
  max_chars?: number;
}

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_id: string;
  ordre: number;
  url_source?: string;
}

interface ContentEditorModalProps {
  page: Page;
  template: Template | null;
  content: Record<string, any>;
  onClose: () => void;
  onSave: (content: Record<string, any>) => void;
  guideId: string; // ✅ Ajout
  apiUrl: string;  // ✅ Ajout
}

export default function ContentEditorModal({
  page,
  template,
  content,
  onClose,
  onSave,
  guideId,
  apiUrl,
}: ContentEditorModalProps) {
  const [formData, setFormData] = useState<Record<string, any>>(content || {});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFormData(content || {});
  }, [content]);

  const handleGenerateContent = async () => {
    if (!page.url_source) {
      setError('Aucun article WordPress source associé à cette page');
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
          alert('🤖 Génération IA lancée (avec analyse images) ! Le contenu sera disponible dans quelques secondes. Rechargez la page.');
          onClose();
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
              maxLength={field.max_chars}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
          </div>
        );

      case 'texte':
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={field.max_chars}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
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
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="URL de l'image ou chemin local"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {fieldValue && (
              <div className="mt-2">
                <img
                  src={fieldValue}
                  alt={field.label}
                  className="max-h-32 rounded border border-gray-200"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={field.max_chars || 50}
            />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
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
          <button
            type="button"
            onClick={handleGenerateContent}
            disabled={generating || !page.url_source}
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

          {!page.url_source && (
            <p className="text-xs text-white/70 mt-2 text-center">
              Aucun article WordPress source associé
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
    </div>
  );
}
