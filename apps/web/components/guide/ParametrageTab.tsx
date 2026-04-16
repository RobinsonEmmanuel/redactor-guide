'use client';

import { useState, useEffect } from 'react';
import { PhotoIcon, CheckIcon, ArrowPathIcon, ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

interface ParametrageTabProps {
  guide: any;
  guideId: string;
  apiUrl: string;
  onGuideUpdated: () => void;
}

export default function ParametrageTab({ guide, guideId, apiUrl, onGuideUpdated }: ParametrageTabProps) {
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
    wpConfig: { siteUrl: '' },
  });

  // Credentials WordPress — jamais stockés dans le guide, envoyés au service d'ingestion
  const [wpCredentials, setWpCredentials] = useState({ username: '', appPassword: '' });
  const [wpConnectStatus, setWpConnectStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [wpConnectMessage, setWpConnectMessage] = useState('');
  const [wpHasStoredCredentials, setWpHasStoredCredentials] = useState(false);

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
        wpConfig: { siteUrl: guide.wpConfig?.siteUrl || '' },
      });
      // Vérifier si des credentials sont déjà stockés dans site_connections
      checkStoredCredentials(guide.slug);
    }
  }, [guide]);

  const checkStoredCredentials = async (siteId: string) => {
    if (!siteId) return;
    try {
      const res = await authFetch(`${apiUrl}/api/v1/wp-sites`);
      if (res.ok) {
        const sites: any[] = await res.json();
        const found = sites.find((s: any) =>
          s._id === siteId || s.slug === siteId || s.name?.toLowerCase() === siteId
        );
        if (found?.hasPassword) {
          setWpHasStoredCredentials(true);
          setWpCredentials(prev => ({ ...prev, username: String(found.username ?? '') }));
        }
      }
    } catch { /* non bloquant */ }
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
    if (name.startsWith('wpConfig.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, wpConfig: { ...prev.wpConfig, [field]: value } }));
    } else {
      setFormData(prev => ({ ...prev, [name]: name === 'year' ? parseInt(value) : value }));
    }
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

      // 2. Si des credentials WordPress sont renseignés, les stocker automatiquement
      const siteId = formData.slug;
      if (siteId && wpCredentials.username && wpCredentials.appPassword) {
        try {
          const connectRes = await authFetch(`${apiUrl}/api/v1/wp-sites/${siteId}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: wpCredentials.username,
              appPassword: wpCredentials.appPassword,
              siteUrl: formData.wpConfig.siteUrl || undefined,
            }),
          });
          const connectData = await connectRes.json().catch(() => ({}));
          if (connectRes.ok && connectData.success) {
            setWpConnectStatus('connected');
            setWpConnectMessage(`Credentials WordPress enregistrés`);
            setWpHasStoredCredentials(true);
            setWpCredentials(p => ({ ...p, appPassword: '' }));
          } else {
            setWpConnectStatus('error');
            setWpConnectMessage(connectData.error || 'Erreur connexion WordPress');
          }
        } catch {
          setWpConnectStatus('error');
          setWpConnectMessage('Impossible de contacter le service d\'ingestion');
        }
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
            <p className="text-sm text-gray-500 mt-1">Configuration générale, image de couverture et connexion WordPress</p>
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
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Destination *</label>
                  <input
                    type="text"
                    name="destination"
                    value={formData.destination}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Tenerife"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Slug</label>
                  <input
                    type="text"
                    name="slug"
                    value={formData.slug}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    placeholder="guide-tenerife-2026"
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

            {/* ID Region Lovers */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
                Region Lovers
              </h3>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  ID de la destination Region Lovers
                </label>
                <input
                  type="text"
                  name="destination_rl_id"
                  value={formData.destination_rl_id}
                  onChange={handleChange}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="6703bae5ae4bca1fddab73c1"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Utilisé pour récupérer les POIs depuis l'API Region Lovers
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

            {/* WordPress */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Connexion WordPress</h3>
                {wpHasStoredCredentials && (
                  <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">
                    <ShieldCheckIcon className="w-3.5 h-3.5" />
                    Credentials stockés
                  </span>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">URL du site WordPress</label>
                  <input
                    type="url"
                    name="wpConfig.siteUrl"
                    value={formData.wpConfig.siteUrl}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="https://example.com"
                  />
                </div>

                {/* Séparateur credentials */}
                <div className="border-t border-dashed border-gray-200 pt-4">
                  <p className="text-xs text-gray-500 mb-3">
                    Les credentials sont stockés de façon sécurisée dans le service d'ingestion (non sauvegardés dans ce formulaire).
                    {wpHasStoredCredentials && ' Laissez le mot de passe vide pour conserver les credentials existants.'}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Identifiant WordPress</label>
                      <input
                        type="text"
                        value={wpCredentials.username ?? ''}
                        onChange={e => setWpCredentials(p => ({ ...p, username: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="admin"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Mot de passe applicatif</label>
                      <input
                        type="password"
                        value={wpCredentials.appPassword ?? ''}
                        onChange={e => setWpCredentials(p => ({ ...p, appPassword: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                        placeholder={wpHasStoredCredentials ? '••••••••••••' : 'xxxx xxxx xxxx xxxx xxxx xxxx'}
                        autoComplete="new-password"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        WordPress → Utilisateurs → Profil → Mots de passe d'application
                      </p>
                    </div>
                  </div>

                  {/* Statut connexion */}
                  {wpConnectStatus !== 'idle' && (
                    <div className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                      wpConnectStatus === 'connected' ? 'bg-green-50 text-green-800' :
                      wpConnectStatus === 'error'     ? 'bg-red-50 text-red-800' :
                      'bg-blue-50 text-blue-800'
                    }`}>
                      {wpConnectStatus === 'testing' && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                      {wpConnectStatus === 'connected' && <ShieldCheckIcon className="w-4 h-4" />}
                      {wpConnectStatus === 'error' && <ExclamationTriangleIcon className="w-4 h-4" />}
                      {wpConnectMessage}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={wpConnectStatus === 'testing' || !wpCredentials.username || !wpCredentials.appPassword}
                    onClick={async () => {
                      const siteId = formData.slug;
                      if (!siteId || !wpCredentials.username || !wpCredentials.appPassword) return;
                      setWpConnectStatus('testing');
                      setWpConnectMessage('Test de la connexion...');
                      try {
                        const res = await authFetch(`${apiUrl}/api/v1/wp-sites/${siteId}/connect`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            username: wpCredentials.username,
                            appPassword: wpCredentials.appPassword,
                          }),
                        });
                        const data = await res.json();
                        if (res.ok && data.success) {
                          setWpConnectStatus('connected');
                          setWpConnectMessage(`Connexion établie ! ${data.site?.name || ''}`);
                          setWpHasStoredCredentials(true);
                          setWpCredentials(p => ({ ...p, appPassword: '' }));
                        } else {
                          setWpConnectStatus('error');
                          setWpConnectMessage(data.error || data.message || 'Connexion échouée');
                        }
                      } catch {
                        setWpConnectStatus('error');
                        setWpConnectMessage('Impossible de joindre le service d\'ingestion');
                      }
                    }}
                    className="mt-3 flex items-center gap-2 px-4 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {wpConnectStatus === 'testing'
                      ? <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Test en cours...</>
                      : <><ShieldCheckIcon className="w-4 h-4" /> {wpHasStoredCredentials ? 'Mettre à jour les credentials' : 'Connecter WordPress'}</>
                    }
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>

      </form>
    </div>
  );
}
