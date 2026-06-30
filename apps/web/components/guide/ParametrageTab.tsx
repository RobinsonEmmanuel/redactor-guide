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

interface ClusterEntry {
  id: string;
  name: string;
  pois: PoiEntry[];
}

interface PoiEntry {
  id: string;
  name: string;
}

type ScopeType = 'region' | 'cluster' | 'poi';

export default function ParametrageTab({ guide, guideId, apiUrl, onGuideUpdated }: ParametrageTabProps) {
  // Régions Region Lovers
  const [regions, setRegions] = useState<RegionEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);

  // Clusters / POIs (chargés depuis RL API selon la région choisie)
  const [clusters, setClusters] = useState<ClusterEntry[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);

  // Langues WPML détectées
  const [detectedLanguages, setDetectedLanguages] = useState<string[]>([]);

  // Périmètre géographique
  const [scopeType, setScopeType] = useState<ScopeType>('region');
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [selectedPoiId, setSelectedPoiId] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    year: new Date().getFullYear(),
    version: '1.0.0',
    status: 'draft',
    destination: '',
    destination_rl_id: '',
    wp_site_id: '',
    scope_type: 'region' as ScopeType,
    scope_id: '',
    guide_template_id: '',
    google_drive_folder_id: '',
    image_principale: '',
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [guideTemplates, setGuideTemplates] = useState<any[]>([]);

  // Chargement initial
  useEffect(() => {
    if (guide) {
      const initialScopeType: ScopeType = guide.scope_type || 'region';
      setFormData({
        name: guide.name || '',
        slug: guide.slug || '',
        year: guide.year || new Date().getFullYear(),
        version: guide.version || '1.0.0',
        status: guide.status || 'draft',
        destination: guide.destination || (guide.destinations?.[0] || ''),
        destination_rl_id: guide.destination_rl_id || '',
        wp_site_id: guide.wp_site_id || '',
        scope_type: initialScopeType,
        scope_id: guide.scope_id || '',
        guide_template_id: guide.guide_template_id || '',
        google_drive_folder_id: guide.google_drive_folder_id || '',
        image_principale: guide.image_principale || '',
      });
      setScopeType(initialScopeType);
      setSelectedRegionId(guide.destination_rl_id || '');
      setSelectedClusterId(
        initialScopeType === 'cluster' ? (guide.scope_id || '') : ''
      );
      setSelectedPoiId(
        initialScopeType === 'poi' ? (guide.scope_id || '') : ''
      );

      loadRegions().then((list) => {
        // Si on a déjà une région et un scope non-region, charger les clusters
        if (guide.destination_rl_id && initialScopeType !== 'region') {
          loadClusters(guide.destination_rl_id);
        }
        // Pré-remplir les langues WPML depuis les articles déjà ingérés
        if (guide.wp_site_id) {
          detectLanguages();
        }
        // Restaurer la sélection du cluster si scope = cluster
        if (initialScopeType === 'cluster' && guide.scope_id) {
          setSelectedClusterId(guide.scope_id);
        }
        if (initialScopeType === 'poi' && guide.scope_id) {
          // Le cluster parent n'est pas stocké ; on récupérera les POIs après chargement des clusters
        }
      });
    }
  }, [guide]);

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

  const detectLanguages = async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/articles/languages`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.languages?.length > 0) {
        setDetectedLanguages(data.languages);
        // Sauvegarde silencieuse dans availableLanguages
        await fetch(`${apiUrl}/api/v1/guides/${guideId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ availableLanguages: data.languages }),
        });
      }
    } catch {
      // non bloquant
    }
  };

  const loadClusters = async (regionId: string) => {
    if (!regionId) { setClusters([]); return; }
    setClustersLoading(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/regions/${regionId}/clusters`);
      if (!res.ok) { setClusters([]); return; }
      const data = await res.json();
      setClusters(data.clusters || []);
    } catch {
      setClusters([]);
    } finally {
      setClustersLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSaved(false);
    setFormData(prev => ({ ...prev, [name]: name === 'year' ? parseInt(value) : value }));
  };

  const handleScopeTypeChange = (type: ScopeType) => {
    setScopeType(type);
    setSelectedClusterId('');
    setSelectedPoiId('');
    setFormData(prev => ({ ...prev, scope_type: type, scope_id: '' }));
    if (type !== 'region' && selectedRegionId) {
      loadClusters(selectedRegionId);
    }
    setSaved(false);
  };

  const handleRegionChange = (regionId: string) => {
    const region = regions.find(r => r.id === regionId);
    setSelectedRegionId(regionId);
    setSelectedClusterId('');
    setSelectedPoiId('');
    setClusters([]);
    setFormData(prev => ({
      ...prev,
      destination_rl_id: regionId,
      destination: region?.name ?? prev.destination,
      wp_site_id: region?.assignedSiteIds?.[0] ?? prev.wp_site_id,
      scope_id: '',
    }));
    if (scopeType !== 'region' && regionId) {
      loadClusters(regionId);
    }
    setSaved(false);
  };

  const handleClusterChange = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setSelectedPoiId('');
    setFormData(prev => ({
      ...prev,
      scope_id: scopeType === 'cluster' ? clusterId : prev.scope_id,
    }));
    setSaved(false);
  };

  const handlePoiChange = (poiId: string) => {
    setSelectedPoiId(poiId);
    setFormData(prev => ({ ...prev, scope_id: poiId }));
    setSaved(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
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
    } catch {
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

  const SCOPE_OPTIONS: { value: ScopeType; label: string; description: string }[] = [
    { value: 'region', label: 'Région', description: 'Guide couvrant toute la région' },
    { value: 'cluster', label: 'Cluster', description: 'Guide ciblé sur un groupe de lieux' },
    { value: 'poi', label: 'POI', description: 'Guide dédié à un lieu spécifique' },
  ];

  const selectedClusterPois = clusters.find(c => c.id === selectedClusterId)?.pois ?? [];

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <form onSubmit={handleSubmit} className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Paramétrage du guide</h2>
            <p className="text-sm text-gray-500 mt-1">Configuration générale et périmètre géographique</p>
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

            {/* Périmètre géographique */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                Périmètre géographique
                {(regionsLoading || clustersLoading) && (
                  <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-400" />
                )}
              </h3>

              {/* Type de périmètre */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-2">Type de périmètre</label>
                <div className="flex gap-2">
                  {SCOPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleScopeTypeChange(opt.value)}
                      title={opt.description}
                      className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-all ${
                        scopeType === opt.value
                          ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sélection région */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Région</label>
                <select
                  value={selectedRegionId}
                  onChange={e => handleRegionChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">— Choisir une région —</option>
                  {regions.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.assignedSiteNames[0] ? `${r.assignedSiteNames[0]} — ` : ''}{r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sélection cluster (si scope = cluster ou poi) */}
              {scopeType !== 'region' && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Cluster</label>
                  <select
                    value={selectedClusterId}
                    onChange={e => handleClusterChange(e.target.value)}
                    disabled={!selectedRegionId || clustersLoading || clusters.length === 0}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
                  >
                    <option value="">— Choisir un cluster —</option>
                    {clusters.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {selectedRegionId && !clustersLoading && clusters.length === 0 && (
                    <p className="mt-1 text-xs text-amber-500">Aucun cluster trouvé pour cette région</p>
                  )}
                </div>
              )}

              {/* Sélection POI (si scope = poi) */}
              {scopeType === 'poi' && selectedClusterId && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Lieu (POI)</label>
                  <select
                    value={selectedPoiId}
                    onChange={e => handlePoiChange(e.target.value)}
                    disabled={selectedClusterPois.length === 0}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
                  >
                    <option value="">— Choisir un lieu —</option>
                    {selectedClusterPois.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Résumé des IDs techniques */}
              {formData.destination_rl_id && (
                <div className="mt-2 p-2 bg-gray-50 rounded-lg space-y-0.5">
                  <p className="text-xs text-gray-400 font-mono">
                    Région : {formData.destination_rl_id}
                    {formData.destination ? ` (${formData.destination})` : ''}
                  </p>
                  {formData.wp_site_id && (
                    <p className="text-xs text-gray-400 font-mono">Site ID : {formData.wp_site_id}</p>
                  )}
                  {formData.scope_id && (
                    <p className="text-xs text-gray-400 font-mono">
                      {scopeType === 'cluster' ? 'Cluster' : 'POI'} ID : {formData.scope_id}
                    </p>
                  )}
                </div>
              )}

              {/* Langues WPML détectées */}
              {detectedLanguages.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-600 mb-1.5">
                    Langues WPML détectées
                    <span className="ml-1 text-gray-400 font-normal">(depuis les articles ingérés)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedLanguages.map(lang => (
                      <span key={lang} className="px-2 py-0.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full font-mono">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
