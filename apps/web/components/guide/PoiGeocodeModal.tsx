'use client';

import { useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { PendingGeoExport, PoiGeocodeFailure } from './poi-geocode-export';

interface PoiGeocodeModalProps {
  guideId: string;
  apiUrl: string;
  initialFailures: PoiGeocodeFailure[];
  pendingExport: PendingGeoExport | null;
  onClose: () => void;
  onFailuresChange: (failures: PoiGeocodeFailure[]) => void;
  onDownload: (pending: PendingGeoExport) => Promise<void>;
}

export default function PoiGeocodeModal({
  guideId,
  apiUrl,
  initialFailures,
  pendingExport,
  onClose,
  onFailuresChange,
  onDownload,
}: PoiGeocodeModalProps) {
  const [failures, setFailures] = useState<PoiGeocodeFailure[]>(initialFailures);
  const [coords, setCoords] = useState<Record<string, { lat: string; lon: string }>>(() => {
    const init: Record<string, { lat: string; lon: string }> = {};
    for (const f of initialFailures) {
      init[f.page_id] = { lat: '', lon: '' };
    }
    return init;
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState(false);

  const allDone = failures.length === 0;

  const removeFailure = (pageId: string) => {
    const next = failures.filter((x) => x.page_id !== pageId);
    setFailures(next);
    onFailuresChange(next);
  };

  const saveCoordinates = async (f: PoiGeocodeFailure) => {
    const entry = coords[f.page_id] ?? { lat: '', lon: '' };
    const lat = parseFloat(entry.lat.replace(',', '.'));
    const lon = parseFloat(entry.lon.replace(',', '.'));
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setErrors((prev) => ({
        ...prev,
        [f.page_id]: 'Latitude (-90 à 90) et longitude (-180 à 180) invalides',
      }));
      return;
    }

    setSaving((prev) => ({ ...prev, [f.page_id]: true }));
    setErrors((prev) => ({ ...prev, [f.page_id]: '' }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${f.page_id}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates: { lat, lon }, gps_not_applicable: false }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erreur serveur');
      }
      setSaved((prev) => ({ ...prev, [f.page_id]: true }));
      removeFailure(f.page_id);
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, [f.page_id]: err.message }));
    } finally {
      setSaving((prev) => ({ ...prev, [f.page_id]: false }));
    }
  };

  const skipNoGps = async (f: PoiGeocodeFailure) => {
    setSaving((prev) => ({ ...prev, [f.page_id]: true }));
    setErrors((prev) => ({ ...prev, [f.page_id]: '' }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${f.page_id}`,
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
      removeFailure(f.page_id);
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, [f.page_id]: err.message }));
    } finally {
      setSaving((prev) => ({ ...prev, [f.page_id]: false }));
    }
  };

  const pendingLabel = pendingExport
    ? pendingExport.kind === 'zip'
      ? 'package complet'
      : pendingExport.kind === 'package'
        ? 'package'
        : 'GeoJSON'
    : null;

  const handleDownload = async () => {
    if (!pendingExport || !allDone) return;
    setDownloading(true);
    try {
      await onDownload(pendingExport);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MapPinIcon className="w-5 h-5 text-red-500" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Coordonnées GPS manquantes
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {!allDone && (
                  <span className="text-red-600 font-medium">
                    {failures.length} POI{failures.length > 1 ? 's' : ''} à compléter
                  </span>
                )}
                {pendingLabel && !allDone && (
                  <> — le téléchargement {pendingLabel} attendra la fin des corrections</>
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

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {allDone ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <CheckCircleIcon className="w-10 h-10 text-green-500" />
              <p className="text-sm font-medium text-gray-700">Tous les POIs sont traités.</p>
              {pendingExport && (
                <p className="text-xs text-gray-500">Vous pouvez lancer le téléchargement.</p>
              )}
            </div>
          ) : (
            failures.map((f) => {
              const entry = coords[f.page_id] ?? { lat: '', lon: '' };
              return (
                <div key={f.page_id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{f.titre}</p>
                    {f.query && (
                      <p className="text-[11px] text-gray-500 mt-0.5">Recherche : {f.query}</p>
                    )}
                    {f.error && (
                      <p className="text-[11px] text-red-600 mt-0.5">{f.error}</p>
                    )}
                  </div>

                  <p className="text-[11px] text-gray-500 leading-snug">
                    Saisissez les coordonnées, ou excluez ce POI du GPS si le lieu n&apos;en a pas
                    <span className="text-gray-400"> (marché, zone non ponctuelle…)</span>
                    {' '}— <span className="text-gray-600">geometry: null dans le GeoJSON</span>.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-[11px] text-gray-500">Latitude</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={entry.lat}
                        onChange={(e) => {
                          setCoords((prev) => ({
                            ...prev,
                            [f.page_id]: { ...entry, lat: e.target.value },
                          }));
                          setSaved((prev) => ({ ...prev, [f.page_id]: false }));
                        }}
                        placeholder="28.367185"
                        className="mt-1 w-full text-sm rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-gray-500">Longitude</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={entry.lon}
                        onChange={(e) => {
                          setCoords((prev) => ({
                            ...prev,
                            [f.page_id]: { ...entry, lon: e.target.value },
                          }));
                          setSaved((prev) => ({ ...prev, [f.page_id]: false }));
                        }}
                        placeholder="-16.721539"
                        className="mt-1 w-full text-sm rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-red-500">{errors[f.page_id] ?? ''}</p>
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => skipNoGps(f)}
                        disabled={saving[f.page_id]}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
                      >
                        {saving[f.page_id] ? (
                          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <XMarkIcon className="w-3.5 h-3.5" />
                        )}
                        Pas de GPS
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCoordinates(f)}
                        disabled={saving[f.page_id] || !entry.lat.trim() || !entry.lon.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {saving[f.page_id] ? (
                          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                        ) : saved[f.page_id] ? (
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                        )}
                        {saved[f.page_id] ? 'Enregistré' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {allDone && !pendingExport ? 'Fermer' : 'Annuler'}
          </button>
          {pendingExport && (
            <button
              onClick={handleDownload}
              disabled={!allDone || downloading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowDownTrayIcon className="w-4 h-4" />
              )}
              Télécharger
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
