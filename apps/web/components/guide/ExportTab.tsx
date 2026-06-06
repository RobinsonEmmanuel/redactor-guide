'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MapPinIcon,
  PhotoIcon,
  LanguageIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import PoiGeocodeModal from './PoiGeocodeModal';
import {
  fetchPoiGeocodeFailures,
  ensurePoiGeocodeReady,
  type PendingGeoExport,
  type PoiGeocodeFailure,
} from './poi-geocode-export';

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

type TranslationStatus = 'idle' | 'processing' | 'completed' | 'failed';

interface OverflowWarning {
  page_id:        string;
  page_titre:     string;
  field_key:      string;
  lang:           string;
  current_length: number;
  max_chars:      number;
  current_value?: string | null;
}

function ExportIconButton({
  icon,
  label,
  title,
  onClick,
  loading = false,
  accent = 'gray',
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  loading?: boolean;
  accent?: 'gray' | 'blue' | 'indigo' | 'emerald' | 'violet';
}) {
  const accentClasses: Record<string, string> = {
    gray:   'text-gray-600 hover:bg-gray-100 border-gray-200',
    blue:   'text-blue-700 hover:bg-blue-50 border-blue-200',
    indigo: 'text-indigo-700 hover:bg-indigo-50 border-indigo-200',
    emerald:'text-emerald-700 hover:bg-emerald-50 border-emerald-200',
    violet: 'text-violet-700 hover:bg-violet-50 border-violet-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`flex flex-col items-center gap-1 min-w-[4.5rem] px-2 py-2 rounded-lg border transition-colors disabled:opacity-50 ${accentClasses[accent]}`}
    >
      {loading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : icon}
      <span className="text-[10px] font-medium leading-tight text-center">{label}</span>
    </button>
  );
}

interface TranslationState {
  status: TranslationStatus;
  progress: { done: number; total: number } | null;
  translated_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  error: string | null;
}

const TRANSLATION_STALE_MS = 10 * 60 * 1000;

function isTranslationJobStale(state: TranslationState | undefined): boolean {
  if (!state || state.status !== 'processing') return false;
  const ref = state.updated_at ?? state.created_at;
  if (!ref) return true;
  const ts = new Date(ref).getTime();
  return Number.isFinite(ts) && Date.now() - ts > TRANSLATION_STALE_MS;
}

