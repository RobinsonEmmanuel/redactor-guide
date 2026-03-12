'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
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
      const destination = data.meta?.destination?.toLowerCase().replace(/\s+/g, '_') || 'guide';
      const year = data.meta?.year || new Date().getFullYear();
      const filename = `guide_${destination}_${year}_${lang}.json`;
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
      const dest = preview?.meta?.destination?.toLowerCase().replace(/\s+/g, '_') || 'guide';
      const year = preview?.meta?.year || new Date().getFullYear();
      const filename = `guide_${dest}_${year}_${lang}.zip`;
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
          {selectedLanguages.length > 0 && (
            <div className="flex gap-2">
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
            </div>
          )}
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
                </div>
              ))}
            </div>
          </div>
        )}

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
