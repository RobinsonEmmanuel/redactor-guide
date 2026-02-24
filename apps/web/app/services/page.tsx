'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface FieldService {
  _id: string;
  service_id: string;
  label: string;
  description?: string;
  output_type: 'text' | 'json';
  context_keys?: string[];
  active: boolean;
  implemented: boolean;
  created_at?: string;
  updated_at?: string;
}

const OUTPUT_TYPE_COLORS = {
  json: 'bg-sky-100 text-sky-700',
  text: 'bg-violet-100 text-violet-700',
};

export default function FieldServicesPage() {
  const router = useRouter();
  const [services, setServices] = useState<FieldService[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/field-services?all=true`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setServices(data);
      }
    } catch (err) {
      console.error('Erreur chargement services:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (service: FieldService) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/field-services/${service._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: !service.active }),
      });
      if (res.ok) {
        setServices((prev) =>
          prev.map((s) => (s._id === service._id ? { ...s, active: !s.active } : s))
        );
      }
    } catch (err) {
      console.error('Erreur toggle active:', err);
    }
  };

  const handleDelete = async (service: FieldService) => {
    const usedInTemplates = confirm(
      `Supprimer le service "${service.label}" ?\n\nAttention : les champs de template qui référencent "${service.service_id}" ne seront pas mis à jour automatiquement.`
    );
    if (!usedInTemplates) return;

    try {
      const res = await fetch(`${apiUrl}/api/v1/field-services/${service._id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setServices((prev) => prev.filter((s) => s._id !== service._id));
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
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
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Services de champs</h1>
            <p className="mt-2 text-gray-600">
              Services calculés automatiquement à l'export — table des matières, statistiques, etc.
            </p>
          </div>
          <button
            onClick={() => router.push('/services/new')}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-white hover:bg-sky-700 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            Nouveau service
          </button>
        </div>

        {/* Bandeau explicatif */}
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <BoltIcon className="h-5 w-5 text-sky-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-sky-800">
            <p className="font-medium mb-1">Comment ça fonctionne ?</p>
            <p>
              Dans un template de page, sélectionnez le mode <strong>Calculé par service</strong> sur
              un champ. À l'export, le service reçoit la liste complète des pages construites et
              injecte automatiquement la valeur calculée — après que toutes les autres pages ont été
              traitées.
            </p>
          </div>
        </div>

        {/* Liste vide */}
        {services.length === 0 && (
          <div className="text-center py-16">
            <BoltIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg mb-2">Aucun service enregistré</p>
            <button
              onClick={() => router.push('/services/new')}
              className="text-sky-600 hover:underline text-sm"
            >
              Créer le premier service
            </button>
          </div>
        )}

        {/* Grille */}
        {services.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {services.map((service) => (
              <div
                key={service._id}
                className={`bg-white rounded-lg border p-6 hover:shadow-md transition-shadow ${
                  service.active ? 'border-gray-200' : 'border-gray-100 opacity-60'
                }`}
              >
                {/* En-tête */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-bold text-gray-900 truncate">
                        {service.label}
                      </h3>
                      {service.implemented ? (
                        <CheckCircleIcon
                          className="h-4 w-4 text-emerald-500 flex-shrink-0"
                          title="Handler implémenté"
                        />
                      ) : (
                        <XCircleIcon
                          className="h-4 w-4 text-amber-400 flex-shrink-0"
                          title="Handler non implémenté"
                        />
                      )}
                    </div>
                    <code className="text-xs text-gray-400 font-mono">{service.service_id}</code>
                  </div>
                </div>

                {/* Description */}
                {service.description && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-3">{service.description}</p>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${OUTPUT_TYPE_COLORS[service.output_type]}`}
                  >
                    {service.output_type}
                  </span>
                  {!service.implemented && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                      non implémenté
                    </span>
                  )}
                  {!service.active && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                      désactivé
                    </span>
                  )}
                  {service.context_keys && service.context_keys.length > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                      contexte : {service.context_keys.join(', ')}
                    </span>
                  )}
                </div>

                {/* Date */}
                {service.updated_at && (
                  <p className="text-xs text-gray-400 mb-4">
                    Modifié le {new Date(service.updated_at).toLocaleDateString('fr-FR')}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/services/${service._id}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-sky-600 border border-sky-600 rounded-lg hover:bg-sky-50 transition-colors"
                  >
                    <PencilIcon className="h-4 w-4" />
                    Modifier
                  </button>
                  <button
                    onClick={() => handleToggleActive(service)}
                    className={`flex items-center justify-center px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${
                      service.active
                        ? 'text-gray-500 border-gray-300 hover:bg-gray-50'
                        : 'text-emerald-600 border-emerald-300 hover:bg-emerald-50'
                    }`}
                    title={service.active ? 'Désactiver' : 'Activer'}
                  >
                    {service.active ? (
                      <XCircleIcon className="h-4 w-4" />
                    ) : (
                      <CheckCircleIcon className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(service)}
                    className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    title="Supprimer"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
