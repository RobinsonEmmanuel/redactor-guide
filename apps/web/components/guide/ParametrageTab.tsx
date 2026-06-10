'use client';

import { useState, useEffect } from 'react';
import { PhotoIcon, CheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

interface ParametrageTabProps {
  guide: any;
  guideId: string;
  apiUrl: string;
  onGuideUpdated: () => void;
}

interface RegionEntry {
  id: string;
  name: string;
  assignedSiteIds: string[];
  assignedSiteNames: string[];
}

export default function ParametrageTab({ guide, guideId, apiUrl, onGuideUpdated }: ParametrageTabProps) {
  // Régions Region Lovers
  const [regions, setRegions] = useState<RegionEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<string>('');

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    year: new Date().getFullYear(),
    version: '1.0.0',
    language: 'fr',
    status: 'draft',
    destination: '',
    destination_rl_id: '',
    guide_template_id: '',
    google_drive_folder_id: '',
    image_principale: '',
  });

const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [guideTemplates, setGuideTemplates] = useState<any[]>([]);

  useEffect(() => {
    if (guide) {
      setFormData({
        name: guide.name || '',
        slug: guide.slug || '',
        year: guide.year || new Date().getFullYear(),
        version: guide.version || '1.0.0',
        language: guide.language || 'fr',
        status: guide.status || 'draft',
        destination: guide.destination || (guide.destinations?.[0] || ''),
        destination_rl_id: guide.destination_rl_id || '',
        guide_template_id: guide.guide_template_id || '',
        google_drive_folder_id: guide.google_drive_folder_id || '',
        image_principale: guide.image_principale || '',
      });
      // Pré-sélectionner le site si destination_rl_id déjà renseigné
      if (guide.destination_rl_id) {
        loadRegions().then((list) => {
          const found = list.find((r: RegionEntry) => r.id === guide.destination_rl_id);
          if (found?.assignedSiteNames?.[0]) setSelectedSite(found.assignedSiteNames[0]);
        });
      } else {
        loadRegions();
      }
    }
  }, [guide]);

  const loadRegions = async (): Promise<RegionEntry[]> => {
    setRegionsLoading(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/regions/overview`);
      if (!res.ok) return [];
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
      return list;
    } catch {
      return [];
    } finally {
      setRegionsLoading(false);
    }
  };

useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/guide-templates`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setGuideTemplates(data.templates || []);
        }
      } catch (err) {
        console.error('Erreur chargement templates:', err);
      }
    };
    loadTemplates();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSaved(false);
    setFormData(prev => ({ ...prev, [name]: name === 'year' ? parseInt(value) : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Sauvegarde du guide
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        alert('Erreur lors de la sauvegarde');
        return;
      }

      setSaved(true);
      onGuideUpdated();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const STATUS_OPTIONS = [
    { value: 'draft', label: 'Brouillon' },
    { value: 'in_progress', label: 'En cours' },
    { value: 'review', label: 'En revue' },
    { value: 'ready', label: 'Prêt' },
    { value: 'published', label: 'Publié' },
    { value: 'archived', label: 'Archivé' },
  ];

  const LANGUAGE_OPTIONS = [
    { value: 'fr', label: 'Français' },
    { value: 'it', label: 'Italien' },
    { value: 'es', label: 'Espagnol' },
    { value: 'de', label: 'Allemand' },
    { value: 'en', label: 'Anglais' },
    { value: 'pt-pt', label: 'Portugais' },
    { value: 'nl', label: 'Néerlandais' },
    { value: 'da', label: 'Danois' },
    { value: 'sv', label: 'Suédois' },
  ];

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <form onSubmit={handleSubmit} className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">⚙️ Paramétrage du guide</h2>
            <p className="text-sm text-gray-500 mt-1">Configuration générale et image de couverture</p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all shadow-sm ${
              saved
                ? 'bg-green-500 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {saving ? (
              <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Enregistrement...</>
            ) : saved ? (
              <><CheckIcon className="w-4 h-4" /> Enregistré !</>
            ) : (
              'Enregistrer'
            )}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Colonne gauche : aperçu couverture */}
          <div className="col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Couverture du guide</h3>

              {/* Preview livre */}
              <div className="relative mx-auto" style={{ width: '140px' }}>
                <div className="absolute inset-0 bg-gray-400 rounded-r-lg transform translate-x-1 translate-y-2 opacity-30" />
                <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-gray-300 to-gray-400 rounded-l-sm" />
                <div
                  className="relative rounded-lg overflow-hidden border-2 border-gray-200"
                  style={{ aspectRatio: '11/19', width: '140px' }}
                >
                  {formData.image_principale ? (
                    <>
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${formData.image_principale})` }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600" />
                  )}
                  <div className="relative h-full flex flex-col justify-end p-3 space-y-1">
                    <p className="text-[10px] text-white/70 uppercase tracking-wide font-medium">
                      {formData.name || 'Titre du guide'}
                    </p>
                    <p className="text-sm font-bold text-white leading-tight">
                      {formData.destination || 'Destination'}
                    </p>
                    <p className="text-xs text-white/80">{formData.year}</p>
                  </div>
                </div>
              </div>

              {/* Champ URL image */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  <PhotoIcon className="w-3.5 h-3.5 inline mr-1" />
                  URL de l'image principale
                </label>
                <input
                  type="url"
                  name="image_principale"
                  value={formData.image_principale}
                  onChange={handleChange}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Image affichée sur la couverture du guide
                </p>
              </div>
            </div>
          </div>

          {/* Colonne droite : formulaire */}
          <div className="col-span-2 space-y-4">

            {/* Infos générales */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
                Informations générales
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Titre du guide *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Guide Tenerife 2026"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Année</label>
                  <input
                    type="number"
                    name="year"
                    value={formData.year}
                    onChange={handleChange}
                    min={2020}
                    max={2100}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Version</label>
                  <input
                    type="text"
                    name="version"
                    value={formData.version}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1.0.0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Statut</label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Langue principale</label>
                  <select
                    name="language"
                    value={formData.language}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {LANGUAGE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {guideTemplates.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Template de guide</label>
                    <select
                      name="guide_template_id"
                      value={formData.guide_template_id}
                      onChange={handleChange}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">— Sélectionner un template —</option>
                      {guideTemplates.map((t: any) => (
                        <option key={t._id} value={t._id}>
                          {t.name}{t.is_default ? ' (défaut)' : ''}
                          {t.description ? ` — ${t.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Région Region Lovers */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                Region Lovers
                {regionsLoading && <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-400" />}
              </h3>

              {/* Sélecteur de site */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Site
                </label>
                <select
                  value={selectedSite}
                  onChange={e => {
                    setSelectedSite(e.target.value);
                    // reset région et destination si on change de site
                    setFormData(prev => ({ ...prev, destination_rl_id: '', destination: '' }));
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">— Choisir un site —</option>
                  {Array.from(new Set(regions.map(r => r.assignedSiteNames[0]).filter(Boolean)))
                    .sort((a, b) => a.localeCompare(b, 'fr'))
                    .map(site => (
                      <option key={site} value={site}>{site}</option>
                    ))}
                </select>
              </div>

              {/* Sélecteur de région */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Région
                </label>
                <select
                  name="destination_rl_id"
                  value={formData.destination_rl_id}
                  onChange={e => {
                    const regionId = e.target.value;
                    const region = regions.find(r => r.id === regionId);
                    // Auto-rempli destination depuis le nom de la région (utilisé dans l'export)
                    setFormData(prev => ({
                      ...prev,
                      destination_rl_id: regionId,
                      destination: region?.name ?? prev.destination,
                    }));
                  }}
                  disabled={!selectedSite}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
                >
                  <option value="">— Choisir une région —</option>
                  {regions
                    .filter(r => r.assignedSiteNames[0] === selectedSite)
                    .map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                </select>
                {formData.destination_rl_id && (
                  <p className="mt-1 text-xs text-gray-400 font-mono">
                    ID : {formData.destination_rl_id}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  Utilisé pour récupérer les POIs depuis l&apos;API Region Lovers
                </p>
              </div>
            </div>

            {/* Google Drive */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
                Google Drive (photos)
              </h3>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  ID du dossier Google Drive
                </label>
                <input
                  type="text"
                  name="google_drive_folder_id"
                  value={formData.google_drive_folder_id}
                  onChange={handleChange}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
                />
                <p className="mt-1 text-xs text-gray-400">
                  ID extrait de l&apos;URL Drive :{' '}
                  <span className="font-mono">drive.google.com/drive/folders/<strong>ID_ICI</strong></span>.
                  Le dossier doit être partagé avec le Service Account Google configuré sur le serveur.
                </p>
              </div>
            </div>


          </div>
        </div>

      </form>
    </div>
  );
}
