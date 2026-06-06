'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MapIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import PoiGeocodeModal from './PoiGeocodeModal';
import {
  ensurePoiGeocodeReady,
  fetchPoiGeocodeFailures,
  type PendingGeoExport,
  type PoiGeocodeFailure,
} from './poi-geocode-export';

const LANGUAGES = [
  { code: 'fr',    label: 'Français',    flag: '🇫🇷' },
  { code: 'en',    label: 'Anglais',     flag: '🇬🇧' },
  { code: 'de',    label: 'Allemand',    flag: '🇩🇪' },
  { code: 'it',    label: 'Italien',     flag: '🇮🇹' },
  { code: 'es',    label: 'Espagnol',    flag: '🇪🇸' },
  { code: 'pt-pt', label: 'Portugais',   flag: '🇵🇹' },
  { code: 'nl',    label: 'Néerlandais', flag: '🇳🇱' },
  { code: 'da',    label: 'Danois',      flag: '🇩🇰' },
  { code: 'sv',    label: 'Suédois',     flag: '🇸🇪' },
];

interface CartePage {
  _id: string;
  page_id: string;
  titre: string;
  ordre: number;
  template_name: string;
  content?: { Carte_texte_1?: string };
  map_url_fr?: string;
  map_url_translations?: Record<string, string>;
}

interface CarteTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
  onCarteUpdated?: () => void;
}

