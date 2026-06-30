'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

interface GuideFormProps {
  guide?: any;
  onClose: () => void;
}

interface RegionEntry {
  id: string;
  name: string;
  assignedSiteIds: string[];
  assignedSiteNames: string[];
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function GuideForm({ guide, onClose }: GuideFormProps) {
  const isEditing = !!guide;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    year: new Date().getFullYear(),
    version: '1.0.0',
    status: 'draft',
    destination: '',
    destination_rl_id: '',
    wp_site_id: '',
    guide_template_id: '',
  });

  const [regions, setRegions] = useState<RegionEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [guideTemplates, setGuideTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRegions();

    const loadGuideTemplates = async () => {
      setLoadingTemplates(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/guide-templates`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setGuideTemplates(data.templates || []);
        }
      } catch (err) {
        console.error('Erreur chargement templates:', err);
      } finally {
        setLoadingTemplates(false);
      }
    };
    loadGuideTemplates();

    if (guide) {
      setFormData({
        name: guide.name || '',
        slug: guide.slug || '',
        year: guide.year || new Date().getFullYear(),
        version: guide.version || '1.0.0',
        status: guide.status || 'draft',
        destination: guide.destination || '',
        destination_rl_id: guide.destination_rl_id || '',
        wp_site_id: guide.wp_site_id || '',
        guide_template_id: guide.guide_template_id || '',
      });
    }
  }, [guide]);

  const loadRegions = async () => {
    setRegionsLoading(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/regions/overview`);
      if (!res.ok) return;
      const data = await res.json();
      const list: RegionEntry[] = (data.data ?? data ?? []).filter(
        (r: RegionEntry) => r.assignedSiteNames?.length > 0
      );
      list.sort((a, b) => {
        const siteA = a.assignedSiteNames[0] ?? '';
        const siteB = b.assignedSiteNames[0] ?? '';
        return siteA.localeCompare(siteB, 'fr') || a.name.localeCompare(b.name, 'fr');
      });
      setRegions(list);
    } catch (err) {
      console.error('Erreur chargement régions:', err);
    } finally {
      setRegionsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'year' ? parseInt(value) : value,
      // Auto-slug depuis le nom (création uniquement)
      ...(name === 'name' && !isEditing ? { slug: toSlug(value) } : {}),
    }));
  };

  const handleRegionChange = (regionId: string) => {
    const region = regions.find(r => r.id === regionId);
    setFormData(prev => ({
      ...prev,
      destination_rl_id: regionId,
      destination: region?.name ?? prev.destination,
      wp_site_id: region?.assignedSiteIds?.[0] ?? prev.wp_site_id,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = isEditing
        ? `${apiUrl}/api/v1/guides/${guide._id}`
        : `${apiUrl}/api/v1/guides`;
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        onClose();
        window.location.reload();
      } else {
        alert('Erreur lors de l\'enregistrement');
      }
    } catch {
      alert('Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {isEditing ? 'Modifier le guide' : 'Nouveau guide'}
          </h1>
          <p className="text-gray-500 mt-1">
            {isEditing ? 'Mettez à jour les informations du guide' : 'Créez un nouveau guide touristique'}
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">

        {/* Informations générales */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Informations générales</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Titre du guide *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Guide Côte d'Azur 2026"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Année *</label>
              <input
                type="number"
                name="year"
                value={formData.year}
                onChange={handleChange}
                required
                min={2020}
                max={2100}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Version</label>
              <input
                type="text"
                name="version"
                value={formData.version}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="1.0.0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Statut</label>
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
            {guideTemplates.length > 0 && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Template de guide</label>
                <select
                  name="guide_template_id"
                  value={formData.guide_template_id}
                  onChange={handleChange}
                  disabled={loadingTemplates}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                >
                  <option value="">{loadingTemplates ? 'Chargement...' : '— Sélectionner un template —'}</option>
                  {guideTemplates.map(t => (
                    <option key={t._id} value={t._id}>
                      {t.name}{t.is_default ? ' (défaut)' : ''}{t.description ? ` — ${t.description}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Périmètre géographique */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center justify-between">
            Périmètre géographique
            {regionsLoading && <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-400" />}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Sélectionnez la région Region Lovers — le site et la destination sont remplis automatiquement.
          </p>
          <select
            value={formData.destination_rl_id}
            onChange={e => handleRegionChange(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">— Choisir une région —</option>
            {regions.map(r => (
              <option key={r.id} value={r.id}>
                {r.assignedSiteNames[0] ? `${r.assignedSiteNames[0]} — ` : ''}{r.name}
              </option>
            ))}
          </select>
          {formData.destination && (
            <p className="mt-2 text-xs text-gray-400">
              Destination : <strong>{formData.destination}</strong>
              {formData.wp_site_id && <> · Site ID : <span className="font-mono">{formData.wp_site_id}</span></>}
            </p>
          )}
        </div>

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
            disabled={saving || !formData.destination_rl_id}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Enregistrement...' : isEditing ? 'Mettre à jour' : 'Créer le guide'}
          </button>
        </div>

      </form>
    </div>
  );
}
