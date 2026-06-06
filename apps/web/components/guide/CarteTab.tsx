'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  MapIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import PoiGeocodeModal from './PoiGeocodeModal';
import ImageSelectorModal from './ImageSelectorModal';
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

const MAP_NAME_KEYS = [
  'Carte_texte_1',
  'CARTE_texte_1',
  'CARTE_DESTINATION_titre_principal',
  'Carte_titre_1',
];

interface CartePage {
  _id: string;
  page_id: string;
  titre: string;
  ordre: number;
  template_name: string;
  content?: Record<string, unknown>;
  map_url_fr?: string;
  map_url_translations?: Record<string, string>;
}

interface CarteTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
  googleDriveFolderId?: string;
  onCarteUpdated?: () => void;
}

type ImageSelectorTarget = { pageId: string; lang: string };

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function getMapName(page: CartePage): string {
  const content = page.content || {};
  for (const key of MAP_NAME_KEYS) {
    const raw = content[key];
    if (raw == null) continue;
    const text = stripHtml(String(raw));
    if (text) return text;
  }
  return page.titre || `Page ${page.ordre}`;
}

export default function CarteTab({
  guideId,
  guide,
  apiUrl,
  googleDriveFolderId,
  onCarteUpdated,
}: CarteTabProps) {
  const [pages, setPages] = useState<CartePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, { fr: string; translations: Record<string, string> }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, 'saved' | 'error'>>({});
  const [downloadingGeo, setDownloadingGeo] = useState<Record<string, boolean>>({});
  const [geoPreparing, setGeoPreparing] = useState<Record<string, boolean>>({});
  const [geocodeFailures, setGeocodeFailures] = useState<PoiGeocodeFailure[]>([]);
  const [geocodeModal, setGeocodeModal] = useState<{ pendingExport: PendingGeoExport } | null>(null);
  const [imageSelector, setImageSelector] = useState<ImageSelectorTarget | null>(null);

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

  const saveMapImages = useCallback(async (
    pageId: string,
    fr: string,
    translations: Record<string, string>
  ) => {
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

  const applyImageSelection = (pageId: string, lang: string, imageUrl: string) => {
    setDrafts((prev) => {
      const current = prev[pageId] ?? { fr: '', translations: {} };
      let fr = current.fr;
      let translations = { ...current.translations };

      if (lang === 'fr') {
        fr = imageUrl;
      } else {
        translations[lang] = imageUrl;
      }

      const updated = { ...prev, [pageId]: { fr, translations } };
      saveMapImages(pageId, fr, translations);
      return updated;
    });
  };

  const clearImage = (pageId: string, lang: string) => {
    setDrafts((prev) => {
      const current = prev[pageId] ?? { fr: '', translations: {} };
      let fr = current.fr;
      const translations = { ...current.translations };

      if (lang === 'fr') {
        fr = '';
      } else {
        delete translations[lang];
      }

      const updated = { ...prev, [pageId]: { fr, translations } };
      saveMapImages(pageId, fr, translations);
      return updated;
    });
  };

  const getImageUrl = (pageId: string, lang: string): string => {
    const draft = drafts[pageId] ?? { fr: '', translations: {} };
    if (lang === 'fr') return draft.fr;
    return draft.translations[lang] ?? '';
  };

  const renderImagePicker = (page: CartePage, lang: string, label: ReactNode, required = false) => {
    const imageUrl = getImageUrl(page._id, lang);
    const fallbackLabel = lang === 'fr' ? undefined : (getImageUrl(page._id, 'fr') ? 'Même image qu\'en FR' : undefined);

    return (
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          {label}
          {required && <span className="text-orange-500"> *</span>}
        </label>
        <div className="flex gap-2 items-start">
          {imageUrl ? (
            <div className="relative group shrink-0">
              <button
                type="button"
                onClick={() => setImageSelector({ pageId: page._id, lang })}
                className="block"
                title="Changer l'image"
              >
                <img
                  src={imageUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-20 w-32 object-cover rounded-lg border border-gray-200 group-hover:opacity-80 transition-opacity"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </button>
              <button
                type="button"
                onClick={() => clearImage(page._id, lang)}
                className="absolute top-1 right-1 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                title="Supprimer l'image"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="h-20 w-32 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center shrink-0">
              <PhotoIcon className="h-8 w-8 text-gray-300" />
            </div>
          )}
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setImageSelector({ pageId: page._id, lang })}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-xs w-fit transition-colors"
            >
              <PhotoIcon className="h-4 w-4" />
              Choisir une image
            </button>
            {imageUrl && (
              <p className="text-[11px] text-gray-400 break-all line-clamp-2">{imageUrl}</p>
            )}
            {!imageUrl && fallbackLabel && (
              <p className="text-[11px] text-gray-400">{fallbackLabel}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

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
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-blue-500" />
          Cartes
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Associez une image de carte à chaque page de type carte. L&apos;image FR est utilisée par défaut ;
          vous pouvez en définir une différente par langue si les étiquettes de la carte sont traduites.
        </p>
      </div>

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
                onClick={() => ensureGeocodeThenDownload(lang.code)}
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

      {imageSelector && (
        <ImageSelectorModal
          guideId={guideId}
          pageId={imageSelector.pageId}
          scope="guide"
          apiUrl={apiUrl}
          googleDriveFolderId={googleDriveFolderId}
          currentImageUrl={getImageUrl(imageSelector.pageId, imageSelector.lang)}
          onSelect={(imageUrl) => {
            applyImageSelection(imageSelector.pageId, imageSelector.lang, imageUrl);
            setImageSelector(null);
          }}
          onClose={() => setImageSelector(null)}
        />
      )}

      {pages.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          Aucune page de template <strong>CARTE</strong> trouvée dans le chemin de fer.
          Vérifiez que le chemin de fer a bien été généré et que les pages carte sont présentes.
        </div>
      ) : (
        <div className="space-y-4">
          {pages.map((page) => {
            const draft = drafts[page._id] ?? { fr: '', translations: {} };
            const mapName = getMapName(page);
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

                {renderImagePicker(
                  page,
                  'fr',
                  <>🇫🇷 Image carte FR</>,
                  true
                )}

                <details className="group">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                    Images par langue (optionnel — si les étiquettes de la carte sont traduites)
                  </summary>
                  <div className="mt-3 space-y-3 pl-2 border-l-2 border-gray-100">
                    {LANGUAGES.filter((l) => l.code !== 'fr').map((lang) =>
                      renderImagePicker(
                        page,
                        lang.code,
                        <>{lang.flag} {lang.label}</>
                      )
                    )}
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
