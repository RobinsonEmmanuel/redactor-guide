'use client';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  MapIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LanguageIcon,
  MapPinIcon,
  NoSymbolIcon,
  PhotoIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinSolidIcon } from '@heroicons/react/24/solid';
import PoiGeocodeModal from './PoiGeocodeModal';
import PoiGeocodeAlerts from './PoiGeocodeAlerts';
import ImageSelectorModal from './ImageSelectorModal';
import {
  ensurePoiGeocodeReady,
  fetchPoiGeocodeFailures,
  type PendingGeoExport,
  type PoiGeocodeFailure,
} from './poi-geocode-export';

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

type GeocodeQualityStatus = 'ok' | 'missing' | 'out_of_scope' | 'no_gps';
type GeocodeQualitySortMode = 'alphabetical' | 'cluster';

interface GeocodeQualityPoi {
  page_id: string;
  titre: string;
  ordre: number | null;
  cluster_name: string | null;
  query: string | null;
  status: GeocodeQualityStatus;
  issue: string | null;
  coordinates: { lat: number; lon: number; display_name?: string | null } | null;
  gps_not_applicable: boolean;
  place_identity?: {
    local_name?: string | null;
    display_name?: string | null;
    country_code?: string | null;
  } | null;
}

interface GeocodeQualityReport {
  destination: string;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
  stats: {
    total: number;
    ok: number;
    missing: number;
    out_of_scope: number;
    no_gps: number;
  };
  pois: GeocodeQualityPoi[];
}

interface CarteTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
  googleDriveFolderId?: string;
  onCarteUpdated?: () => void;
}

type ImageSelectorTarget = { pageId: string; lang: string };
type TranslationStatus = 'idle' | 'processing' | 'completed' | 'failed';

interface TranslationState {
  status: TranslationStatus;
  progress: { done: number; total: number } | null;
  translated_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  error: string | null;
}

const TRANSLATION_STALE_MS = 10 * 60 * 1000;
const TRANSLATION_POLL_DELAY_MS = 3000;
const TRANSLATION_MAX_ATTEMPTS = 240;

function isTranslationJobStale(state: TranslationState | undefined): boolean {
  if (!state || state.status !== 'processing') return false;
  const ref = state.updated_at ?? state.created_at;
  if (!ref) return true;
  const ts = new Date(ref).getTime();
  return Number.isFinite(ts) && Date.now() - ts > TRANSLATION_STALE_MS;
}

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

const TILE_SIZE = 256;

