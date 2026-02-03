'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';

interface Template {
  _id: string;
  name: string;
  description?: string;
  fields: Array<{
    id: string;
    type: string;
    name: string;
    order: number;
  }>;
  created_at?: string;
  updated_at?: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/templates`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce template ?')) {
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/templates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setTemplates(templates.filter((t) => t._id !== id));
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
      alert('Erreur lors de la suppression');
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
            <h1 className="text-3xl font-bold text-gray-900">Templates</h1>
            <p className="mt-2 text-gray-600">
              Structures éditoriales pour les pages du chemin de fer
            </p>
          </div>
          <button
            onClick={() => router.push('/templates/new')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            Nouveau template
          </button>
        </div>

        {/* Liste vide */}
        {templates.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-4">Aucun template</div>
            <button
              onClick={() => router.push('/templates/new')}
              className="text-blue-600 hover:underline"
            >
              Créer votre premier template
            </button>
          </div>
        )}

        {/* Grille de templates */}
        {templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div
                key={template._id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                {/* Nom du template */}
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-gray-900 mb-1">
                    {template.name}
                  </h3>
                  {template.description && (
                    <p className="text-sm text-gray-600">{template.description}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="mb-4 flex items-center gap-4 text-sm text-gray-500">
                  <span>{template.fields.length} champs</span>
                  {template.updated_at && (
                    <span>
                      Modifié le{' '}
                      {new Date(template.updated_at).toLocaleDateString('fr-FR')}
                    </span>
                  )}
                </div>

                {/* Types de champs */}
                <div className="mb-4">
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(template.fields.map((f) => f.type))).map(
                      (type) => (
                        <span
                          key={type}
                          className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700"
                        >
                          {type}
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/templates/${template._id}`)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <PencilIcon className="h-4 w-4" />
                    Modifier
                  </button>
                  <button
                    onClick={() => handleDelete(template._id)}
                    className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-600 rounded-lg hover:bg-red-50 transition-colors"
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
