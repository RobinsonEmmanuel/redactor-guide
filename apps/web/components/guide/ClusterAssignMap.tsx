'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPinIcon } from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinSolidIcon } from '@heroicons/react/24/solid';

const TILE_SIZE = 256;

interface MapPoi {
  poi_id: string;
  nom: string;
  type: string;
  cluster_id?: string | null;
  cluster_name?: string;
  coordinates?: { lat: number; lon: number; display_name?: string };
}

interface ClusterOption {
  cluster_id: string;
  cluster_name: string;
}

interface ClusterAssignMapProps {
  pois: MapPoi[];
  clusters: ClusterOption[];
  apiUrl: string;
  guideId: string;
  onAssigned: (poiId: string, clusterId: string | null, clusterName: string | null) => void;
}

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

/** Palette de couleurs stables par cluster (indexée par hash du nom, pas de l'ID — plus lisible). */
const CLUSTER_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2',
  '#c026d3', '#65a30d', '#e11d48', '#0d9488', '#9333ea', '#ea580c',
];

function colorForCluster(clusterName: string | undefined | null): string {
  if (!clusterName) return '#9ca3af'; // gris — non affecté
  let hash = 0;
  for (let i = 0; i < clusterName.length; i++) hash = (hash * 31 + clusterName.charCodeAt(i)) >>> 0;
  return CLUSTER_COLORS[hash % CLUSTER_COLORS.length];
}

