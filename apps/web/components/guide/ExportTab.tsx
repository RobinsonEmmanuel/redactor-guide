'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MapPinIcon,
  PhotoIcon,
  SwatchIcon,
  LanguageIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface ExportTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
}

const LANGUAGES = [
  { code: 'fr',    label: 'Français',    flag: '🇫🇷', native: true },
  { code: 'en',    label: 'Anglais',     flag: '🇬🇧', native: false },
  { code: 'de',    label: 'Allemand',    flag: '🇩🇪', native: false },
  { code: 'it',    label: 'Italien',     flag: '🇮🇹', native: false },
  { code: 'es',    label: 'Espagnol',    flag: '🇪🇸', native: false },
  { code: 'pt-pt', label: 'Portugais',   flag: '🇵🇹', native: false },
  { code: 'nl',    label: 'Néerlandais', flag: '🇳🇱', native: false },
  { code: 'da',    label: 'Danois',      flag: '🇩🇰', native: false },
  { code: 'sv',    label: 'Suédois',     flag: '🇸🇪', native: false },
];

const TEMPLATE_COLORS: Record<string, string> = {
  COUVERTURE:                'bg-purple-100 text-purple-700',
  PRESENTATION_GUIDE:        'bg-blue-100 text-blue-700',
  PRESENTATION_DESTINATION:  'bg-blue-100 text-blue-700',
  CARTE_DESTINATION:         'bg-cyan-100 text-cyan-700',
  CLUSTER:                   'bg-orange-100 text-orange-700',
  SECTION_INTRO:             'bg-orange-100 text-orange-700',
  POI:                       'bg-green-100 text-green-700',
  INSPIRATION:               'bg-pink-100 text-pink-700',
  SAISON:                    'bg-yellow-100 text-yellow-700',
  ALLER_PLUS_LOIN:           'bg-gray-100 text-gray-700',
  A_PROPOS_RL:               'bg-gray-100 text-gray-700',
};

type TranslationStatus = 'idle' | 'processing' | 'completed' | 'failed';

interface TranslationState {
  status: TranslationStatus;
  progress: { done: number; total: number } | null;
  translated_at: string | null;
  error: string | null;
}

