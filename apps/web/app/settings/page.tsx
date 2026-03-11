'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { Cog6ToothIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface AppSettings {
  generation_budget_ratio:    number;
  translation_retry_max:      number;
  translation_overflow_alert: boolean;
}

const DEFAULT: AppSettings = {
  generation_budget_ratio:    0.75,
  translation_retry_max:      3,
  translation_overflow_alert: true,
};

export default function SettingsPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const [settings, setSettings] = useState<AppSettings>(DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setSettings({ ...DEFAULT, ...data }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erreur serveur');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <div className="flex items-center gap-3 mb-8">
            <Cog6ToothIcon className="h-7 w-7 text-gray-600" />
            <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          </div>

          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : (
            <div className="space-y-6">

              {/* Section calibrage */}
              <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 border-b border-gray-100 pb-3">
                  Calibrage des textes générés
                </h2>

                {/* Budget ratio */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ratio budget génération (français)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Le LLM reçoit <code className="bg-gray-100 px-1 rounded">max_chars × ratio</code> comme limite.
                    Protège contre l'expansion à la traduction (DE +30%, ES +15%…).
                    Valeur recommandée : <strong>0.75</strong>.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.5" max="1" step="0.05"
                      value={settings.generation_budget_ratio}
                      onChange={e => setSettings(s => ({ ...s, generation_budget_ratio: parseFloat(e.target.value) }))}
                      className="flex-1"
                    />
                    <span className="w-14 text-center font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                      {(settings.generation_budget_ratio * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>50% (très conservateur)</span>
                    <span>100% (aucune marge)</span>
                  </div>
                </div>
              </section>

              {/* Section traduction */}
              <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 border-b border-gray-100 pb-3">
                  Traduction multilingue
                </h2>

                {/* Retry max */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre de passes de condensation (retries overflow)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Si un champ traduit dépasse son calibre InDesign, l'IA tente de le condenser
                    en <em>N</em> passes avec une pression croissante.
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(n => (
                      <button
                        key={n}
                        onClick={() => setSettings(s => ({ ...s, translation_retry_max: n }))}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          settings.translation_retry_max === n
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {n} {n === 1 ? 'passe' : 'passes'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Passe 1 : condensation standard · Passe 2 : pression explicite · Passe 3 : mode minimaliste
                  </p>
                </div>

                {/* Alerte overflow */}
                <div className="flex items-start gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="overflow-alert"
                    checked={settings.translation_overflow_alert}
                    onChange={e => setSettings(s => ({ ...s, translation_overflow_alert: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <label htmlFor="overflow-alert" className="text-sm font-medium text-gray-700 cursor-pointer">
                      Alertes de dépassement manuel
                    </label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Après toutes les passes, les champs qui dépassent encore leur calibre sont signalés
                      dans l'onglet Export pour correction manuelle.
                    </p>
                  </div>
                </div>
              </section>

              {/* Actions */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                {saved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircleIcon className="h-4 w-4" />
                    Paramètres sauvegardés
                  </span>
                )}
                {error && (
                  <span className="flex items-center gap-1.5 text-sm text-red-600">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    {error}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
