'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  DocumentDuplicateIcon,
  CheckCircleIcon,
  XCircleIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface Prompt {
  _id: string;
  prompt_id: string;
  prompt_nom: string;
  intent: string;
  page_type?: string;
  langue_source: string;
  version: string;
  actif: boolean;
  categories: string[];
  date_mise_a_jour: string;
}

const INTENT_LABELS: Record<string, string> = {
  redaction_page: 'Rédaction de page',
  resume_article: 'Résumé d\'article',
  extraction_infos: 'Extraction d\'informations',
  traduction: 'Traduction',
  optimisation_seo: 'Optimisation SEO',
  generation_titre: 'Génération de titre',
  reformulation: 'Reformulation',
  correction: 'Correction',
  enrichissement: 'Enrichissement',
};

const INTENT_COLORS: Record<string, string> = {
  redaction_page: 'bg-blue-100 text-blue-700',
  resume_article: 'bg-purple-100 text-purple-700',
  extraction_infos: 'bg-green-100 text-green-700',
  traduction: 'bg-orange-100 text-orange-700',
  optimisation_seo: 'bg-pink-100 text-pink-700',
  generation_titre: 'bg-indigo-100 text-indigo-700',
  reformulation: 'bg-yellow-100 text-yellow-700',
  correction: 'bg-red-100 text-red-700',
  enrichissement: 'bg-teal-100 text-teal-700',
};

export default function PromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [filterIntent, setFilterIntent] = useState('');
  const [filterActif, setFilterActif] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadPrompts();
  }, [filterIntent, filterActif]);

  const handleSeedPrompts = async () => {
    if (!confirm('Créer/remplacer les prompts système (sommaire + rédaction) ?')) {
      return;
    }

    setSeeding(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/prompts/seed-sommaire`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        alert('✅ Prompts système créés avec succès !');
        loadPrompts();
      } else {
        const error = await res.json();
        alert(`Erreur: ${error.error || 'Impossible de créer les prompts'}`);
      }
    } catch (err) {
      console.error('Erreur seed prompts:', err);
      alert('Erreur lors de la création des prompts');
    } finally {
      setSeeding(false);
    }
  };

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterIntent) params.append('intent', filterIntent);
      if (filterActif) params.append('actif', filterActif);

      const res = await fetch(`${apiUrl}/api/v1/prompts?${params}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPrompts(data);
      }
    } catch (err) {
      console.error('Erreur chargement prompts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce prompt ?')) return;

    try {
      const res = await fetch(`${apiUrl}/api/v1/prompts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        loadPrompts();
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/prompts/${id}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        loadPrompts();
      }
    } catch (err) {
      console.error('Erreur duplication:', err);
    }
  };

  const handleToggleActif = async (prompt: Prompt) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/prompts/${prompt._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actif: !prompt.actif }),
      });

      if (res.ok) {
        loadPrompts();
      }
    } catch (err) {
      console.error('Erreur activation:', err);
    }
  };

  const filteredPrompts = prompts;

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Prompts IA</h1>
              <p className="text-gray-600 mt-1">
                Gérez les prompts pour les différentes actions de l'IA
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSeedPrompts}
                disabled={seeding}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {seeding ? '⏳ Création...' : '🌱 Créer prompts système'}
              </button>
              <button
                onClick={() => router.push('/prompts/new')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <PlusIcon className="h-5 w-5" />
                Nouveau prompt
              </button>
            </div>
          </div>

          {/* Filtres */}
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-4 w-4 text-gray-400" />
              <select
                value={filterIntent}
                onChange={(e) => setFilterIntent(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
              >
                <option value="">Tous les intents</option>
                {Object.entries(INTENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <select
              value={filterActif}
              onChange={(e) => setFilterActif(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
            >
              <option value="">Tous les statuts</option>
              <option value="true">Actifs uniquement</option>
              <option value="false">Inactifs uniquement</option>
            </select>
          </div>
        </div>

        {/* Liste */}
        <div className="p-8">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Chargement...</div>
          ) : filteredPrompts.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <p className="text-gray-500 mb-4">Aucun prompt trouvé</p>
              <button
                onClick={() => router.push('/prompts/new')}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Créer le premier prompt
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Nom
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Intent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Type de page
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Langue
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Version
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Statut
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredPrompts.map((prompt) => (
                    <tr key={prompt._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {prompt.prompt_nom}
                        </div>
                        <div className="text-xs text-gray-500">
                          {prompt.prompt_id}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${INTENT_COLORS[prompt.intent] || 'bg-gray-100 text-gray-700'}`}>
                          {INTENT_LABELS[prompt.intent] || prompt.intent}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {prompt.page_type || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {prompt.langue_source.toUpperCase()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        v{prompt.version}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleToggleActif(prompt)}
                          className="inline-flex items-center gap-1 text-sm"
                        >
                          {prompt.actif ? (
                            <>
                              <CheckCircleIcon className="h-5 w-5 text-green-500" />
                              <span className="text-green-700 font-medium">Actif</span>
                            </>
                          ) : (
                            <>
                              <XCircleIcon className="h-5 w-5 text-gray-400" />
                              <span className="text-gray-500">Inactif</span>
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => router.push(`/prompts/${prompt._id}`)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Modifier"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(prompt._id)}
                            className="text-purple-600 hover:text-purple-800"
                            title="Dupliquer"
                          >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(prompt._id)}
                            className="text-red-600 hover:text-red-800"
                            title="Supprimer"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