export default function ExportTab({ guideId, guide, apiUrl }: ExportTabProps) {
  const [preview, setPreview] = useState<any>(null);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [overflowsByLang, setOverflowsByLang] = useState<Record<string, OverflowWarning[]>>({});
  const [downloadingPackage, setDownloadingPackage] = useState<Record<string, boolean>>({});
  const [downloadingZip, setDownloadingZip] = useState<Record<string, boolean>>({});
  const [downloadingRedirections, setDownloadingRedirections] = useState<Record<string, boolean>>({});
  const [downloadingGeoJson, setDownloadingGeoJson] = useState<Record<string, boolean>>({});
  const [geocodeFailures, setGeocodeFailures] = useState<PoiGeocodeFailure[]>([]);
  const [geocodeModal, setGeocodeModal] = useState<{
    pendingExport: PendingGeoExport | null;
  } | null>(null);
  const [exportPreparing, setExportPreparing] = useState<Record<string, boolean>>({});
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);
  const [translationStates, setTranslationStates] = useState<Record<string, TranslationState>>({});
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  const [overflowModal, setOverflowModal] = useState<{ lang: string; warnings: OverflowWarning[] } | null>(null);
  const pollingRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const stopPolling = useCallback((lang: string) => {
    if (pollingRefs.current[lang]) {
      clearInterval(pollingRefs.current[lang]);
      delete pollingRefs.current[lang];
    }
  }, []);

  const loadPreview = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/export/preview`, {
        credentials: 'include',
      });
      if (res.ok) setPreview(await res.json());
    } catch (err) {
      console.error('Erreur chargement preview:', err);
    }
  };

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

  const loadAllOverflows = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translation-overflows`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      const byLang: Record<string, OverflowWarning[]> = {};
      for (const w of (data.warnings ?? []) as OverflowWarning[]) {
        (byLang[w.lang] = byLang[w.lang] ?? []).push(w);
      }
      setOverflowsByLang(byLang);
    } catch (err) {
      console.error('Erreur chargement overflows:', err);
    }
  }, [apiUrl, guideId]);

  const refreshOverflowsForLang = useCallback(async (lang: string) => {
    const overflows = await fetchOverflowsForLang(lang);
    setOverflowsByLang(prev => ({ ...prev, [lang]: overflows }));
  }, [fetchOverflowsForLang]);

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

  const pollTranslationOnce = useCallback(async (lang: string) => {
    const data = await loadTranslationStatus(lang);
    if (data?.status === 'completed' || data?.status === 'failed') {
      stopPolling(lang);
      setTranslating(prev => ({ ...prev, [lang]: false }));
      if (data?.status === 'completed') {
        await refreshOverflowsForLang(lang);
      }
    } else if (data?.status === 'processing') {
      setTranslating(prev => ({ ...prev, [lang]: true }));
    }
    return data;
  }, [loadTranslationStatus, stopPolling, refreshOverflowsForLang]);

  const startPolling = useCallback((lang: string) => {
    stopPolling(lang);
    setTranslating(prev => ({ ...prev, [lang]: true }));
    pollTranslationOnce(lang);
    pollingRefs.current[lang] = setInterval(() => {
      pollTranslationOnce(lang);
    }, 3000);
  }, [stopPolling, pollTranslationOnce]);

  const loadGeocodeFailures = useCallback(async () => {
    try {
      setGeocodeFailures(await fetchPoiGeocodeFailures(apiUrl, guideId));
    } catch (err) {
      console.error('Erreur chargement statut GPS:', err);
    }
  }, [apiUrl, guideId]);

  useEffect(() => {
    loadPreview();
    loadAllOverflows();
    loadGeocodeFailures();

    const resumeProcessingJobs = async () => {
      for (const l of LANGUAGES.filter(x => !x.native)) {
        const data = await loadTranslationStatus(l.code);
        if (data?.status === 'processing') {
          startPolling(l.code);
        }
      }
    };
    resumeProcessingJobs();

    return () => {
      Object.values(pollingRefs.current).forEach(clearInterval);
    };
  }, [loadAllOverflows, loadTranslationStatus, startPolling, loadGeocodeFailures]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      LANGUAGES.filter(l => !l.native).forEach(async (l) => {
        const data = await loadTranslationStatus(l.code);
        if (data?.status === 'processing' && !pollingRefs.current[l.code]) {
          startPolling(l.code);
        } else if (data?.status === 'completed' || data?.status === 'failed') {
          setTranslating(prev => ({ ...prev, [l.code]: false }));
        }
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadTranslationStatus, startPolling]);

  const translateLanguage = async (lang: string, options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    setTranslating(prev => ({ ...prev, [lang]: true }));
    setOverflowsByLang(prev => ({ ...prev, [lang]: [] }));
    setTranslationStates(prev => ({
      ...prev,
      [lang]: { status: 'processing', progress: { done: 0, total: 0 }, translated_at: null, error: null },
    }));
    try {
      const forceParam = force ? '&force=true' : '';
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translate?lang=${lang}${forceParam}`,
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

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadedFiles(prev => [...prev.filter(f => f !== filename), filename]);
  };

  const parseFilename = (res: Response, fallback: string) => {
    const cd = res.headers.get('content-disposition') || '';
    const cdMatch = cd.match(/filename="([^"]+)"/);
    return cdMatch ? cdMatch[1] : fallback;
  };

  const downloadExport = async (lang: string) => {
    setDownloading(prev => ({ ...prev, [lang]: true }));
    try {
      // 1) Créer un job asynchrone côté API (anti-timeout)
      const createRes = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/json-jobs`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang, normalize: true, drop_null_pictos: true }),
        }
      );
      if (!createRes.ok) throw new Error('Erreur lancement job export');
      const createData = await createRes.json();
      const jobId = createData.jobId as string;
      if (!jobId) throw new Error('Job export introuvable');

      // 2) Polling du statut jusqu'à complétion
      const maxAttempts = 360; // ~12 min à 2s
      let completed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(
          `${apiUrl}/api/v1/guides/${guideId}/export/json-jobs/${jobId}`,
          { credentials: 'include' }
        );
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (statusData.status === 'completed') {
          completed = true;
          break;
        }
        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Job export échoué');
        }
      }
      if (!completed) throw new Error('Timeout export JSON');

      // 3) Télécharger le JSON final
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/json-jobs/${jobId}/download`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Erreur téléchargement JSON');
      const blob = await res.blob();
      downloadBlob(blob, parseFilename(res, `guide_${lang}.json`));
    } catch (err) {
      alert(`Erreur lors de l'export en ${lang}`);
    } finally {
      setDownloading(prev => ({ ...prev, [lang]: false }));
    }
  };

  const prepKey = (kind: PendingGeoExport['kind'], lang: string) => `${kind}:${lang}`;

  const executePendingExport = async (pending: PendingGeoExport) => {
    if (pending.kind === 'zip') {
      setDownloadingZip(prev => ({ ...prev, [pending.lang]: true }));
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/guides/${guideId}/export/zip?lang=${pending.lang}`,
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const blob = await res.blob();
        const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timePart = now.toISOString().slice(11, 16).replace(':', '');
        const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
        downloadBlob(blob, parseFilename(res, `guide_${dest}_${pending.lang}_${datePart}_${timePart}.zip`));
      } catch {
        alert(`Erreur lors du téléchargement du ZIP en ${pending.lang}`);
      } finally {
        setDownloadingZip(prev => ({ ...prev, [pending.lang]: false }));
      }
      return;
    }

    if (pending.kind === 'package') {
      setDownloadingPackage(prev => ({ ...prev, [pending.lang]: true }));
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/guides/${guideId}/export/package?lang=${pending.lang}`,
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const blob = await res.blob();
        const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timePart = now.toISOString().slice(11, 16).replace(':', '');
        const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
        downloadBlob(blob, parseFilename(res, `guide_${dest}_${pending.lang}_${datePart}_${timePart}_json_redirections.zip`));
      } catch {
        alert(`Erreur lors du téléchargement JSON+redirections en ${pending.lang}`);
      } finally {
        setDownloadingPackage(prev => ({ ...prev, [pending.lang]: false }));
      }
      return;
    }

    setDownloadingGeoJson(prev => ({ ...prev, [pending.lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/geojson?lang=${pending.lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
      const fallback = pending.lang === 'fr'
        ? `pois_${dest}_${datePart}_${timePart}.geojson`
        : `pois_${dest}_${pending.lang}_${datePart}_${timePart}.geojson`;
      downloadBlob(blob, parseFilename(res, fallback));
    } catch {
      alert(`Erreur lors du téléchargement du GeoJSON (${pending.lang})`);
    } finally {
      setDownloadingGeoJson(prev => ({ ...prev, [pending.lang]: false }));
    }
  };

  const ensureGeocodeThenExport = async (pending: PendingGeoExport) => {
    const key = prepKey(pending.kind, pending.lang);
    setExportPreparing(prev => ({ ...prev, [key]: true }));
    try {
      const missing = await ensurePoiGeocodeReady(apiUrl, guideId);
      setGeocodeFailures(missing);

      if (missing.length > 0) {
        setGeocodeModal({ pendingExport: pending });
        return;
      }

      await executePendingExport(pending);
    } catch (err: any) {
      alert(err.message || 'Erreur lors du géocodage automatique');
    } finally {
      setExportPreparing(prev => ({ ...prev, [key]: false }));
    }
  };

  const downloadZip = (lang: string) => ensureGeocodeThenExport({ kind: 'zip', lang });

  const downloadPackage = async (lang: string) => {
    setDownloadingPackage(prev => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/package?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
      downloadBlob(blob, parseFilename(res, `guide_${dest}_${lang}_${datePart}_${timePart}_json_redirections.zip`));
    } catch {
      alert(`Erreur lors du téléchargement JSON+redirections en ${lang}`);
    } finally {
      setDownloadingPackage(prev => ({ ...prev, [lang]: false }));
    }
  };

  const downloadRedirections = async (lang: string) => {
    setDownloadingRedirections(prev => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/redirections.csv?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const dest = slugify(preview?.meta?.destination || preview?.meta?.guide_name || 'guide');
      const year = preview?.meta?.year || new Date().getFullYear();
      downloadBlob(blob, parseFilename(res, `redirections_${dest}_${year}_${lang}.csv`));
    } catch {
      alert(`Erreur lors du téléchargement des redirections (${lang})`);
    } finally {
      setDownloadingRedirections(prev => ({ ...prev, [lang]: false }));
    }
  };

  const downloadGeoJson = (lang: string) => ensureGeocodeThenExport({ kind: 'geojson', lang });

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
      if (isTranslationJobStale(state)) {
        return (
          <span className="text-xs text-red-500 flex items-center gap-1">
            <ExclamationTriangleIcon className="w-3 h-3" />
            {total > 0 ? `Bloqué à ${done}/${total}` : 'Bloqué'}
          </span>
        );
      }
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
        <div>
          <h2 className="text-xl font-bold text-gray-900">Export InDesign</h2>
          <p className="text-sm text-gray-500 mt-1">
            Téléchargez le package complet ou chaque livrable séparément, par langue.
          </p>
        </div>

        {/* Français — langue source */}
        {(() => {
          const fr = LANGUAGES.find(l => l.native)!;
          const zipBusy = !!exportPreparing[`zip:${fr.code}`] || !!downloadingZip[fr.code];
          const geoBusy = !!exportPreparing[`geojson:${fr.code}`] || !!downloadingGeoJson[fr.code];
          return (
            <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{fr.flag}</span>
                    <h3 className="text-sm font-semibold text-gray-900">{fr.label}</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                      Langue source
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Package complet : JSON, images, redirections et GeoJSON (labels français).
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ExportIconButton
                  accent="blue"
                  icon={<ArchiveBoxIcon className="w-5 h-5" />}
                  label="Package complet"
                  title="ZIP : JSON + images + redirections + GeoJSON (géocodage auto puis 30–60 s)"
                  loading={zipBusy}
                  onClick={() => downloadZip(fr.code)}
                />
                <ExportIconButton
                  icon={<DocumentTextIcon className="w-5 h-5" />}
                  label="JSON texte"
                  title="JSON normalisé layout-ready (sans images)"
                  loading={downloading[fr.code]}
                  onClick={() => downloadExport(fr.code)}
                />
                <ExportIconButton
                  accent="indigo"
                  icon={<ArrowsRightLeftIcon className="w-5 h-5" />}
                  label="Redirections"
                  title="CSV des redirections WP Engine"
                  loading={downloadingRedirections[fr.code]}
                  onClick={() => downloadRedirections(fr.code)}
                />
                <ExportIconButton
                  accent="emerald"
                  icon={<MapPinIcon className="w-5 h-5" />}
                  label="GeoJSON"
                  title="POIs avec coordonnées GPS (géocodage auto via Photon)"
                  loading={geoBusy}
                  onClick={() => downloadGeoJson(fr.code)}
                />
              </div>

              <PoiGeocodeAlerts
                failures={geocodeFailures}
                onCorrect={() => setGeocodeModal({ pendingExport: null })}
              />
            </div>
          );
        })()}

        {/* Autres langues */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Traductions</h3>
          <p className="text-xs text-gray-500 mb-4">
            Par langue : JSON traduit, redirections et GeoJSON (labels POI traduits, ex. « Escalier Agatha Christie »).
            Évitez de lancer une traduction en même temps que le package complet FR (ZIP + images) — les deux opérations partagent le même serveur.
          </p>
          <div className="space-y-3">
            {LANGUAGES.filter(l => !l.native).map(lang => {
              const tState = translationStates[lang.code];
              const isProcessing = tState?.status === 'processing';
              const isStale = isTranslationJobStale(tState);
              const isTranslating = isProcessing && !isStale;
              const isTranslated = tState?.status === 'completed';
              const langOverflows = overflowsByLang[lang.code] ?? [];
              const geoBusy = !!exportPreparing[`geojson:${lang.code}`] || !!downloadingGeoJson[lang.code];

              return (
                <div
                  key={lang.code}
                  className="p-4 rounded-lg border border-gray-100 bg-gray-50/50"
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">{lang.flag}</span>
                      <div>
                        <div className="text-sm font-medium text-gray-800">{lang.label}</div>
                        <div className="mt-0.5">{renderTranslationBadge(lang.code)}</div>
                      </div>
                    </div>
                    {isTranslating ? (
                      <button
                        disabled
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg cursor-not-allowed flex-shrink-0"
                      >
                        <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                        Traduction…
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => translateLanguage(lang.code, {
                            force: isStale || tState?.status === 'failed',
                          })}
                          title={
                            isStale || tState?.status === 'failed'
                              ? 'Relancer la traduction (job précédent interrompu)'
                              : isTranslated
                                ? 'Retraduire le contenu'
                                : 'Lancer la traduction IA'
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            isStale || tState?.status === 'failed'
                              ? 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100'
                              : isTranslated
                                ? 'text-gray-500 bg-white border-gray-200 hover:bg-gray-50'
                                : 'text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100'
                          }`}
                        >
                          <LanguageIcon className="w-3.5 h-3.5" />
                          {isStale || tState?.status === 'failed' ? 'Relancer' : isTranslated ? 'Retraduire' : 'Traduire'}
                        </button>
                        {/* TODO: retirer après validation des règles toponymiques */}
                        <button
                          type="button"
                          onClick={() => translateLanguage(lang.code, { force: true })}
                          title="Relance forcée (force=true) — annule un job en cours et retraduit tout"
                          className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 transition-colors"
                        >
                          <ArrowPathIcon className="w-3 h-3" />
                          Forcer
                        </button>
                      </div>
                    )}
                  </div>

                  {isStale && (
                    <p className="text-[11px] text-red-600 mb-2">
                      Traduction bloquée depuis plus de 10 minutes (souvent après un export lourd simultané). Cliquez sur « Relancer ».
                    </p>
                  )}

                  {tState?.status === 'failed' && tState.error && !isStale && (
                    <p className="text-[11px] text-red-600 mb-2">
                      {tState.error}
                    </p>
                  )}

                  {!isTranslated && !isTranslating && !isStale && (
                    <p className="text-[11px] text-amber-600 mb-2">
                      Traduction non effectuée — les exports contiendront encore le texte français.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <ExportIconButton
                      accent="violet"
                      icon={<ArchiveBoxIcon className="w-5 h-5" />}
                      label="Package"
                      title="ZIP : JSON traduit + redirections + GeoJSON (sans images)"
                      loading={downloadingPackage[lang.code]}
                      onClick={() => downloadPackage(lang.code)}
                    />
                    <ExportIconButton
                      icon={<DocumentTextIcon className="w-5 h-5" />}
                      label="JSON texte"
                      title={`JSON traduit (${lang.label})`}
                      loading={downloading[lang.code]}
                      onClick={() => downloadExport(lang.code)}
                    />
                    <ExportIconButton
                      accent="indigo"
                      icon={<ArrowsRightLeftIcon className="w-5 h-5" />}
                      label="Redirections"
                      title={`CSV redirections (${lang.label})`}
                      loading={downloadingRedirections[lang.code]}
                      onClick={() => downloadRedirections(lang.code)}
                    />
                    <ExportIconButton
                      accent="emerald"
                      icon={<MapPinIcon className="w-5 h-5" />}
                      label="GeoJSON"
                      title={`POIs avec labels traduits (${lang.label})`}
                      loading={geoBusy}
                      onClick={() => downloadGeoJson(lang.code)}
                    />
                  </div>

                  <LanguageOverflowAlerts
                    warnings={langOverflows}
                    onCorrect={() => setOverflowModal({ lang: lang.code, warnings: langOverflows })}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {geocodeModal && (
          <PoiGeocodeModal
            guideId={guideId}
            apiUrl={apiUrl}
            initialFailures={geocodeFailures}
            pendingExport={geocodeModal.pendingExport}
            onClose={() => setGeocodeModal(null)}
            onFailuresChange={setGeocodeFailures}
            onDownload={async (pending) => {
              setGeocodeModal(null);
              await executePendingExport(pending);
            }}
          />
        )}

        {overflowModal && (
          <OverflowCorrectionModal
            guideId={guideId}
            apiUrl={apiUrl}
            lang={overflowModal.lang}
            initialWarnings={overflowModal.warnings}
            onClose={() => {
              const closedLang = overflowModal.lang;
              setOverflowModal(null);
              refreshOverflowsForLang(closedLang);
            }}
          />
        )}

        {/* Aide */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
          <p>
            <strong className="text-slate-800">Package complet (FR)</strong> — JSON, dossier images, CSV redirections et GeoJSON dans une seule archive.
            Comptez 30–60 s (téléchargement des images WordPress).
          </p>
          <p>
            <strong className="text-slate-800">Package (traductions)</strong> — JSON traduit, redirections et GeoJSON avec libellés POI dans la langue cible (sans images).
          </p>
          <p className="flex items-center gap-1.5 text-slate-500">
            <PhotoIcon className="w-3.5 h-3.5 flex-shrink-0" />
            Les images ne sont incluses que dans le package français (visuels identiques toutes langues).
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

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alertes GPS manquants (géocodage Photon en échec)
// ---------------------------------------------------------------------------
function PoiGeocodeAlerts({
  failures,
  onCorrect,
}: {
  failures: PoiGeocodeFailure[];
  onCorrect: () => void;
}) {
  if (failures.length === 0) return null;

  const preview = failures.slice(0, 3);
  const remaining = failures.length - preview.length;

  return (
    <div className="mt-3 pt-3 border-t border-red-200">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-700">
          <MapPinIcon className="w-4 h-4 flex-shrink-0" />
          {failures.length} POI{failures.length > 1 ? 's' : ''} sans coordonnées GPS
        </div>
        <button
          type="button"
          onClick={onCorrect}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-800 bg-red-50 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
        >
          <PencilSquareIcon className="w-3.5 h-3.5" />
          Compléter
        </button>
      </div>
      <ul className="space-y-1">
        {preview.map((f) => (
          <li key={f.page_id} className="text-[11px] text-red-800/90 leading-snug">
            <span className="font-medium">{f.titre}</span>
            {f.error && (
              <span className="text-red-600"> — {f.error}</span>
            )}
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-[11px] text-red-600 italic">… et {remaining} autre{remaining > 1 ? 's' : ''}</li>
        )}
      </ul>
      <p className="mt-2 text-[10px] text-red-700/80">
        Dans la modale : bouton « Pas de GPS » si le lieu n&apos;a pas de coordonnées ponctuelles.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alertes de calibre sous chaque langue (après traduction)
// ---------------------------------------------------------------------------
function LanguageOverflowAlerts({
  warnings,
  onCorrect,
}: {
  warnings: OverflowWarning[];
  onCorrect: () => void;
}) {
  if (warnings.length === 0) return null;

  const preview = warnings.slice(0, 3);
  const remaining = warnings.length - preview.length;

  return (
    <div className="mt-3 pt-3 border-t border-amber-200">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          {warnings.length} dépassement{warnings.length > 1 ? 's' : ''} de calibre
        </div>
        <button
          type="button"
          onClick={onCorrect}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
        >
          <PencilSquareIcon className="w-3.5 h-3.5" />
          Corriger
        </button>
      </div>
      <ul className="space-y-1">
        {preview.map((w, i) => (
          <li key={i} className="text-[11px] text-amber-800/90 leading-snug">
            <span className="font-medium">{w.page_titre}</span>
            {' — '}
            <code className="bg-amber-100/80 px-1 rounded">{w.field_key}</code>
            {' '}
            <span className="text-amber-600">
              {w.current_length}/{w.max_chars} car. (+{w.current_length - w.max_chars})
            </span>
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-[11px] text-amber-600 italic">… et {remaining} autre{remaining > 1 ? 's' : ''}</li>
        )}
      </ul>
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
