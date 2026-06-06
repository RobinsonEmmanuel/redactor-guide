'use client';

import { MapPinIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import type { PoiGeocodeFailure } from './poi-geocode-export';

interface PoiGeocodeAlertsProps {
  failures: PoiGeocodeFailure[];
  onCorrect: () => void;
}

export default function PoiGeocodeAlerts({ failures, onCorrect }: PoiGeocodeAlertsProps) {
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
