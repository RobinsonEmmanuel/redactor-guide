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
    status: 'draft',
    destinations: [] as string[],
    wpConfig: {
      siteUrl: '',
      jwtToken: '',
    },
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (guide) {
      setFormData({
        name: guide.name || '',
        slug: guide.slug || '',
        year: guide.year || new Date().getFullYear(),
        version: guide.version || '1.0.0',
        language: guide.language || 'fr',
        status: guide.status || 'draft',
        destinations: guide.destinations || [],
        wpConfig: {
          siteUrl: guide.wpConfig?.siteUrl || '',
          jwtToken: guide.wpConfig?.jwtToken || '',
        },
      });
    }
  }, [guide]);

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
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        onClose();
        // Rafraîchir la liste
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="Guide Paris 2025"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slug
              </label>
              <input
                type="text"
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-gray-50"
                placeholder="guide-paris-2025"
              />
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
                min="2020"
                max="2100"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="1.0.0"
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
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="de">Allemand</option>
                <option value="it">Italien</option>
                <option value="es">Espagnol</option>
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
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="draft">Brouillon</option>
                <option value="in_progress">En cours</option>
                <option value="review">En revue</option>
                <option value="ready">Prêt</option>
                <option value="published">Publié</option>
              </select>
            </div>
          </div>
        </div>

        {/* Configuration WordPress */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Configuration WordPress
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Configurez la source WordPress et l'authentification JWT
          </p>

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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="https://example.com"
              />
              <p className="mt-1 text-xs text-gray-500">
                L'URL complète du site WordPress (avec https://)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jeton JWT (JWT Authentication) *
              </label>
              <textarea
                name="wpConfig.jwtToken"
                value={formData.wpConfig.jwtToken}
                onChange={handleChange}
                required
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
              <p className="mt-1 text-xs text-gray-500">
                Jeton généré par le plugin JWT Authentication for WP REST API
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
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
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Enregistrement...' : isEditing ? 'Mettre à jour' : 'Créer le guide'}
          </button>
        </div>
      </form>
    </div>
  );
}
