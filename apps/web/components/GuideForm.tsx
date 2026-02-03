'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface GuideFormProps {
  guide?: any;
  onClose: () => void;
}

export default function GuideForm({ guide, onClose }: GuideFormProps) {
  const isEditing = !!guide;
  
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    year: new Date().getFullYear(),
    version: '1.0.0',
    language: 'fr',
    availableLanguages: ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'] as string[],
    status: 'draft',
    destination: '', // 1 guide = 1 destination
    wpConfig: {
      siteUrl: '',
      jwtToken: '',
    },
  });

  const [destinations, setDestinations] = useState<string[]>([]);

  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [customLanguage, setCustomLanguage] = useState({ code: '', label: '' });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDestinations();
    if (guide) {
      setFormData({
        name: guide.name || '',
        slug: guide.slug || '',
        year: guide.year || new Date().getFullYear(),
        version: guide.version || '1.0.0',
        language: guide.language || 'fr',
        availableLanguages: guide.availableLanguages || ['fr', 'it', 'es', 'de', 'da', 'sv', 'en', 'pt-pt', 'nl'],
        status: guide.status || 'draft',
        destination: guide.destination || '',
        wpConfig: {
          siteUrl: guide.wpConfig?.siteUrl || '',
          jwtToken: guide.wpConfig?.jwtToken || '',
        },
      });
    }
  }, [guide]);

  const loadDestinations = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/api/v1/destinations`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setDestinations(data.destinations || []);
      }
    } catch (err) {
      console.error('Erreur chargement destinations:', err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name.startsWith('wpConfig.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        wpConfig: {
          ...prev.wpConfig,
          [field]: value,
        },
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: name === 'year' ? parseInt(value) : value,
      }));
    }

    // Auto-générer le slug depuis le nom
    if (name === 'name' && !isEditing) {
      const slug = value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      setFormData(prev => ({ ...prev, slug }));
    }
  };

  const handleLanguageToggle = (langCode: string) => {
    setFormData(prev => {
      const isSelected = prev.availableLanguages.includes(langCode);
      const newLanguages = isSelected
        ? prev.availableLanguages.filter(l => l !== langCode)
        : [...prev.availableLanguages, langCode];
      
      return { ...prev, availableLanguages: newLanguages };
    });
  };

  const handleAddCustomLanguage = () => {
    if (customLanguage.code && !formData.availableLanguages.includes(customLanguage.code)) {
      setFormData(prev => ({
        ...prev,
        availableLanguages: [...prev.availableLanguages, customLanguage.code],
      }));
      setCustomLanguage({ code: '', label: '' });
      setShowLanguageModal(false);
    }
  };

  const defaultLanguages = [
    { code: 'fr', label: 'Français (source)' },
    { code: 'it', label: 'Italien' },
    { code: 'es', label: 'Espagnol' },
    { code: 'de', label: 'Allemand' },
    { code: 'da', label: 'Danois' },
    { code: 'sv', label: 'Suédois' },
    { code: 'en', label: 'Anglais' },
    { code: 'pt-pt', label: 'Portugais' },
    { code: 'nl', label: 'Néerlandais' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const url = isEditing
        ? `${apiUrl}/api/v1/guides/${guide._id}`
        : `${apiUrl}/api/v1/guides`;
      
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        onClose();
        window.location.reload();
      } else {
        alert('Erreur lors de l\'enregistrement');
      }
    } catch (error) {
      console.error('Erreur:', error);
      alert('Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {isEditing ? 'Modifier le guide' : 'Nouveau guide'}
          </h1>
          <p className="text-gray-500 mt-1">
            {isEditing ? 'Mettez à jour les informations du guide' : 'Créez un nouveau guide touristique'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="max-w-4xl">
        {/* Informations générales */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations générales
          </h2>

          <div className="grid grid-cols-2 gap-6">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Titre du guide *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Guide Paris 2024"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slug *
              </label>
              <input
                type="text"
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="guide-paris-2024"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Destination *
              </label>
              <select
                name="destination"
                value={formData.destination}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Sélectionner une destination</option>
                {destinations.map((dest) => (
                  <option key={dest} value={dest}>
                    {dest}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                🔍 Les articles WordPress seront automatiquement filtrés par cette catégorie
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Année *
              </label>
              <input
                type="number"
                name="year"
                value={formData.year}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Version
              </label>
              <input
                type="text"
                name="version"
                value={formData.version}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Langue
              </label>
              <select
                name="language"
                value={formData.language}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="nl">Nederlands</option>
                <option value="pl">Polski</option>
                <option value="ru">Русский</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Statut
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="draft">Brouillon</option>
                <option value="in_progress">En cours</option>
                <option value="review">En révision</option>
                <option value="published">Publié</option>
              </select>
            </div>
          </div>
        </div>

        {/* Configuration WordPress */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Configuration WordPress
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                URL du site WordPress *
              </label>
              <input
                type="url"
                name="wpConfig.siteUrl"
                value={formData.wpConfig.siteUrl}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://votre-site.com"
              />
              <p className="mt-1 text-sm text-gray-500">
                URL complète du site WordPress (avec https://)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Token JWT WordPress *
              </label>
              <textarea
                name="wpConfig.jwtToken"
                value={formData.wpConfig.jwtToken}
                onChange={handleChange}
                required
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
              <p className="mt-1 text-sm text-gray-500">
                Token d'authentification JWT pour accéder à l'API REST WordPress
              </p>
            </div>
          </div>
        </div>

        {/* Langues disponibles */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Langues à récupérer
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Sélectionnez les langues disponibles sur votre site WordPress
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowLanguageModal(true)}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              + Ajouter une langue
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {defaultLanguages.map(lang => (
              <label
                key={lang.code}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={formData.availableLanguages.includes(lang.code)}
                  onChange={() => handleLanguageToggle(lang.code)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{lang.label}</span>
              </label>
            ))}
            
            {formData.availableLanguages
              .filter(code => !defaultLanguages.some(l => l.code === code))
              .map(code => (
                <label
                  key={code}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => handleLanguageToggle(code)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{code.toUpperCase()}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      handleLanguageToggle(code);
                    }}
                    className="ml-auto text-red-600 hover:text-red-700"
                  >
                    ×
                  </button>
                </label>
              ))}
          </div>

          <p className="mt-3 text-xs text-gray-500">
            {formData.availableLanguages.length} langue(s) sélectionnée(s)
          </p>
        </div>

        {/* Modale Ajouter langue */}
        {showLanguageModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Ajouter une langue personnalisée
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Code langue WPML *
                  </label>
                  <input
                    type="text"
                    value={customLanguage.code}
                    onChange={(e) => setCustomLanguage(prev => ({ ...prev, code: e.target.value.toLowerCase() }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="pl ou pt-pt"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Utilisez le code exact de WPML (ex: pl, ru, zh-hans, pt-pt)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nom de la langue (optionnel)
                  </label>
                  <input
                    type="text"
                    value={customLanguage.label}
                    onChange={(e) => setCustomLanguage(prev => ({ ...prev, label: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Polski"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowLanguageModal(false);
                    setCustomLanguage({ code: '', label: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomLanguage}
                  disabled={!customLanguage.code}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Enregistrement...' : (isEditing ? 'Mettre à jour' : 'Créer le guide')}
          </button>
        </div>
      </form>
    </div>
  );
}
