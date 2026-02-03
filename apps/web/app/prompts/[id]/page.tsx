'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

const INTENTS = [
  { value: 'redaction_page', label: 'Rédaction de page' },
  { value: 'resume_article', label: 'Résumé d\'article' },
  { value: 'extraction_infos', label: 'Extraction d\'informations' },
  { value: 'traduction', label: 'Traduction' },
  { value: 'optimisation_seo', label: 'Optimisation SEO' },
  { value: 'generation_titre', label: 'Génération de titre' },
  { value: 'reformulation', label: 'Reformulation' },
  { value: 'correction', label: 'Correction' },
  { value: 'enrichissement', label: 'Enrichissement' },
];

const PAGE_TYPES = [
  { value: '', label: 'Aucun (générique)' },
  { value: 'intro', label: 'Introduction' },
  { value: 'section', label: 'Section' },
  { value: 'poi', label: 'Point d\'intérêt' },
  { value: 'inspiration', label: 'Inspiration' },
  { value: 'transition', label: 'Transition' },
  { value: 'outro', label: 'Conclusion' },
  { value: 'pratique', label: 'Pratique' },
  { value: 'conseil', label: 'Conseil' },
];

export default function PromptEditPage() {
  const router = useRouter();
  const params = useParams();
  const isNew = params.id === 'new';
  const promptId = isNew ? null : params.id as string;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    prompt_id: '',
    prompt_nom: '',
    intent: 'redaction_page',
    page_type: '',
    langue_source: 'fr',
    texte_prompt: '',
    version: '1.0.0',
    actif: true,
    categories: [] as string[],
  });
  const [categoryInput, setCategoryInput] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    if (!isNew && promptId) {
      loadPrompt();
    }
  }, [promptId]);

  const loadPrompt = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/prompts/${promptId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setFormData({
          prompt_id: data.prompt_id,
          prompt_nom: data.prompt_nom,
          intent: data.intent,
          page_type: data.page_type || '',
          langue_source: data.langue_source,
          texte_prompt: data.texte_prompt,
          version: data.version,
          actif: data.actif,
          categories: data.categories || [],
        });
      }
    } catch (err) {
      console.error('Erreur chargement prompt:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload = {
        ...formData,
        page_type: formData.page_type || undefined,
      };

      const url = isNew
        ? `${apiUrl}/api/v1/prompts`
        : `${apiUrl}/api/v1/prompts/${promptId}`;

      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push('/prompts');
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

  const handleAddCategory = () => {
    if (categoryInput.trim() && !formData.categories.includes(categoryInput.trim())) {
      setFormData({
        ...formData,
        categories: [...formData.categories, categoryInput.trim()],
      });
      setCategoryInput('');
    }
  };

  const handleRemoveCategory = (category: string) => {
    setFormData({
      ...formData,
      categories: formData.categories.filter(c => c !== category),
    });
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

      <main className="flex-1 overflow-auto bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <button
            onClick={() => router.push('/prompts')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Retour aux prompts
          </button>

          <h1 className="text-3xl font-bold text-gray-900">
            {isNew ? 'Nouveau prompt' : 'Modifier le prompt'}
          </h1>
        </div>

        {/* Form */}
        <div className="p-8">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto bg-white rounded-lg border border-gray-200 p-8">
            <div className="space-y-6">
              {/* ID et Nom */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ID du prompt *
                  </label>
                  <input
                    type="text"
                    value={formData.prompt_id}
                    onChange={(e) => setFormData({ ...formData, prompt_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="ex: redaction_poi_fr"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">Identifiant unique, utilisé dans le code</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nom descriptif *
                  </label>
                  <input
                    type="text"
                    value={formData.prompt_nom}
                    onChange={(e) => setFormData({ ...formData, prompt_nom: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="ex: Rédaction POI en français"
                    required
                  />
                </div>
              </div>

              {/* Intent et Type de page */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Intent (action IA) *
                  </label>
                  <select
                    value={formData.intent}
                    onChange={(e) => setFormData({ ...formData, intent: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    {INTENTS.map((intent) => (
                      <option key={intent.value} value={intent.value}>
                        {intent.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Type de page (optionnel)
                  </label>
                  <select
                    value={formData.page_type}
                    onChange={(e) => setFormData({ ...formData, page_type: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {PAGE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Laissez vide pour un prompt générique
                  </p>
                </div>
              </div>

              {/* Langue et Version */}
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Langue source *
                  </label>
                  <input
                    type="text"
                    value={formData.langue_source}
                    onChange={(e) => setFormData({ ...formData, langue_source: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="fr"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Version
                  </label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1.0.0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Statut
                  </label>
                  <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.actif}
                      onChange={(e) => setFormData({ ...formData, actif: e.target.checked })}
                      className="rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Actif</span>
                  </label>
                </div>
              </div>

              {/* Catégories */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Catégories / Tags
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ajouter une catégorie..."
                  />
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Ajouter
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.categories.map((category) => (
                    <span
                      key={category}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                    >
                      {category}
                      <button
                        type="button"
                        onClick={() => handleRemoveCategory(category)}
                        className="hover:text-blue-900"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Texte du prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Texte du prompt *
                </label>
                <textarea
                  value={formData.texte_prompt}
                  onChange={(e) => setFormData({ ...formData, texte_prompt: e.target.value })}
                  rows={12}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  placeholder="Écrivez le prompt ici...&#10;&#10;Utilisez des variables si nécessaire : {{variable_name}}"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Le texte du prompt sera envoyé à l'IA tel quel. Utilisez des variables entre accolades si nécessaire.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-4 pt-6 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => router.push('/prompts')}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Enregistrement...' : isNew ? 'Créer le prompt' : 'Mettre à jour'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