function lonLatToWorld(lat: number, lon: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function worldToLonLat(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

function getStatusLabel(status: GeocodeQualityStatus) {
  if (status === 'ok') return 'OK';
  if (status === 'missing') return 'Manquant';
  if (status === 'out_of_scope') return 'Hors zone';
  return 'Sans GPS';
}

function getStatusClasses(status: GeocodeQualityStatus) {
  if (status === 'ok') return 'bg-emerald-500 border-emerald-700 text-emerald-700';
  if (status === 'missing') return 'bg-amber-500 border-amber-700 text-amber-700';
  if (status === 'out_of_scope') return 'bg-red-500 border-red-700 text-red-700';
  return 'bg-slate-400 border-slate-600 text-slate-600';
}

function getStatusMarkerClass(status: GeocodeQualityStatus) {
  return getStatusClasses(status).split(' ')[0];
}

function getStatusTextClass(status: GeocodeQualityStatus) {
  return getStatusClasses(status).split(' ').find((className) => className.startsWith('text-')) ?? 'text-gray-600';
}

function compareText(a: string | null | undefined, b: string | null | undefined) {
  return String(a || '').localeCompare(String(b || ''), 'fr', {
    sensitivity: 'base',
    numeric: true,
  });
}

function getPoiClusterName(poi: GeocodeQualityPoi) {
  return poi.cluster_name?.trim() || 'Sans cluster';
}

function OSMQualityMap({
  report,
  selectedPoiId,
  selectedClusterName,
  onSelectPoi,
  onPickCoordinates,
}: {
  report: GeocodeQualityReport;
  selectedPoiId: string | null;
  selectedClusterName: string | null;
  onSelectPoi: (poi: GeocodeQualityPoi) => void;
  onPickCoordinates: (lat: number, lon: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    centerWorldX: number;
    centerWorldY: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const [mapWidth, setMapWidth] = useState(760);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [centerOverride, setCenterOverride] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const updateWidth = () => setMapWidth(Math.max(320, Math.round(node.getBoundingClientRect().width)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const width = mapWidth;
  const height = 360;
  const points = report.pois.filter((poi) => poi.coordinates);
  const bounds = report.bounds;
  const baseZoom = bounds ? 10 : points.length > 0 ? 8 : 2;
  const zoom = Math.max(2, Math.min(18, baseZoom + zoomOffset));
  const defaultCenter = bounds
    ? {
        lat: (bounds.minLat + bounds.maxLat) / 2,
        lon: (bounds.minLon + bounds.maxLon) / 2,
      }
    : points.length > 0
      ? {
          lat: points.reduce((sum, poi) => sum + (poi.coordinates?.lat ?? 0), 0) / points.length,
          lon: points.reduce((sum, poi) => sum + (poi.coordinates?.lon ?? 0), 0) / points.length,
        }
      : { lat: 28.2916, lon: -16.6291 };
  const center = centerOverride ?? defaultCenter;
  const centerWorld = lonLatToWorld(center.lat, center.lon, zoom);
  const minX = centerWorld.x - width / 2;
  const minY = centerWorld.y - height / 2;
  const tileMinX = Math.floor(minX / TILE_SIZE);
  const tileMaxX = Math.floor((centerWorld.x + width / 2) / TILE_SIZE);
  const tileMinY = Math.floor(minY / TILE_SIZE);
  const tileMaxY = Math.floor((centerWorld.y + height / 2) / TILE_SIZE);
  const maxTile = 2 ** zoom;
  const tiles: Array<{ x: number; y: number; left: number; top: number; url: string }> = [];

  for (let x = tileMinX; x <= tileMaxX; x++) {
    for (let y = tileMinY; y <= tileMaxY; y++) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      tiles.push({
        x,
        y,
        left: x * TILE_SIZE - minX,
        top: y * TILE_SIZE - minY,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
      });
    }
  }

  const project = (lat: number, lon: number) => {
    const world = lonLatToWorld(lat, lon, zoom);
    return { left: world.x - minX, top: world.y - minY };
  };

  useEffect(() => {
    setCenterOverride(null);
    setZoomOffset(0);
  }, [report.destination, report.bounds?.minLat, report.bounds?.maxLat, report.bounds?.minLon, report.bounds?.maxLon]);

  const boundsRect = bounds
    ? (() => {
        const nw = project(bounds.maxLat, bounds.minLon);
        const se = project(bounds.minLat, bounds.maxLon);
        return {
          left: nw.left,
          top: nw.top,
          width: se.left - nw.left,
          height: se.top - nw.top,
        };
      })()
    : null;

  return (
    <div
      ref={mapRef}
      className="relative h-[360px] cursor-grab overflow-hidden rounded-lg border border-gray-200 bg-slate-100 active:cursor-grabbing"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button')) return;
        dragMovedRef.current = false;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          centerWorldX: centerWorld.x,
          centerWorldY: centerWorld.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;
        const nextCenter = worldToLonLat(drag.centerWorldX - dx, drag.centerWorldY - dy, zoom);
        setCenterOverride(nextCenter);
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current = null;
        }
      }}
      onClick={(event) => {
        if (dragMovedRef.current) {
          dragMovedRef.current = false;
          return;
        }
        if (!selectedPoiId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = minX + (event.clientX - rect.left);
        const y = minY + (event.clientY - rect.top) * (height / rect.height);
        const picked = worldToLonLat(x, y, zoom);
        onPickCoordinates(picked.lat, picked.lon);
      }}
      title={selectedPoiId ? 'Cliquez sur la carte pour proposer des coordonnées' : 'Sélectionnez un POI avant de cliquer sur la carte'}
    >
      {tiles.map((tile) => (
        <img
          key={`${tile.x}:${tile.y}`}
          src={tile.url}
          alt=""
          className="absolute max-w-none select-none"
          draggable={false}
          style={{ width: TILE_SIZE, height: TILE_SIZE, left: tile.left, top: tile.top }}
        />
      ))}

      {boundsRect && (
        <div
          className="absolute border-2 border-blue-500/70 bg-blue-500/5 pointer-events-none"
          style={boundsRect}
        />
      )}

      {points.map((poi) => {
        const coords = poi.coordinates!;
        const pos = project(coords.lat, coords.lon);
        const selected = poi.page_id === selectedPoiId;
        const clusterSelected = !!selectedClusterName && getPoiClusterName(poi) === selectedClusterName;
        const markerColor = getStatusMarkerClass(poi.status);
        const markerTextColor = getStatusTextClass(poi.status);
        return (
          <button
            key={poi.page_id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelectPoi(poi);
            }}
            className={`absolute -translate-x-1/2 -translate-y-full transition-transform ${selected ? 'scale-125 z-20' : 'z-10 hover:scale-110'}`}
            style={{ left: pos.left, top: pos.top }}
            title={poi.titre}
          >
            {selected ? (
              <MapPinSolidIcon
                className={`h-8 w-8 drop-shadow-md ${clusterSelected ? '' : markerTextColor}`}
                style={clusterSelected ? { color: '#191E55' } : undefined}
              />
            ) : clusterSelected ? (
              <span
                className="block h-5 w-5 rounded-full border-2 border-white shadow"
                style={{ backgroundColor: '#191E55' }}
              />
            ) : (
              <span className={`block h-4 w-4 rounded-full border-2 border-white shadow ${markerColor}`} />
            )}
          </button>
        );
      })}

      <div className="absolute left-3 top-3 flex overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-sm">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setZoomOffset((value) => Math.min(value + 1, 8));
          }}
          className="h-8 w-8 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          disabled={zoom >= 18}
          title="Zoomer"
        >
          +
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setZoomOffset((value) => Math.max(value - 1, -8));
          }}
          className="h-8 w-8 border-l border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          disabled={zoom <= 2}
          title="Dézoomer"
        >
          -
        </button>
      </div>

      <div className="absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 text-[10px] text-gray-500 shadow-sm">
        © OpenStreetMap
      </div>
    </div>
  );
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
  const [translationStates, setTranslationStates] = useState<Record<string, TranslationState>>({});
  const [translatingGeo, setTranslatingGeo] = useState<Record<string, boolean>>({});
  const [qualityReport, setQualityReport] = useState<GeocodeQualityReport | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<GeocodeQualityStatus | 'all'>('all');
  const [qualitySortMode, setQualitySortMode] = useState<GeocodeQualitySortMode>('alphabetical');
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [selectedClusterName, setSelectedClusterName] = useState<string | null>(null);
  const [coordinateDrafts, setCoordinateDrafts] = useState<Record<string, { lat: string; lon: string }>>({});
  const [savingCoordinates, setSavingCoordinates] = useState<Record<string, boolean>>({});
  const [coordinateErrors, setCoordinateErrors] = useState<Record<string, string>>({});
  const [geocodeFailures, setGeocodeFailures] = useState<PoiGeocodeFailure[]>([]);
  const [geocodeModal, setGeocodeModal] = useState<{
    pendingExport: PendingGeoExport | null;
  } | null>(null);
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

  const loadGeocodeFailures = useCallback(async () => {
    try {
      setGeocodeFailures(await fetchPoiGeocodeFailures(apiUrl, guideId));
    } catch {
      setGeocodeFailures([]);
    }
  }, [apiUrl, guideId]);

  const loadQualityReport = useCallback(async () => {
    setQualityLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/poi-geocode-quality`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setQualityReport(data);
      const drafts: Record<string, { lat: string; lon: string }> = {};
      for (const poi of (data.pois ?? []) as GeocodeQualityPoi[]) {
        if (!poi.coordinates) continue;
        drafts[poi.page_id] = {
          lat: String(poi.coordinates.lat),
          lon: String(poi.coordinates.lon),
        };
      }
      setCoordinateDrafts((prev) => ({ ...drafts, ...prev }));
      if (data.pois?.length > 0) {
        const firstIssue = data.pois.find((poi: GeocodeQualityPoi) => poi.status === 'out_of_scope' || poi.status === 'missing');
        setSelectedPoiId((prev) => prev ?? (firstIssue ?? data.pois[0]).page_id);
      }
    } catch (err) {
      console.error('Erreur rapport qualité GPS:', err);
    } finally {
      setQualityLoading(false);
    }
  }, [apiUrl, guideId]);

  const loadTranslationStatus = useCallback(async (lang: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/translation-status?lang=${lang}`,
        { credentials: 'include' }
      );
      if (!res.ok) return null;
      const data = await res.json();
      setTranslationStates((prev) => ({ ...prev, [lang]: data }));
      return data as TranslationState;
    } catch {
      return null;
    }
  }, [apiUrl, guideId]);

  useEffect(() => {
    loadPages();
    loadGeocodeFailures();
    loadQualityReport();
    LANGUAGES.filter((lang) => !lang.native).forEach((lang) => {
      loadTranslationStatus(lang.code);
    });
  }, [loadPages, loadGeocodeFailures, loadQualityReport, loadTranslationStatus]);

  const waitForTranslation = useCallback(async (lang: string) => {
    for (let attempt = 0; attempt < TRANSLATION_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, TRANSLATION_POLL_DELAY_MS));
      const status = await loadTranslationStatus(lang);
      if (status?.status === 'completed') return status;
      if (status?.status === 'failed') {
        throw new Error(status.error || 'La traduction a échoué');
      }
      if (isTranslationJobStale(status ?? undefined)) {
        throw new Error('La traduction semble bloquée. Relancez le GeoJSON pour forcer une nouvelle traduction.');
      }
    }
    throw new Error('La traduction prend trop de temps. Réessayez dans quelques minutes.');
  }, [loadTranslationStatus]);

  const ensureTranslationReady = useCallback(async (lang: string) => {
    if (lang === 'fr') return;

    const currentStatus = await loadTranslationStatus(lang);
    const isActiveProcessing =
      currentStatus?.status === 'processing' && !isTranslationJobStale(currentStatus);

    setTranslatingGeo((prev) => ({ ...prev, [lang]: true }));
    setTranslationStates((prev) => ({
      ...prev,
      [lang]: {
        status: 'processing',
        progress: currentStatus?.progress ?? { done: 0, total: 0 },
        translated_at: null,
        error: null,
      },
    }));

    try {
      if (!isActiveProcessing) {
        const res = await fetch(
          `${apiUrl}/api/v1/guides/${guideId}/translate?lang=${lang}&force=true`,
          { method: 'POST', credentials: 'include' }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur traduction');
        }
      }
      await waitForTranslation(lang);
    } finally {
      setTranslatingGeo((prev) => ({ ...prev, [lang]: false }));
    }
  }, [apiUrl, guideId, loadTranslationStatus, waitForTranslation]);

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

  const openGeocodeModal = () => setGeocodeModal({ pendingExport: null });

  const ensureGeocodeThenDownload = async (lang: string) => {
    setGeoPreparing((prev) => ({ ...prev, [lang]: true }));
    try {
      await ensureTranslationReady(lang);

      const missing = await ensurePoiGeocodeReady(apiUrl, guideId);
      setGeocodeFailures(missing);
      await loadQualityReport();
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

  const selectedPoi = qualityReport?.pois.find((poi) => poi.page_id === selectedPoiId) ?? null;
  const filteredQualityPois = useMemo(() => {
    const pois = qualityReport?.pois.filter((poi) =>
      qualityFilter === 'all' ? true : poi.status === qualityFilter
    ) ?? [];

    return [...pois].sort((a, b) => {
      if (qualitySortMode === 'cluster') {
        const clusterCompare = compareText(getPoiClusterName(a), getPoiClusterName(b));
        if (clusterCompare !== 0) return clusterCompare;
      }
      const titleCompare = compareText(a.titre, b.titre);
      if (titleCompare !== 0) return titleCompare;
      return compareText(a.query, b.query);
    });
  }, [qualityFilter, qualityReport, qualitySortMode]);

  const setDraftCoordinates = (pageId: string, lat: string, lon: string) => {
    setCoordinateDrafts((prev) => ({
      ...prev,
      [pageId]: { lat, lon },
    }));
    setCoordinateErrors((prev) => ({ ...prev, [pageId]: '' }));
  };

  const savePoiCoordinates = async (poi: GeocodeQualityPoi) => {
    const draft = coordinateDrafts[poi.page_id] ?? { lat: '', lon: '' };
    const lat = parseFloat(draft.lat.replace(',', '.'));
    const lon = parseFloat(draft.lon.replace(',', '.'));

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setCoordinateErrors((prev) => ({
        ...prev,
        [poi.page_id]: 'Latitude ou longitude invalide',
      }));
      return;
    }

    setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${poi.page_id}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coordinates: { lat, lon },
            gps_not_applicable: false,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erreur serveur');
      }
      await loadQualityReport();
      await loadGeocodeFailures();
      onCarteUpdated?.();
    } catch (err: any) {
      setCoordinateErrors((prev) => ({ ...prev, [poi.page_id]: err.message }));
    } finally {
      setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: false }));
    }
  };

  const regeocodePoi = async (poi: GeocodeQualityPoi) => {
    setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: true }));
    setCoordinateErrors((prev) => ({ ...prev, [poi.page_id]: '' }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/poi-geocode-quality/${poi.page_id}/regeocode`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Aucun résultat Photon dans le périmètre');
      }
      const data = await res.json();
      if (data.coordinates) {
        setDraftCoordinates(
          poi.page_id,
          String(data.coordinates.lat),
          String(data.coordinates.lon)
        );
      }
      await loadQualityReport();
      await loadGeocodeFailures();
      onCarteUpdated?.();
    } catch (err: any) {
      setCoordinateErrors((prev) => ({ ...prev, [poi.page_id]: err.message }));
    } finally {
      setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: false }));
    }
  };

  const markPoiWithoutGps = async (poi: GeocodeQualityPoi) => {
    setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${poi.page_id}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gps_not_applicable: true, coordinates: null }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erreur serveur');
      }
      await loadQualityReport();
      await loadGeocodeFailures();
      onCarteUpdated?.();
    } catch (err: any) {
      setCoordinateErrors((prev) => ({ ...prev, [poi.page_id]: err.message }));
    } finally {
      setSavingCoordinates((prev) => ({ ...prev, [poi.page_id]: false }));
    }
  };

  const renderTranslationBadge = (lang: string) => {
    if (lang === 'fr') {
      return <span className="text-[10px] text-blue-600">Source</span>;
    }

    const state = translationStates[lang];
    if (!state || state.status === 'idle') {
      return (
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <LanguageIcon className="w-3 h-3" /> À traduire
        </span>
      );
    }
    if (state.status === 'processing') {
      const { done = 0, total = 0 } = state.progress || {};
      if (isTranslationJobStale(state)) {
        return (
          <span className="text-[10px] text-red-500 flex items-center gap-1">
            <ExclamationTriangleIcon className="w-3 h-3" /> Bloqué
          </span>
        );
      }
      return (
        <span className="text-[10px] text-blue-600 flex items-center gap-1">
          <ArrowPathIcon className="w-3 h-3 animate-spin" />
          {total > 0 ? `${done}/${total}` : 'Traduction'}
        </span>
      );
    }
    if (state.status === 'completed') {
      return (
        <span className="text-[10px] text-green-600 flex items-center gap-1">
          <CheckCircleIcon className="w-3 h-3" /> Traduit
        </span>
      );
    }
    return (
      <span className="text-[10px] text-red-500 flex items-center gap-1">
        <ExclamationTriangleIcon className="w-3 h-3" /> Erreur
      </span>
    );
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
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-blue-500" />
          Cartes
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Associez une image de carte à chaque page de type carte. L&apos;image FR est utilisée par défaut ;
          vous pouvez en définir une différente par langue si les étiquettes de la carte sont traduites.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Télécharger les GeoJSON</h3>
        <p className="text-xs text-gray-500 mb-4">
          POIs avec coordonnées GPS et labels strictement traduits. Pour les langues étrangères,
          la traduction est relancée puis attendue avant le téléchargement.
        </p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const busy = !!geoPreparing[lang.code] || !!downloadingGeo[lang.code] || !!translatingGeo[lang.code];
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => ensureGeocodeThenDownload(lang.code)}
                disabled={busy}
                title={
                  lang.code === 'fr'
                    ? `GeoJSON ${lang.label} (géocodage auto via Photon)`
                    : `GeoJSON ${lang.label} (traduction relancée puis géocodage auto via Photon)`
                }
                className="flex flex-col items-center gap-1 min-w-[4.5rem] px-2 py-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
              >
                {busy ? (
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                ) : (
                  <MapPinIcon className="w-5 h-5" />
                )}
                <span className="text-[10px] font-medium leading-tight text-center">
                  {lang.flag} {lang.label}
                </span>
                {renderTranslationBadge(lang.code)}
              </button>
            );
          })}
        </div>

        <PoiGeocodeAlerts
          failures={geocodeFailures}
          onCorrect={openGeocodeModal}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Contrôle du géocodage</h3>
            <p className="text-xs text-gray-500 mt-1">
              Vérifiez les points du GeoJSON, repérez les coordonnées hors destination et corrigez-les directement sur OpenStreetMap.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await loadQualityReport();
              await loadGeocodeFailures();
            }}
            disabled={qualityLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${qualityLoading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {qualityReport ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { key: 'all' as const, label: 'Total', value: qualityReport.stats.total, color: 'border-gray-200 text-gray-700 bg-gray-50' },
                { key: 'ok' as const, label: 'OK', value: qualityReport.stats.ok, color: 'border-emerald-200 text-emerald-700 bg-emerald-50' },
                { key: 'out_of_scope' as const, label: 'Hors zone', value: qualityReport.stats.out_of_scope, color: 'border-red-200 text-red-700 bg-red-50' },
                { key: 'missing' as const, label: 'Manquants', value: qualityReport.stats.missing, color: 'border-amber-200 text-amber-700 bg-amber-50' },
                { key: 'no_gps' as const, label: 'Sans GPS', value: qualityReport.stats.no_gps, color: 'border-slate-200 text-slate-600 bg-slate-50' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setQualityFilter(item.key)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${item.color} ${
                    qualityFilter === item.key ? 'ring-2 ring-blue-300' : ''
                  }`}
                >
                  <div className="text-[11px] font-medium">{item.label}</div>
                  <div className="text-lg font-semibold leading-tight">{item.value}</div>
                </button>
              ))}
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] gap-4">
              <div className="space-y-2">
                <OSMQualityMap
                  report={qualityReport}
                  selectedPoiId={selectedPoiId}
                  selectedClusterName={selectedClusterName}
                  onSelectPoi={(poi) => {
                    setSelectedPoiId(poi.page_id);
                    setSelectedClusterName(getPoiClusterName(poi));
                  }}
                  onPickCoordinates={(lat, lon) => {
                    if (!selectedPoiId) return;
                    setDraftCoordinates(selectedPoiId, lat.toFixed(6), lon.toFixed(6));
                  }}
                />
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> OK</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Hors zone</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> À compléter</span>
                  <span className="text-gray-400">Cliquez un POI, puis la carte pour préremplir ses coordonnées.</span>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
                  <span className="text-[11px] font-medium text-gray-500">Affichage</span>
                  <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setQualitySortMode('alphabetical')}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        qualitySortMode === 'alphabetical'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      A-Z
                    </button>
                    <button
                      type="button"
                      onClick={() => setQualitySortMode('cluster')}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        qualitySortMode === 'cluster'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Clusters
                    </button>
                  </div>
                </div>
                <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-200">
                  {filteredQualityPois.length === 0 ? (
                    <div className="p-4 text-xs text-gray-500">Aucun POI pour ce filtre.</div>
                  ) : (
                    filteredQualityPois.map((poi, index) => {
                      const selected = poi.page_id === selectedPoiId;
                      const statusTextClass = getStatusTextClass(poi.status);
                      const clusterName = getPoiClusterName(poi);
                      const previousClusterName = index > 0 ? getPoiClusterName(filteredQualityPois[index - 1]) : null;
                      const showClusterHeader = qualitySortMode === 'cluster' && clusterName !== previousClusterName;
                      const clusterSelected = selectedClusterName === clusterName;
                      return (
                        <Fragment key={poi.page_id}>
                          {showClusterHeader && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedClusterName((current) => current === clusterName ? null : clusterName);
                              }}
                              className={`block w-full px-3 py-1.5 text-left text-[11px] font-semibold uppercase transition-colors ${
                                clusterSelected
                                  ? 'bg-[#191E55] text-white'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                              }`}
                              title="Afficher les POI de ce cluster sur la carte"
                            >
                              {clusterName}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPoiId(poi.page_id);
                              setSelectedClusterName(clusterName);
                            }}
                            className={`block w-full text-left p-3 transition-colors ${
                              selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-800 truncate">{poi.titre}</div>
                                <div className="text-[11px] text-gray-500 truncate">
                                  {poi.cluster_name || poi.query || 'POI'}
                                </div>
                              </div>
                              <span className={`shrink-0 rounded-full border border-current bg-white px-2 py-0.5 text-[10px] font-semibold ${statusTextClass}`}>
                                {getStatusLabel(poi.status)}
                              </span>
                            </div>
                            {poi.coordinates && (
                              <div className="mt-1 text-[10px] text-gray-400 font-mono">
                                {poi.coordinates.lat.toFixed(5)}, {poi.coordinates.lon.toFixed(5)}
                              </div>
                            )}
                            {poi.issue && <div className="mt-1 text-[11px] text-red-600">{poi.issue}</div>}
                          </button>
                        </Fragment>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {selectedPoi && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="h-4 w-4 text-blue-600 shrink-0" />
                      <h4 className="text-sm font-semibold text-gray-900 truncate">{selectedPoi.titre}</h4>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {selectedPoi.query || selectedPoi.cluster_name || 'Coordonnées du POI'}
                    </p>
                    {selectedPoi.place_identity?.local_name && (
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        OSM : {selectedPoi.place_identity.local_name}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 md:w-[20rem]">
                    <label className="block">
                      <span className="text-[11px] text-gray-500">Latitude</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={coordinateDrafts[selectedPoi.page_id]?.lat ?? ''}
                        onChange={(event) => setDraftCoordinates(
                          selectedPoi.page_id,
                          event.target.value,
                          coordinateDrafts[selectedPoi.page_id]?.lon ?? ''
                        )}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-gray-500">Longitude</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={coordinateDrafts[selectedPoi.page_id]?.lon ?? ''}
                        onChange={(event) => setDraftCoordinates(
                          selectedPoi.page_id,
                          coordinateDrafts[selectedPoi.page_id]?.lat ?? '',
                          event.target.value
                        )}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-red-600">{coordinateErrors[selectedPoi.page_id] ?? ''}</p>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => regeocodePoi(selectedPoi)}
                      disabled={savingCoordinates[selectedPoi.page_id]}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      title="Relancer Photon avec la destination et le périmètre géographique"
                    >
                      <ArrowPathIcon className={`h-3.5 w-3.5 ${savingCoordinates[selectedPoi.page_id] ? 'animate-spin' : ''}`} />
                      Relancer Photon
                    </button>
                    <button
                      type="button"
                      onClick={() => markPoiWithoutGps(selectedPoi)}
                      disabled={savingCoordinates[selectedPoi.page_id]}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <NoSymbolIcon className="h-3.5 w-3.5" />
                      Sans GPS
                    </button>
                    <button
                      type="button"
                      onClick={() => savePoiCoordinates(selectedPoi)}
                      disabled={savingCoordinates[selectedPoi.page_id]}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingCoordinates[selectedPoi.page_id] ? (
                        <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                      )}
                      Enregistrer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
            {qualityLoading ? 'Chargement du contrôle GPS...' : 'Contrôle GPS indisponible pour le moment.'}
          </div>
        )}
      </div>

      {geocodeModal && (
        <PoiGeocodeModal
          guideId={guideId}
          apiUrl={apiUrl}
          initialFailures={geocodeFailures}
          pendingExport={geocodeModal.pendingExport}
          onClose={() => {
            setGeocodeModal(null);
            loadGeocodeFailures();
          }}
          onFailuresChange={setGeocodeFailures}
          onDownload={async (pending) => {
            setGeocodeModal(null);
            await loadGeocodeFailures();
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
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
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
    </div>
  );
}
