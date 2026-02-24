'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface ServiceFormData {
  service_id: string;
  label: string;
  description: string;
  output_type: 'text' | 'json';
  context_keys: string[];
  active: boolean;
}

interface ServiceFormProps {
  serviceId?: string;
}

const CONTEXT_KEY_SUGGESTIONS = [
  'all_pages',
  'guide',
  'current_page',
  'chemin_de_fer',
  'templates',
];

const NATIVE_SERVICE_IDS = ['sommaire_generator'];

export default function ServiceForm({ serviceId }: ServiceFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ServiceFormData>({
    service_id: '',
    label: '',
    description: '',
    output_type: 'json',
    context_keys: [],
    active: true,
  });
  const [loading, setLoading] = useState(!!serviceId);
  const [saving, setSaving] = useState(false);
  const [implemented, setImplemented] = useState<boolean | null>(null);
  const [newContextKey, setNewContextKey] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const isEditing = !!serviceId;
  const isNative = NATIVE_SERVICE_IDS.includes(form.service_id);

  useEffect(() => {
    if (serviceId) loadService();
  }, [serviceId]);

  const loadService = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/field-services/${serviceId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setForm({
          service_id: data.service_id,
          label: data.label,
          description: data.description || '',
          output_type: data.output_type || 'json',
          context_keys: data.context_keys || [],
          active: data.active ?? true,
        });
        setImplemented(data.implemented);
      }
    } catch (err) {
      console.error('Erreur chargement service:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.service_id.trim() || !form.label.trim()) {
      alert('L\'identifiant et le label sont requis');
      return;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(form.service_id)) {
      alert('L\'identifiant doit être en snake_case minuscules (ex: sommaire_generator)');
      return;
    }

    setSaving(true);
    try {
      const url = isEditing
        ? `${apiUrl}/api/v1/field-services/${serviceId}`
        : `${apiUrl}/api/v1/field-services`;
      const method = isEditing ? 'PUT' : 'POST';

      const body = isEditing
        ? { label: form.label, description: form.description, output_type: form.output_type, context_keys: form.context_keys, active: form.active }
        : form;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push('/services');
      } else {
        const error = await res.json();
        alert(error.error || 'Erreur lors de la sauvegarde');
      }
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const addContextKey = (key: string) => {
    const trimmed = key.trim();
    if (trimmed && !form.context_keys.includes(trimmed)) {
      setForm({ ...form, context_keys: [...form.context_keys, trimmed] });
    }
    setNewContextKey('');
  };

  const removeContextKey = (key: string) => {
    setForm({ ...form, context_keys: form.context_keys.filter((k) => k !== key) });
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/services')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Retour aux services
          </button>
          <div className="flex items-start gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {isEditing ? 'Modifier le service' : 'Nouveau service'}
              </h1>
              {isEditing && (
                <p className="mt-1 text-gray-500 font-mono text-sm">{form.service_id}</p>
              )}
            </div>
            {/* Statut implémentation */}
            {implemented !== null && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium mt-1 ${
                  implemented
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {implemented ? (
                  <CheckCircleIcon className="h-4 w-4" />
                ) : (
                  <XCircleIcon className="h-4 w-4" />
                )}
                {implemented ? 'Handler implémenté' : 'Handler non implémenté'}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          {/* Informations de base */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Identification</h2>

            {/* service_id */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Identifiant technique <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.service_id}
                onChange={(e) =>
                  setForm({ ...form, service_id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
                }
                disabled={isEditing}
                placeholder="sommaire_generator"
                className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent ${
                  isEditing ? 'bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200' : 'border-gray-300'
                }`}
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                snake_case minuscules — immuable après création. Doit correspondre à un handler
                enregistré dans <code className="font-mono bg-gray-100 px-1 rounded">FieldServiceRunner</code>.
              </p>
              {isNative && (
                <p className="mt-1 text-xs text-sky-600">
                  Service natif — le handler est déjà implémenté dans le backend.
                </p>
              )}
            </div>

            {/* Label */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Générateur de sommaire"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Décrivez ce que fait ce service et dans quel contexte l'utiliser..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Configuration */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Configuration</h2>

            {/* output_type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type de sortie
              </label>
              <div className="flex gap-3">
                {(['json', 'text'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, output_type: type })}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
                      form.output_type === type
                        ? type === 'json'
                          ? 'bg-sky-50 border-sky-400 text-sky-700'
                          : 'bg-violet-50 border-violet-400 text-violet-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {type === 'json' ? '{ } JSON structuré' : 'T Texte brut'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {form.output_type === 'json'
                  ? 'La valeur produite est un JSON sérialisé — le script InDesign devra le parser.'
                  : 'La valeur produite est un texte brut directement injectable dans un calque.'}
              </p>
            </div>

            {/* context_keys */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Clés de contexte utilisées
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Informatif uniquement — le service reçoit toujours l'intégralité du contexte.
              </p>

              {/* Clés sélectionnées */}
              <div className="flex flex-wrap gap-2 mb-2">
                {form.context_keys.map((key) => (
                  <span
                    key={key}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-gray-100 text-gray-700 rounded-full"
                  >
                    {key}
                    <button
                      type="button"
                      onClick={() => removeContextKey(key)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {form.context_keys.length === 0 && (
                  <span className="text-xs text-gray-400 italic">Aucune clé renseignée</span>
                )}
              </div>

              {/* Suggestions */}
              <div className="flex flex-wrap gap-1 mb-2">
                {CONTEXT_KEY_SUGGESTIONS.filter((k) => !form.context_keys.includes(k)).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => addContextKey(k)}
                    className="px-2 py-0.5 text-xs font-mono text-sky-600 border border-sky-200 rounded-full hover:bg-sky-50 transition-colors"
                  >
                    + {k}
                  </button>
                ))}
              </div>

              {/* Ajout manuel */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newContextKey}
                  onChange={(e) => setNewContextKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addContextKey(newContextKey);
                    }
                  }}
                  placeholder="Autre clé..."
                  className="flex-1 px-3 py-1.5 text-xs font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => addContextKey(newContextKey)}
                  disabled={!newContextKey.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sky-600 border border-sky-300 rounded-lg hover:bg-sky-50 disabled:opacity-40 transition-colors"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Ajouter
                </button>
              </div>
            </div>

            {/* Actif / Inactif */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium text-gray-700">Service actif</p>
                <p className="text-xs text-gray-500">
                  Un service inactif n'apparaît pas dans les formulaires de template.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, active: !form.active })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  form.active ? 'bg-sky-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.active ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-8">
            <button
              type="button"
              onClick={() => router.push('/services')}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving || !form.service_id || !form.label}
              className="px-6 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Enregistrement...' : isEditing ? 'Mettre à jour' : 'Créer le service'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