export default function ExportTab({ guideId, guide, apiUrl }: ExportTabProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['fr']);
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloadingZip, setDownloadingZip] = useState<Record<string, boolean>>({});
  const [downloadingGeoJson, setDownloadingGeoJson] = useState(false);
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);
  const [translationStates, setTranslationStates] = useState<Record<string, TranslationState>>({});
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  const [overflowModal, setOverflowModal] = useState<{ lang: string; warnings: OverflowWarning[] } | null>(null);
  const pollingRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    loadPreview();
    // Charger le statut de traduction pour toutes les langues non-FR
    LANGUAGES.filter(l => !l.native).forEach(l => loadTranslationStatus(l.code));
    return () => {
      // Nettoyer les intervalles de polling au démontage
      Object.values(pollingRefs.current).forEach(clearInterval);
    };
  }, []);

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/export/preview`, {
        credentials: 'include',
      });
      if (res.ok) setPreview(await res.json());
    } catch (err) {
      console.error('Erreur chargement preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadTranslationStatus = useCallback(async (lang: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translation-status?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      setTranslationStates(prev => ({ ...prev, [lang]: data }));
      return data;
    } catch (err) {
      console.error(`Erreur statut traduction ${lang}:`, err);
    }
  }, [apiUrl, guideId]);

  const fetchOverflowsForLang = useCallback(async (lang: string): Promise<OverflowWarning[]> => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translation-overflows`,
        { credentials: 'include' }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.warnings ?? []).filter((w: OverflowWarning) => w.lang === lang);
    } catch {
      return [];
    }
  }, [apiUrl, guideId]);

  const startPolling = useCallback((lang: string) => {
    if (pollingRefs.current[lang]) clearInterval(pollingRefs.current[lang]);
    pollingRefs.current[lang] = setInterval(async () => {
      const data = await loadTranslationStatus(lang);
      if (data?.status === 'completed' || data?.status === 'failed') {
        clearInterval(pollingRefs.current[lang]);
        delete pollingRefs.current[lang];
        setTranslating(prev => ({ ...prev, [lang]: false }));
        // Si traduction terminée avec succès, ouvrir la modale si overflows
        if (data?.status === 'completed') {
          const overflows = await fetchOverflowsForLang(lang);
          if (overflows.length > 0) {
            setOverflowModal({ lang, warnings: overflows });
          }
        }
      }
    }, 3000);
  }, [loadTranslationStatus, fetchOverflowsForLang]);

  const translateLanguage = async (lang: string) => {
    setTranslating(prev => ({ ...prev, [lang]: true }));
    setTranslationStates(prev => ({
      ...prev,
      [lang]: { status: 'processing', progress: { done: 0, total: 0 }, translated_at: null, error: null },
    }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translate?lang=${lang}`,
        { method: 'POST', credentials: 'include' }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erreur traduction');
      }
      startPolling(lang);
    } catch (err: any) {
      setTranslating(prev => ({ ...prev, [lang]: false }));
      setTranslationStates(prev => ({
        ...prev,
        [lang]: { status: 'failed', progress: null, translated_at: null, error: err.message },
      }));
    }
  };

  const toggleLanguage = (code: string) => {
    setSelectedLanguages(prev =>
      prev.includes(code) ? prev.filter(l => l !== code) : [...prev, code]
    );
  };

  const downloadExport = async (lang: string) => {
    setDownloading(prev => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export?lang=${lang}&download=true`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Erreur export');
      const data = await res.json();
      const slugifyLocal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const destination = slugifyLocal(data.meta?.destination || data.meta?.guide_name || 'guide');
      const filename = `guide_${destination}_${lang}_${datePart}_${timePart}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDownloadedFiles(prev => [...prev.filter(f => !f.includes(`_${lang}.json`)), filename]);
    } catch (err) {
      alert(`Erreur lors de l'export en ${lang}`);
    } finally {
      setDownloading(prev => ({ ...prev, [lang]: false }));
    }
  };

  const downloadZip = async (lang: string) => {
    setDownloadingZip(prev => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/zip?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();

      // Lire le nom depuis Content-Disposition du serveur (inclut date+heure)
      const cd = res.headers.get('content-disposition') || '';
      const cdMatch = cd.match(/filename="([^"]+)"/);
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
      const fallbackName = `guide_${dest}_${lang}_${datePart}_${timePart}.zip`;
      const filename = cdMatch ? cdMatch[1] : fallbackName;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDownloadedFiles(prev => [...prev.filter(f => !f.endsWith(`_${lang}.zip`)), filename]);
    } catch (err) {
      alert(`Erreur lors du téléchargement du ZIP en ${lang}`);
    } finally {
      setDownloadingZip(prev => ({ ...prev, [lang]: false }));
    }
  };

  const downloadAllSelected = async () => {
    for (const lang of selectedLanguages) await downloadExport(lang);
  };

  const downloadGeoJson = async () => {
    setDownloadingGeoJson(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/geojson`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();

      const cd = res.headers.get('content-disposition') || '';
      const cdMatch = cd.match(/filename="([^"]+)"/);
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
      const fallbackName = `pois_${dest}_${datePart}_${timePart}.geojson`;
      const filename = cdMatch ? cdMatch[1] : fallbackName;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDownloadedFiles(prev => [...prev.filter(f => !f.endsWith('.geojson')), filename]);
    } catch (err) {
      alert('Erreur lors du téléchargement du GeoJSON');
    } finally {
      setDownloadingGeoJson(false);
    }
  };

  const renderTranslationBadge = (lang: string) => {
    const state = translationStates[lang];
    if (!state || state.status === 'idle') {
      return (
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <LanguageIcon className="w-3 h-3" /> Non traduit
        </span>
      );
    }
    if (state.status === 'processing') {
      const { done = 0, total = 0 } = state.progress || {};
      return (
        <span className="text-xs text-blue-600 flex items-center gap-1">
          <ArrowPathIcon className="w-3 h-3 animate-spin" />
          {total > 0 ? `${done}/${total} pages` : 'En cours…'}
        </span>
      );
    }
    if (state.status === 'completed') {
      const date = state.translated_at
        ? new Date(state.translated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      return (
        <span className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircleIcon className="w-3 h-3" /> Traduit {date}
        </span>
      );
    }
    if (state.status === 'failed') {
      return (
        <span className="text-xs text-red-500 flex items-center gap-1">
          <ExclamationTriangleIcon className="w-3 h-3" /> Erreur
        </span>
      );
    }
    return null;
  };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">📦 Export InDesign</h2>
            <p className="text-sm text-gray-500 mt-1">JSON normalisé layout-ready pour data merge</p>
          </div>
          <div className="flex gap-2">
            {/* GeoJSON — indépendant de la sélection de langue */}
            <button
              onClick={downloadGeoJson}
              disabled={downloadingGeoJson}
              title="GeoJSON de tous les POIs groupés par cluster (pour cartographie)"
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingGeoJson
                ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                : <MapPinIcon className="w-4 h-4" />}
              GeoJSON
            </button>
            {selectedLanguages.length > 0 && (
              <>
                <button
                  onClick={downloadAllSelected}
                  disabled={Object.values(downloading).some(Boolean)}
                  title="JSON seul (sans images)"
                  className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors shadow-sm border border-gray-300 disabled:opacity-50"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  JSON
                </button>
                <button
                  onClick={() => selectedLanguages.forEach(l => downloadZip(l))}
                  disabled={Object.values(downloadingZip).some(Boolean)}
                  title="ZIP complet : JSON + toutes les images téléchargées (opération longue)"
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {Object.values(downloadingZip).some(Boolean)
                    ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    : <ArrowDownTrayIcon className="w-4 h-4" />}
                  ZIP + images
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        {loadingPreview ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-3">
            <ArrowPathIcon className="w-5 h-5 text-gray-400 animate-spin" />
            <span className="text-gray-500 text-sm">Chargement des statistiques...</span>
          </div>
        ) : preview ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
              Contenu disponible à l'export
            </h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{preview.meta.stats.exported}</div>
                <div className="text-xs text-blue-600 mt-1">Pages exportables</div>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <div className="text-2xl font-bold text-amber-700">{preview.meta.stats.excluded_draft}</div>
                <div className="text-xs text-amber-600 mt-1">Brouillons exclus</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{preview.meta.stats.total_pages}</div>
                <div className="text-xs text-green-600 mt-1">Pages totales</div>
              </div>
            </div>
            {preview.summary_by_template && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.summary_by_template).map(([template, count]) => (
                  <span
                    key={template}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${TEMPLATE_COLORS[template] || 'bg-gray-100 text-gray-700'}`}
                  >
                    {template}
                    <span className="bg-white/60 px-1.5 py-0.5 rounded-full font-bold">{count as number}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Sélection des langues */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Langues à exporter <span className="text-gray-400 font-normal">(un fichier JSON par langue)</span>
          </h3>
          <div className="space-y-2">
            {LANGUAGES.map(lang => {
              const isSelected = selectedLanguages.includes(lang.code);
              const isDownloading = downloading[lang.code];
              const isDownloaded = downloadedFiles.some(f => f.endsWith(`_${lang.code}.json`));
              const tState = translationStates[lang.code];
              const isTranslating = translating[lang.code] || tState?.status === 'processing';
              const isTranslated = lang.native || tState?.status === 'completed';

              return (
                <div
                  key={lang.code}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  {/* Sélection */}
                  <button
                    type="button"
                    onClick={() => toggleLanguage(lang.code)}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <div className="text-left min-w-0">
                      <div className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                        {lang.label}
                      </div>
                      {!lang.native && (
                        <div className="mt-0.5">
                          {renderTranslationBadge(lang.code)}
                        </div>
                      )}
                    </div>
                    {isDownloaded && <CheckCircleIcon className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
                  </button>

                  {/* Actions traduction (langues non-FR) */}
                  {!lang.native && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isTranslating ? (
                        <button
                          disabled
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg cursor-not-allowed"
                        >
                          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                          Traduction…
                        </button>
                      ) : (
                        <button
                          onClick={() => translateLanguage(lang.code)}
                          title={isTranslated ? 'Retraduire' : 'Lancer la traduction via IA'}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            isTranslated
                              ? 'text-gray-500 bg-white border-gray-200 hover:bg-gray-50'
                              : 'text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100'
                          }`}
                        >
                          <LanguageIcon className="w-3.5 h-3.5" />
                          {isTranslated ? 'Retraduire' : 'Traduire'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Actions téléchargement (quand sélectionné) */}
                  {isSelected && (
                    <div className="flex gap-1 flex-shrink-0">
                      {/* Avertissement si non traduit */}
                      {!lang.native && !isTranslated && (
                        <span title="Contenu en français — traduction non effectuée">
                          <ClockIcon className="w-4 h-4 text-amber-400 mt-1" />
                        </span>
                      )}
                      {/* JSON seul */}
                      <button
                        onClick={() => downloadExport(lang.code)}
                        disabled={isDownloading}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                        title={`Télécharger JSON ${lang.label}`}
                      >
                        {isDownloading
                          ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          : <ArrowDownTrayIcon className="w-4 h-4" />}
                      </button>
                      {/* ZIP + images */}
                      <button
                        onClick={() => downloadZip(lang.code)}
                        disabled={downloadingZip[lang.code]}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        title={`ZIP + images ${lang.label}`}
                      >
                        {downloadingZip[lang.code]
                          ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          : <span className="text-xs font-bold">ZIP</span>}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Alertes de dépassement de calibre */}
        <OverflowAlertsPanel
          guideId={guideId}
          apiUrl={apiUrl}
          onOpenCorrection={(lang, warnings) => setOverflowModal({ lang, warnings })}
        />

        {/* Modale de correction manuelle des overflows */}
        {overflowModal && (
          <OverflowCorrectionModal
            guideId={guideId}
            apiUrl={apiUrl}
            lang={overflowModal.lang}
            initialWarnings={overflowModal.warnings}
            onClose={() => setOverflowModal(null)}
          />
        )}

        {/* Structure du JSON */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
            Structure du fichier JSON
          </h3>
          <div className="space-y-3">
            {[
              {
                icon: <DocumentTextIcon className="w-4 h-4" />,
                color: 'text-blue-600 bg-blue-50',
                title: 'meta',
                desc: 'Nom, destination, année, langue, date export, statistiques (pages exportées / brouillons exclus)',
              },
              {
                icon: <SwatchIcon className="w-4 h-4" />,
                color: 'text-purple-600 bg-purple-50',
                title: 'mappings',
                desc: 'Correspondances field → calque InDesign, picto_layers, picto_values (valeur brute → clé abstraite PICTO_XXX)',
              },
              {
                icon: <DocumentTextIcon className="w-4 h-4" />,
                color: 'text-green-600 bg-green-50',
                title: 'pages[].content.text',
                desc: 'Champs texte et méta indexés par nom de champ (ex: POI_titre_1, POI_meta_duree)',
              },
              {
                icon: <PhotoIcon className="w-4 h-4" />,
                color: 'text-orange-600 bg-orange-50',
                title: 'pages[].content.images',
                desc: 'Images avec url distante + local_filename normalisé (p012_poi_grand_rond.jpg) + local_path',
              },
              {
                icon: <SwatchIcon className="w-4 h-4" />,
                color: 'text-pink-600 bg-pink-50',
                title: 'pages[].content.pictos',
                desc: 'Pictos avec valeur brute (incontournable/oui/50…) + picto_key abstrait (PICTO_SMILEY_3 ou null si non affiché) + calque InDesign',
              },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`p-1.5 rounded-lg flex-shrink-0 ${item.color}`}>
                  {item.icon}
                </div>
                <div>
                  <code className="text-xs font-mono font-semibold text-gray-800">{item.title}</code>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Note ZIP */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">ZIP + images</p>
          <p className="text-xs text-amber-700">
            Le bouton <strong>ZIP</strong> télécharge toutes les images depuis WordPress côté serveur
            puis te renvoie une archive prête pour InDesign. L'opération peut prendre
            30–60 secondes selon le nombre d'images.
          </p>
        </div>

        {/* Fichiers téléchargés */}
        {downloadedFiles.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-green-800 mb-2">Fichiers téléchargés</h3>
            <div className="space-y-1">
              {downloadedFiles.map(filename => (
                <div key={filename} className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
                  <code className="font-mono text-xs">{filename}</code>
                  {filename.endsWith('.zip') && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                      JSON + images
                    </span>
                  )}
                  {filename.endsWith('.geojson') && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                      POIs cartographie
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Import GeoJSON → mise à jour des coordonnées GPS */}
        <GeoJsonImportPanel guideId={guideId} apiUrl={apiUrl} />

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types communs
// ---------------------------------------------------------------------------
interface OverflowWarning {
  page_id:        string;
  page_titre:     string;
  field_key:      string;
  lang:           string;
  current_length: number;
  max_chars:      number;
  current_value?: string | null;
}

// ---------------------------------------------------------------------------
// Panneau d'alertes de dépassement de calibre post-traduction
// ---------------------------------------------------------------------------
function OverflowAlertsPanel({
  guideId,
  apiUrl,
  onOpenCorrection,
}: {
  guideId: string;
  apiUrl: string;
  onOpenCorrection: (lang: string, warnings: OverflowWarning[]) => void;
}) {
  const [warnings, setWarnings]   = useState<OverflowWarning[]>([]);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/guides/${guideId}/translation-overflows`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { warnings: [] })
      .then(d => { setWarnings(d.warnings ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [guideId, apiUrl]);

  if (loading || warnings.length === 0) return null;

  const byLang = warnings.reduce<Record<string, OverflowWarning[]>>((acc, w) => {
    (acc[w.lang] = acc[w.lang] ?? []).push(w);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl border border-amber-300 p-5">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <h3 className="text-sm font-semibold text-amber-700">
            {warnings.length} dépassement{warnings.length > 1 ? 's' : ''} de calibre — correction manuelle requise
          </h3>
        </div>
        <span className="text-xs text-amber-500">{collapsed ? '▼ Afficher' : '▲ Réduire'}</span>
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-gray-500">
            Ces champs dépassent le calibre InDesign après toutes les passes de condensation IA.
          </p>
          {Object.entries(byLang).map(([lang, ws]) => (
            <div key={lang}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {LANGUAGES.find(l => l.code === lang)?.flag} {LANGUAGES.find(l => l.code === lang)?.label ?? lang}
                  <span className="ml-2 text-amber-600">({ws.length} champ{ws.length > 1 ? 's' : ''})</span>
                </div>
                <button
                  onClick={() => onOpenCorrection(lang, ws)}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" />
                  Corriger manuellement
                </button>
              </div>
              <div className="space-y-2">
                {ws.map((w, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800 truncate block">{w.page_titre}</span>
                      <span className="text-gray-500">
                        <code className="bg-gray-100 px-1 rounded text-xs">{w.field_key}</code>
                        {' '}— {w.current_length} car. pour un max de {w.max_chars} car.
                        {' '}(<span className="text-amber-600 font-medium">+{w.current_length - w.max_chars}</span>)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modale de correction manuelle des overflows
// ---------------------------------------------------------------------------
function OverflowCorrectionModal({
  guideId,
  apiUrl,
  lang,
  initialWarnings,
  onClose,
}: {
  guideId: string;
  apiUrl: string;
  lang: string;
  initialWarnings: OverflowWarning[];
  onClose: () => void;
}) {
  const langMeta = LANGUAGES.find(l => l.code === lang);
  const [warnings, setWarnings]   = useState<OverflowWarning[]>(initialWarnings);
  const [values, setValues]       = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const w of initialWarnings) {
      init[`${w.page_id}__${w.field_key}`] = w.current_value ?? '';
    }
    return init;
  });
  const [saving, setSaving]       = useState<Record<string, boolean>>({});
  const [saved, setSaved]         = useState<Record<string, boolean>>({});
  const [errors, setErrors]       = useState<Record<string, string>>({});

  const fieldKey = (w: OverflowWarning) => `${w.page_id}__${w.field_key}`;

  const saveField = async (w: OverflowWarning) => {
    const k = fieldKey(w);
    const value = values[k] ?? '';
    setSaving(prev => ({ ...prev, [k]: true }));
    setErrors(prev => ({ ...prev, [k]: '' }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/pages/${w.page_id}/translation-field`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang, field_key: w.field_key, value }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Erreur serveur');
      }
      setSaved(prev => ({ ...prev, [k]: true }));
      // Retirer l'overflow de la liste locale
      setWarnings(prev => prev.filter(x => fieldKey(x) !== k));
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [k]: err.message }));
    } finally {
      setSaving(prev => ({ ...prev, [k]: false }));
    }
  };

  const allDone = warnings.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Correction des dépassements de calibre
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {langMeta?.flag} {langMeta?.label ?? lang}
                {!allDone && (
                  <> — <span className="text-amber-600 font-medium">{warnings.length} champ{warnings.length > 1 ? 's' : ''} à corriger</span></>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Corps */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {allDone ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <CheckCircleIcon className="w-10 h-10 text-green-500" />
              <p className="text-sm font-medium text-gray-700">Tous les champs ont été corrigés.</p>
              <p className="text-xs text-gray-500">Les valeurs ont été enregistrées en base.</p>
            </div>
          ) : (
            warnings.map((w) => {
              const k     = fieldKey(w);
              const val   = values[k] ?? '';
              const len   = val.length;
              const over  = len > w.max_chars;
              const pct   = Math.min(100, Math.round((len / w.max_chars) * 100));

              return (
                <div key={k} className="border border-gray-200 rounded-xl p-4 space-y-3">
                  {/* Page + champ */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">{w.page_titre}</p>
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{w.field_key}</code>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${over ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {len} / {w.max_chars} car.
                    </span>
                  </div>

                  {/* Textarea */}
                  <textarea
                    value={val}
                    onChange={e => {
                      setValues(prev => ({ ...prev, [k]: e.target.value }));
                      setSaved(prev => ({ ...prev, [k]: false }));
                    }}
                    rows={3}
                    className={`w-full text-sm rounded-lg border px-3 py-2 resize-y focus:outline-none focus:ring-2 transition-colors ${
                      over
                        ? 'border-red-300 focus:ring-red-300 bg-red-50'
                        : 'border-gray-300 focus:ring-blue-300'
                    }`}
                  />

                  {/* Barre de progression */}
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${over ? 'bg-red-500' : 'bg-green-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Erreur + bouton */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-red-500">{errors[k] ?? ''}</p>
                    <button
                      onClick={() => saveField(w)}
                      disabled={saving[k] || (over)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-700 text-white disabled:cursor-not-allowed"
                    >
                      {saving[k] ? (
                        <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                      ) : saved[k] ? (
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                      )}
                      {saved[k] ? 'Enregistré' : over ? `Réduire de ${len - w.max_chars} car.` : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {allDone ? 'Fermer' : 'Fermer sans tout corriger'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import GeoJSON → mise à jour des coordonnées GPS
// ---------------------------------------------------------------------------
interface MatchEntry {
  page_id:          string;
  page_titre:       string;
  geojson_name:     string;
  translated_name:  string | null;
  is_translated:    boolean;
  match_quality:    'exact' | 'partial';
  current_coords:   { lat: number; lon: number } | null;
  new_coords:       { lat: number; lon: number };
  status:           'update' | 'identical';
}

interface PreviewResult {
  matches:           MatchEntry[];
  unmatched_geojson: Array<{ name: string; translated_name: string | null; coords: { lat: number; lon: number } }>;
  unmatched_pages:   Array<{ page_id: string; titre: string }>;
  stats: {
    total_features: number; matched: number;
    matched_direct: number; matched_translated: number;
    to_update: number; identical: number;
    unmatched_geojson: number; unmatched_pages: number;
  };
}

function GeoJsonImportPanel({ guideId, apiUrl }: { guideId: string; apiUrl: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open,        setOpen]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [applying,    setApplying]    = useState(false);
  const [preview,     setPreview]     = useState<PreviewResult | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ updated: number; attempted: number } | null>(null);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());

  const reset = () => {
    setPreview(null); setError(null); setApplyResult(null);
    setSelected(new Set()); setManualMatches([]); setPendingGeoJson(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true); setError(null); setPreview(null); setApplyResult(null);
    try {
      const allFeatures: any[] = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const json = JSON.parse(text);
        allFeatures.push(...(json.features ?? (json.type === 'Feature' ? [json] : [])));
      }
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/import/geojson/preview`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: allFeatures }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      setPreview(data);
      setSelected(new Set(data.matches.filter((m: MatchEntry) => m.status === 'update').map((m: MatchEntry) => m.page_id)));
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setLoading(false);
    }
  };

  // ── Matching manuel ────────────────────────────────────────────────────────
  type ManualMatch = {
    geojsonName: string;
    coords: { lat: number; lon: number };
    pageId: string;
    pageTitre: string;
  };
  const [manualMatches,    setManualMatches]    = useState<ManualMatch[]>([]);
  const [pendingGeoJson,   setPendingGeoJson]   = useState<string | null>(null); // nom GeoJSON sélectionné

  const handleApply = async () => {
    const hasAuto   = selected.size > 0;
    const hasManual = manualMatches.length > 0;
    if (!preview || (!hasAuto && !hasManual)) return;
    setApplying(true); setError(null);
    try {
      const autoUpdates = (preview?.matches ?? [])
        .filter(m => selected.has(m.page_id))
        .map(m => ({
          pageId:          m.page_id,
          lat:             m.new_coords.lat,
          lon:             m.new_coords.lon,
          nomVernaculaire: m.is_translated ? m.geojson_name : undefined,
        }));
      const manualUpdates = manualMatches.map(m => ({
        pageId:          m.pageId,
        lat:             m.coords.lat,
        lon:             m.coords.lon,
        nomVernaculaire: m.geojsonName,
      }));
      const updates = [...autoUpdates, ...manualUpdates];
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/import/geojson/apply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      setApplyResult(data);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'application');
    } finally {
      setApplying(false);
    }
  };

  const toggleRow = (pageId: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(pageId) ? n.delete(pageId) : n.add(pageId); return n; });
  };
  const toggleGroup = (rows: MatchEntry[]) => {
    const ids = rows.map(m => m.page_id);
    setSelected(prev =>
      ids.every(id => prev.has(id))
        ? new Set([...prev].filter(id => !ids.includes(id)))
        : new Set([...prev, ...ids])
    );
  };

  // Rows par catégorie
  // Exact update : sélectionnés par défaut
  const exactUpdateRows   = preview?.matches.filter(m => m.match_quality === 'exact'   && m.status === 'update')   ?? [];
  // Partial (tous) : à valider manuellement (non sélectionnés par défaut)
  const partialRows       = preview?.matches.filter(m => m.match_quality === 'partial') ?? [];
  // Exact identical : déjà OK, collapsé
  const exactIdentRows    = preview?.matches.filter(m => m.match_quality === 'exact'   && m.status === 'identical') ?? [];
  // compat alias
  const toUpdateRows      = exactUpdateRows;
  const identicalRows     = exactIdentRows;

  const MatchTable = ({ rows, accentColor }: { rows: MatchEntry[]; accentColor: string }) => (
    <div className="rounded-xl border border-gray-200 overflow-hidden text-xs">
      <table className="w-full">
        <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide">
          <tr>
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2 text-left">Page (français)</th>
            <th className="px-3 py-2 text-left">Nom GeoJSON</th>
            <th className="px-3 py-2 text-left">Coords actuelles</th>
            <th className="px-3 py-2 text-left">Nouvelles coords</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(m => (
            <tr
              key={m.page_id}
              className={`cursor-pointer transition-colors ${selected.has(m.page_id) ? accentColor : 'hover:bg-gray-50'}`}
              onClick={() => toggleRow(m.page_id)}
            >
              <td className="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={selected.has(m.page_id)}
                  onChange={() => toggleRow(m.page_id)}
                  onClick={e => e.stopPropagation()}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
              </td>
              <td className="px-3 py-2 font-medium text-gray-800">{m.page_titre}</td>
              <td className="px-3 py-2 text-gray-500">
                {m.is_translated ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-gray-400 italic">{m.geojson_name}</span>
                    <span className="text-gray-300">→</span>
                    <span className="text-violet-700 font-medium">{m.translated_name}</span>
                    <span className="text-[9px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-medium uppercase tracking-wide">IA</span>
                    {m.match_quality === 'partial' && (
                      <span className="text-[9px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-medium uppercase tracking-wide">~partiel</span>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    {m.geojson_name}
                    {m.match_quality === 'partial' && (
                      <span className="text-[9px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-medium uppercase tracking-wide">~partiel</span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-gray-400">
                {m.current_coords
                  ? `${m.current_coords.lat.toFixed(5)}, ${m.current_coords.lon.toFixed(5)}`
                  : <span className="italic text-gray-300">aucune</span>}
              </td>
              <td className="px-3 py-2 font-mono text-emerald-700">
                {m.new_coords.lat.toFixed(5)}, {m.new_coords.lon.toFixed(5)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-emerald-200">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => { setOpen(o => !o); if (!open) reset(); }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-50">
            <MapPinIcon className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Import GPS — fichiers GeoJSON</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Importer des fichiers uMap · matching direct + traduction IA des noms vernaculaires
            </p>
          </div>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-emerald-100 pt-4 space-y-4">

          {/* Zone de dépôt */}
          {!preview && !loading && (
            <div
              className="border-2 border-dashed border-emerald-300 rounded-xl p-6 text-center cursor-pointer hover:bg-emerald-50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            >
              <MapPinIcon className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">Déposer les fichiers GeoJSON ici</p>
              <p className="text-xs text-gray-400 mt-1">Plusieurs fichiers acceptés — matching direct puis traduction IA des noms vernaculaires</p>
              <input ref={fileRef} type="file" accept=".geojson,application/geo+json,application/json"
                multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
            </div>
          )}

          {loading && (
            <div className="space-y-2 py-2">
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <ArrowPathIcon className="w-5 h-5 animate-spin text-emerald-500" />
                Analyse + traduction IA des noms vernaculaires…
              </div>
              <p className="text-xs text-gray-400 pl-8">Les noms sans correspondance directe sont traduits en français par GPT-4o-mini.</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {applyResult && (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <CheckCircleIcon className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  {applyResult.updated} coordonnée{applyResult.updated > 1 ? 's' : ''} mise{applyResult.updated > 1 ? 's' : ''} à jour
                </p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  Coordonnées + noms vernaculaires enregistrés — re-télécharge le GeoJSON pour vérifier.
                </p>
              </div>
            </div>
          )}

          {preview && !applyResult && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  { label: 'Match exact',       value: preview.stats.matched_direct,     color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                  { label: 'Match approx. / IA',value: partialRows.length,               color: 'bg-orange-50 border-orange-200 text-orange-700' },
                  { label: 'À affecter manuellement', value: preview.stats.unmatched_geojson, color: 'bg-gray-50 border-gray-200 text-gray-500' },
                  { label: 'À mettre à jour',   value: preview.stats.to_update + manualMatches.length, color: 'bg-amber-50 border-amber-200 text-amber-700' },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg border px-2 py-2 ${s.color}`}>
                    <p className="text-lg font-bold">{s.value}</p>
                    <p className="text-[10px] mt-0.5 leading-tight">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* ── Section 1 : Mises à jour exactes (auto-validées) ── */}
              {toUpdateRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Mises à jour — match exact ({toUpdateRows.length})
                    </p>
                    <button type="button" onClick={() => toggleGroup(toUpdateRows)} className="text-xs text-emerald-600 hover:underline">
                      {toUpdateRows.every(m => selected.has(m.page_id)) ? 'Tout désélectionner' : 'Tout sélectionner'}
                    </button>
                  </div>
                  <MatchTable rows={toUpdateRows} accentColor="bg-amber-50" />
                </div>
              )}

              {/* ── Section 2 : Rapprochements approx. / IA — à valider ── */}
              {partialRows.length > 0 && (
                <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ExclamationTriangleIcon className="w-4 h-4 text-orange-500 flex-shrink-0" />
                      <p className="text-xs font-semibold text-orange-800">
                        Rapprochements approximatifs — à valider ({partialRows.length})
                      </p>
                    </div>
                    <button type="button" onClick={() => toggleGroup(partialRows)} className="text-xs text-orange-600 hover:underline">
                      {partialRows.every(m => selected.has(m.page_id)) ? 'Tout désélectionner' : 'Tout valider'}
                    </button>
                  </div>
                  <p className="text-[11px] text-orange-600 pl-6">
                    Ces correspondances ont été trouvées par similarité de nom (containment ou overlap de mots). Vérifie que chaque ligne est correcte avant d'appliquer.
                  </p>
                  <MatchTable rows={partialRows} accentColor="bg-orange-100" />
                </div>
              )}

              {/* ── Section 3 : Déjà corrects (collapsé) ── */}
              {identicalRows.length > 0 && (
                <details>
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                    {identicalRows.length} POI{identicalRows.length > 1 ? 's' : ''} déjà à jour (coordonnées identiques) ▾
                  </summary>
                  <div className="mt-2"><MatchTable rows={identicalRows} accentColor="bg-emerald-50" /></div>
                </details>
              )}

              {/* ── Section 4 : Affectation manuelle ── */}
              {(preview.unmatched_geojson.length > 0 || preview.unmatched_pages.length > 0) && (
                <div className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <DocumentTextIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-700">
                      Affectation manuelle — {preview.unmatched_geojson.length} point{preview.unmatched_geojson.length > 1 ? 's' : ''} GeoJSON sans correspondance
                    </p>
                  </div>
                  <p className="text-[11px] text-gray-400 pl-6">
                    Clique un point GeoJSON (gauche) puis une page POI (droite) pour créer une correspondance.
                  </p>

                  {/* Paires déjà créées */}
                  {manualMatches.length > 0 && (
                    <div className="space-y-1">
                      {manualMatches.map((mm, i) => (
                        <div key={i} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-xs">
                          <span className="text-gray-500 italic flex-1 truncate">{mm.geojsonName}</span>
                          <span className="text-gray-300">→</span>
                          <span className="text-emerald-700 font-medium flex-1 truncate">{mm.pageTitre}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setManualMatches(prev => prev.filter((_, j) => j !== i));
                              setPendingGeoJson(null);
                            }}
                            className="text-gray-300 hover:text-red-500 ml-1 flex-shrink-0"
                            title="Supprimer cette correspondance"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Colonnes GeoJSON | Pages */}
                  {(() => {
                    const usedGeoJsonNames = new Set(manualMatches.map(m => m.geojsonName));
                    const usedPageIds      = new Set(manualMatches.map(m => m.pageId));
                    const availableGeoJson = preview.unmatched_geojson.filter(u => !usedGeoJsonNames.has(u.name));
                    const availablePages   = preview.unmatched_pages.filter(p => !usedPageIds.has(p.page_id));
                    if (availableGeoJson.length === 0 && availablePages.length === 0) return null;
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        {/* Colonne GeoJSON */}
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                            Points GeoJSON ({availableGeoJson.length})
                          </p>
                          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                            {availableGeoJson.map((u, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPendingGeoJson(prev => prev === u.name ? null : u.name)}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                                  pendingGeoJson === u.name
                                    ? 'bg-blue-100 border-blue-400 text-blue-800 font-medium'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                <span className="block truncate">{u.name}</span>
                                {u.translated_name && u.translated_name !== u.name && (
                                  <span className="block text-[10px] text-gray-400 truncate">→ {u.translated_name}</span>
                                )}
                                <span className="block text-[10px] font-mono text-gray-300">
                                  {u.coords.lat.toFixed(4)}, {u.coords.lon.toFixed(4)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Colonne Pages */}
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                            Pages POI sans GPS ({availablePages.length})
                          </p>
                          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                            {availablePages.map((p, i) => (
                              <button
                                key={i}
                                type="button"
                                disabled={!pendingGeoJson}
                                onClick={() => {
                                  if (!pendingGeoJson) return;
                                  const geoJsonItem = preview.unmatched_geojson.find(u => u.name === pendingGeoJson);
                                  if (!geoJsonItem) return;
                                  setManualMatches(prev => [...prev, {
                                    geojsonName: pendingGeoJson,
                                    coords:      geoJsonItem.coords,
                                    pageId:      p.page_id,
                                    pageTitre:   p.titre,
                                  }]);
                                  setPendingGeoJson(null);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                                  pendingGeoJson
                                    ? 'bg-white border-blue-300 text-gray-700 hover:bg-blue-50 cursor-pointer'
                                    : 'bg-white border-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                <span className="block truncate">{p.titre}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {pendingGeoJson && (
                    <p className="text-xs text-blue-600 font-medium flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                      </svg>
                      « {pendingGeoJson} » sélectionné — clique une page à droite pour créer la paire
                    </p>
                  )}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button" onClick={handleApply}
                  disabled={applying || (selected.size === 0 && manualMatches.length === 0)}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying
                    ? <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Application…</>
                    : <><CheckCircleIcon className="w-4 h-4" /> Appliquer {selected.size + manualMatches.length} mise{(selected.size + manualMatches.length) > 1 ? 's' : ''} à jour</>}
                </button>
                <button type="button" onClick={() => { reset(); setManualMatches([]); setPendingGeoJson(null); }}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                  Recommencer
                </button>
              </div>
            </>
          )}

          {applyResult && (
            <button type="button" onClick={reset}
              className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted">
              Importer d'autres fichiers
            </button>
          )}
        </div>
      )}
    </div>
  );
}
