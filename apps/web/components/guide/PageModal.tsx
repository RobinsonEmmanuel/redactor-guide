'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { nanoid } from 'nanoid';

interface Template {
  _id: string;
  name: string;
  description?: string;
  fields: any[];
}

interface WordPressArticle {
  _id: string;
  titre: string;
  url_francais: string;
}

interface PageModalProps {
  page: any | null;
  onClose: () => void;
  onSave: (data: any) => void;
  apiUrl: string;
  guideId: string;
}

const PAGE_TYPES = [
  { value: 'intro', label: 'Introduction' },
  { value: 'section', label: 'Section' },
  { value: 'poi', label: 'Point d\'intérêt' },
  { value: 'inspiration', label: 'Inspiration' },
  { value: 'transition', label: 'Transition' },
  { value: 'outro', label: 'Conclusion' },
  { value: 'pratique', label: 'Pratique' },
  { value: 'conseil', label: 'Conseil' },
];

const PAGE_STATUS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'generee_ia', label: 'Générée par IA' },
  { value: 'relue', label: 'Relue' },
  { value: 'validee', label: 'Validée' },
  { value: 'texte_coule', label: 'Texte coulé' },
  { value: 'visuels_montes', label: 'Visuels montés' },
  { value: 'texte_recu', label: 'Texte reçu' },
  { value: 'en_attente', label: 'En attente' },
  { value: 'non_conforme', label: 'Non conforme' },
];

export default function PageModal({ page, onClose, onSave, apiUrl, guideId }: PageModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [articles, setArticles] = useState<WordPressArticle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [formData, setFormData] = useState({
    page_id: page?.page_id || nanoid(10),
    titre: page?.titre || '',
    template_id: page?.template_id || '',
    type_de_page: page?.type_de_page || '',
    statut_editorial: page?.statut_editorial || 'draft',
    url_source: page?.url_source || '',
    commentaire_interne: page?.commentaire_interne || '',
  });

  useEffect(() => {
    loadTemplates();
    loadArticles();
  }, [guideId]);

  const loadTemplates = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/templates`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    }
  };

  const loadArticles = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles?limit=1000`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles || []); // ✅ Extraire le tableau articles
      }
    } catch (err) {
      console.error('Erreur chargement articles:', err);
      setArticles([]); // Fallback en cas d'erreur
    }
  };

  const filteredArticles = Array.isArray(articles) 
    ? articles.filter((article) =>
        article?.titre?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const handleSelectArticle = (article: WordPressArticle) => {
    setFormData({ ...formData, url_source: article.url_francais });
    setSearchQuery(article.titre);
    setShowDropdown(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.titre || !formData.template_id) {
      alert('Titre et template sont obligatoires');
      return;
    }

    // Nettoyer les champs vides (notamment url_source qui doit être une URL valide ou undefined)
    const cleanedData = {
      ...formData,
      url_source: formData.url_source || undefined,
      commentaire_interne: formData.commentaire_interne || undefined,
      type_de_page: formData.type_de_page || undefined,
    };

    onSave(cleanedData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {page ? 'Modifier la page' : 'Nouvelle page'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Titre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Titre de la page *
            </label>
            <input
              type="text"
              value={formData.titre}
              onChange={(e) => setFormData({ ...formData, titre: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ex: Les plus belles plages de Tenerife"
              required
            />
          </div>

          {/* Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template *
            </label>
            <select
              value={formData.template_id}
              onChange={(e) => setFormData({ ...formData, template_id: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Sélectionner un template</option>
              {templates.map((template) => (
                <option key={template._id} value={template._id}>
                  {template.name} ({template.fields.length} champs)
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Le template définit la structure de la page
            </p>
          </div>

          {/* Type de page */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type de page
            </label>
            <select
              value={formData.type_de_page}
              onChange={(e) => setFormData({ ...formData, type_de_page: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Aucun type spécifique</option>
              {PAGE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Statut */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Statut éditorial
            </label>
            <select
              value={formData.statut_editorial}
              onChange={(e) => setFormData({ ...formData, statut_editorial: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {PAGE_STATUS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          {/* URL source - Autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Article WordPress source (optionnel)
            </label>
            <input
              type="text"
              value={searchQuery || formData.url_source}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Rechercher un article ou saisir une URL..."
            />
            
            {/* Dropdown */}
            {showDropdown && searchQuery && filteredArticles.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                {filteredArticles.map((article) => (
                  <button
                    key={article._id}
                    type="button"
                    onClick={() => handleSelectArticle(article)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-gray-900">{article.titre}</div>
                    <div className="text-xs text-gray-500 mt-1 truncate">{article.url_francais}</div>
                  </button>
                ))}
              </div>
            )}

            {formData.url_source && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-blue-900 mb-1">URL sélectionnée :</div>
                    <a
                      href={formData.url_source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline break-all"
                    >
                      {formData.url_source}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, url_source: '' });
                      setSearchQuery('');
                    }}
                    className="ml-2 text-blue-400 hover:text-blue-600"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <p className="mt-1 text-xs text-gray-500">
              Recherchez parmi {articles.length} articles WordPress importés
            </p>
          </div>

          {/* Commentaire */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Commentaire interne (optionnel)
            </label>
            <textarea
              value={formData.commentaire_interne}
              onChange={(e) => setFormData({ ...formData, commentaire_interne: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Notes internes..."
            />
          </div>

          {/* Page ID (lecture seule si édition) */}
          {page && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ID de page (stable)
              </label>
              <input
                type="text"
                value={formData.page_id}
                disabled
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {page ? 'Mettre à jour' : 'Créer la page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