export default function ClusterAssignMap({ pois, clusters, apiUrl, guideId, onAssigned }: ClusterAssignMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; centerWorldX: number; centerWorldY: number } | null>(null);
  const dragMovedRef = useRef(false);

  const [mapWidth, setMapWidth] = useState(760);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [centerOverride, setCenterOverride] = useState<{ lat: number; lon: number } | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [pendingClusterId, setPendingClusterId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const updateWidth = () => setMapWidth(Math.max(320, Math.round(node.getBoundingClientRect().width)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const points = pois.filter(p => p.coordinates && (!onlyUnassigned || !p.cluster_id));
  const width = mapWidth;
  const height = 420;
  const baseZoom = points.length > 0 ? 9 : 5;
  const zoom = Math.max(2, Math.min(18, baseZoom + zoomOffset));

  const defaultCenter = points.length > 0
    ? {
        lat: points.reduce((sum, p) => sum + (p.coordinates?.lat ?? 0), 0) / points.length,
        lon: points.reduce((sum, p) => sum + (p.coordinates?.lon ?? 0), 0) / points.length,
      }
    : { lat: 46.6, lon: 2.4 }; // centre France, repli si aucun point
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
      tiles.push({ x, y, left: x * TILE_SIZE - minX, top: y * TILE_SIZE - minY, url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png` });
    }
  }

  const project = (lat: number, lon: number) => {
    const world = lonLatToWorld(lat, lon, zoom);
    return { left: world.x - minX, top: world.y - minY };
  };

  const selectedPoi = points.find(p => p.poi_id === selectedPoiId) ?? null;

  const handleSelect = (poi: MapPoi) => {
    setSelectedPoiId(poi.poi_id);
    setPendingClusterId(poi.cluster_id || '');
  };

  const handleAssign = async () => {
    if (!selectedPoi) return;
    setSaving(true);
    try {
      const targetCluster = clusters.find(c => c.cluster_id === pendingClusterId);
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/pois/${selectedPoi.poi_id}/cluster`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster_id: pendingClusterId || null,
          cluster_name: targetCluster?.cluster_name ?? null,
        }),
      });
      if (res.ok) {
        onAssigned(selectedPoi.poi_id, pendingClusterId || null, targetCluster?.cluster_name ?? null);
        setSelectedPoiId(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`❌ ${err.error || 'Erreur lors de l\'affectation'}`);
      }
    } catch (err) {
      console.error('Erreur affectation via carte:', err);
      alert('❌ Erreur lors de l\'affectation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MapPinIcon className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-gray-800">Carte d'aide à l'affectation</span>
          <span className="text-xs text-gray-400">({points.length} POI{points.length > 1 ? 's' : ''} géolocalisé{points.length > 1 ? 's' : ''})</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} className="rounded" />
          Non affectés seulement
        </label>
      </div>

      {/* Légende des clusters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 overflow-x-auto text-xs">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-white shadow ring-1 ring-gray-300" style={{ backgroundColor: '#9ca3af' }} />
          <span className="text-gray-500">Non affecté</span>
        </div>
        {clusters.map(c => (
          <div key={c.cluster_id} className="flex items-center gap-1.5 flex-shrink-0">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-white shadow" style={{ backgroundColor: colorForCluster(c.cluster_name) }} />
            <span className="text-gray-600 whitespace-nowrap">{c.cluster_name}</span>
          </div>
        ))}
      </div>

      <div
        ref={mapRef}
        className="relative cursor-grab overflow-hidden bg-slate-100 active:cursor-grabbing"
        style={{ height }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('button')) return;
          dragMovedRef.current = false;
          dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, centerWorldX: centerWorld.x, centerWorldY: centerWorld.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;
          setCenterOverride(worldToLonLat(drag.centerWorldX - dx, drag.centerWorldY - dy, zoom));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        {tiles.map(tile => (
          <img
            key={`${tile.x}:${tile.y}`}
            src={tile.url}
            alt=""
            className="absolute max-w-none select-none"
            draggable={false}
            style={{ width: TILE_SIZE, height: TILE_SIZE, left: tile.left, top: tile.top }}
          />
        ))}

        {points.map(poi => {
          const coords = poi.coordinates!;
          const pos = project(coords.lat, coords.lon);
          const selected = poi.poi_id === selectedPoiId;
          const isUnassigned = !poi.cluster_id;
          const color = colorForCluster(poi.cluster_name);
          return (
            <button
              key={poi.poi_id}
              type="button"
              onClick={(event) => { event.stopPropagation(); handleSelect(poi); }}
              className={`absolute -translate-x-1/2 -translate-y-full transition-transform ${selected ? 'scale-125 z-20' : 'z-10 hover:scale-110'}`}
              style={{ left: pos.left, top: pos.top }}
              title={`${poi.nom}${poi.cluster_name ? ` — ${poi.cluster_name}` : ' — non affecté'}`}
            >
              {selected ? (
                <MapPinSolidIcon className="h-8 w-8 drop-shadow-md" style={{ color }} />
              ) : isUnassigned ? (
                <span className="relative flex h-5 w-5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />
                  <span className="relative inline-flex h-5 w-5 rounded-full border-2 border-white shadow" style={{ backgroundColor: color }} />
                </span>
              ) : (
                <span className="block h-4 w-4 rounded-full border-2 border-white shadow" style={{ backgroundColor: color }} />
              )}
            </button>
          );
        })}

        <div className="absolute left-3 top-3 flex overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-sm">
          <button type="button" onClick={() => setZoomOffset(v => Math.min(v + 1, 8))} className="h-8 w-8 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40" disabled={zoom >= 18} title="Zoomer">+</button>
          <button type="button" onClick={() => setZoomOffset(v => Math.max(v - 1, -8))} className="h-8 w-8 border-l border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40" disabled={zoom <= 2} title="Dézoomer">-</button>
        </div>

        <div className="absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 text-[10px] text-gray-500 shadow-sm">© OpenStreetMap</div>
      </div>

      {/* Panneau d'affectation du POI sélectionné */}
      {selectedPoi && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 bg-orange-50/50 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCluster(selectedPoi.cluster_name) }} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{selectedPoi.nom}</div>
            <div className="text-xs text-gray-500">{selectedPoi.cluster_name ? `Actuellement : ${selectedPoi.cluster_name}` : 'Actuellement non affecté'}</div>
          </div>
          <select
            value={pendingClusterId}
            onChange={e => setPendingClusterId(e.target.value)}
            className="ml-auto px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Non affecté</option>
            {clusters.map(c => (
              <option key={c.cluster_id} value={c.cluster_id}>{c.cluster_name}</option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={saving}
            className="px-4 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Enregistrement...' : 'Valider'}
          </button>
          <button onClick={() => setSelectedPoiId(null)} className="text-xs text-gray-500 hover:text-gray-700">Annuler</button>
        </div>
      )}

      {!selectedPoi && points.length > 0 && (
        <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500 flex items-center gap-1.5">
          👆 Cliquez sur un point de la carte pour voir son nom et l'affecter à un cluster.
        </div>
      )}

      {points.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-gray-400">
          Aucun POI géolocalisé à afficher{onlyUnassigned ? ' parmi les non affectés' : ''}.
        </div>
      )}
    </div>
  );
}