export default function CarteTab({ guideId, guide, apiUrl, onCarteUpdated }: CarteTabProps) {
  const [pages, setPages] = useState<CartePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Valeurs en cours d'édition : { [pageId]: { fr: string, translations: Record<string, string> } }
  const [drafts, setDrafts] = useState<Record<string, { fr: string; translations: Record<string, string> }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, 'saved' | 'error'>>({});
  const [downloadingGeo, setDownloadingGeo] = useState<Record<string, boolean>>({});
  const [geoPreparing, setGeoPreparing] = useState<Record<string, boolean>>({});
  const [geocodeFailures, setGeocodeFailures] = useState<PoiGeocodeFailure[]>([]);
  const [geocodeModal, setGeocodeModal] = useState<{ pendingExport: PendingGeoExport } | null>(null);

  // Debounce timers
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/carte-pages`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const fetchedPages: CartePage[] = data.pages || [];
      setPages(fetchedPages);

      // Initialiser les drafts depuis les valeurs sauvegardées
      const initialDrafts: Record<string, { fr: string; translations: Record<string, string> }> = {};
      for (const p of fetchedPages) {
        initialDrafts[p._id] = {
          fr: p.map_url_fr ?? '',
          translations: p.map_url_translations ?? {},
        };
      }
      setDrafts(initialDrafts);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement des pages carte');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, guideId]);

  useEffect(() => {
    loadPages();
    fetchPoiGeocodeFailures(apiUrl, guideId).then(setGeocodeFailures).catch(() => {});
  }, [loadPages, apiUrl, guideId]);

  const slugifyDest = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

  const executeGeoJsonDownload = useCallback(async (lang: string) => {
    setDownloadingGeo((prev) => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export/geojson?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Erreur téléchargement GeoJSON');
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const cdMatch = cd.match(/filename="([^"]+)"/);
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toISOString().slice(11, 16).replace(':', '');
      const dest = slugifyDest(guide?.destination || guide?.name || 'guide');
      const fallback = lang === 'fr'
        ? `pois_${dest}_${datePart}_${timePart}.geojson`
        : `pois_${dest}_${lang}_${datePart}_${timePart}.geojson`;
      const filename = cdMatch ? cdMatch[1] : fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingGeo((prev) => ({ ...prev, [lang]: false }));
    }
  }, [apiUrl, guideId, guide?.destination, guide?.name]);

  const ensureGeocodeThenDownload = async (lang: string) => {
    setGeoPreparing((prev) => ({ ...prev, [lang]: true }));
    try {
      const missing = await ensurePoiGeocodeReady(apiUrl, guideId);
      setGeocodeFailures(missing);
      if (missing.length > 0) {
        setGeocodeModal({ pendingExport: { kind: 'geojson', lang } });
        return;
      }
      await executeGeoJsonDownload(lang);
    } catch (err: any) {
      alert(err.message || 'Erreur lors du géocodage automatique');
    } finally {
      setGeoPreparing((prev) => ({ ...prev, [lang]: false }));
    }
  };

  const saveMapUrl = useCallback(async (pageId: string, fr: string, translations: Record<string, string>) => {
    setSaving((prev) => ({ ...prev, [pageId]: true }));
    setSaveStatus((prev) => { const n = { ...prev }; delete n[pageId]; return n; });
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}/map-url`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            map_url_fr: fr || undefined,
            map_url_translations: Object.keys(translations).length > 0 ? translations : undefined,
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus((prev) => ({ ...prev, [pageId]: 'saved' }));
      onCarteUpdated?.();
    } catch {
      setSaveStatus((prev) => ({ ...prev, [pageId]: 'error' }));
    } finally {
      setSaving((prev) => ({ ...prev, [pageId]: false }));
    }
  }, [apiUrl, guideId, onCarteUpdated]);

  const scheduleSave = useCallback((pageId: string, fr: string, translations: Record<string, string>) => {
    if (debounceTimers.current[pageId]) clearTimeout(debounceTimers.current[pageId]);
    debounceTimers.current[pageId] = setTimeout(() => saveMapUrl(pageId, fr, translations), 900);
  }, [saveMapUrl]);

  const handleFrChange = (pageId: string, value: string) => {
    setDrafts((prev) => {
      const updated = { ...prev, [pageId]: { ...prev[pageId], fr: value } };
      scheduleSave(pageId, value, updated[pageId].translations);
      return updated;
    });
  };

  const handleLangChange = (pageId: string, lang: string, value: string) => {
    setDrafts((prev) => {
      const current = prev[pageId] ?? { fr: '', translations: {} };
      const newTranslations = { ...current.translations };
      if (value.trim()) {
        newTranslations[lang] = value;
      } else {
        delete newTranslations[lang];
      }
      const updated = { ...prev, [pageId]: { ...current, translations: newTranslations } };
      scheduleSave(pageId, updated[pageId].fr, newTranslations);
      return updated;
    });
  };

  const downloadGeoJson = (lang: string) => ensureGeocodeThenDownload(lang);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Chargement des pages carte...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* En-tête */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-blue-500" />
          Cartes
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Associez un lien de carte Mapbox à chaque page de type carte. Le lien FR est utilisé par défaut ;
          vous pouvez définir un lien différent par langue si les étiquettes de la carte sont traduites.
        </p>
      </div>

      {/* GeoJSON par langue */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Télécharger les GeoJSON</h3>
        <p className="text-xs text-gray-500 mb-3">
          Géocodage automatique des POIs avant téléchargement. Si des coordonnées manquent,
          une modale vous permet de les saisir ou de marquer « Pas de GPS ».
        </p>
        {geocodeFailures.length > 0 && (
          <div className="mb-3 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
            <div className="flex items-center gap-1.5 font-medium">
              <MapPinIcon className="w-4 h-4 flex-shrink-0" />
              {geocodeFailures.length} POI{geocodeFailures.length > 1 ? 's' : ''} sans coordonnées GPS
            </div>
            <p className="mt-1 text-red-700/90">
              Le téléchargement GeoJSON ouvrira la modale de correction si nécessaire.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const busy = !!geoPreparing[lang.code] || !!downloadingGeo[lang.code];
            return (
            <button
              key={lang.code}
              onClick={() => downloadGeoJson(lang.code)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {busy ? (
                <span className="animate-spin inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full" />
              ) : (
                <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              )}
              {lang.flag} {lang.label}
            </button>
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
            if (pending.kind === 'geojson') {
              await executeGeoJsonDownload(pending.lang);
            }
          }}
        />
      )}

      {/* Pages carte */}
      {pages.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          Aucune page de template <strong>CARTE</strong> trouvée dans le chemin de fer.
          Vérifiez que le chemin de fer a bien été généré et que les pages carte sont présentes.
        </div>
      ) : (
        <div className="space-y-4">
          {pages.map((page) => {
            const draft = drafts[page._id] ?? { fr: '', translations: {} };
            const mapName = page.content?.Carte_texte_1 || page.titre || `Page ${page.ordre}`;
            const isSaving = !!saving[page._id];
            const status = saveStatus[page._id];
            const hasFr = !!draft.fr.trim();

            return (
              <div
                key={page._id}
                className={`border rounded-xl p-5 bg-white transition-colors ${
                  hasFr ? 'border-green-200' : 'border-orange-200'
                }`}
              >
                {/* Titre de la carte */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {hasFr ? (
                        <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <ExclamationTriangleIcon className="h-4 w-4 text-orange-400 flex-shrink-0" />
                      )}
                      <span className="text-sm font-semibold text-gray-900">{mapName}</span>
                    </div>
                    <span className="text-xs text-gray-400 ml-6">Page {page.ordre}</span>
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-1">
                    {isSaving && (
                      <span className="animate-spin inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full" />
                    )}
                    {!isSaving && status === 'saved' && (
                      <span className="text-green-600">Sauvegardé</span>
                    )}
                    {!isSaving && status === 'error' && (
                      <span className="text-red-500">Erreur sauvegarde</span>
                    )}
                  </div>
                </div>

                {/* Lien FR */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    🇫🇷 Lien carte FR <span className="text-orange-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={draft.fr}
                    onChange={(e) => handleFrChange(page._id, e.target.value)}
                    placeholder="https://api.mapbox.com/styles/v1/..."
                    className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-colors ${
                      draft.fr && !draft.fr.startsWith('http')
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    }`}
                  />
                </div>

                {/* Liens par langue (optionnels) */}
                <details className="group">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                    Liens par langue (optionnel — si les étiquettes de la carte sont traduites)
                  </summary>
                  <div className="mt-3 space-y-2 pl-2 border-l-2 border-gray-100">
                    {LANGUAGES.filter((l) => l.code !== 'fr').map((lang) => (
                      <div key={lang.code} className="flex items-center gap-2">
                        <span className="text-sm w-6 flex-shrink-0">{lang.flag}</span>
                        <span className="text-xs text-gray-500 w-20 flex-shrink-0">{lang.label}</span>
                        <input
                          type="url"
                          value={draft.translations[lang.code] ?? ''}
                          onChange={(e) => handleLangChange(page._id, lang.code, e.target.value)}
                          placeholder={draft.fr || 'Même lien qu\'en FR'}
                          className="flex-1 text-xs border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
