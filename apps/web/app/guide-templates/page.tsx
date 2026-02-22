'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  Square3Stack3DIcon,
  MapPinIcon,
  LightBulbIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

interface GuideTemplate {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  is_default: boolean;
  structure: any[];
  created_at: string;
  updated_at: string;
}

export default function GuideTemplatesPage() {
  const [templates, setTemplates] = useState<GuideTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<GuideTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<GuideTemplate | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(`${apiUrl}/api/v1/guide-templates`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('📋 Templates chargés:', data);
        setTemplates(data.templates || []);
      } else {
        console.error('❌ Erreur HTTP:', res.status, await res.text());
      }
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStructureStats = (structure: any[]) => {
    const stats = {
      fixed_pages: 0,
      sections: 0,
      has_clusters: false,
      has_inspirations: false,
      has_saisons: false,
    };

    structure.forEach(block => {
      if (block.type === 'fixed_page') {
        stats.fixed_pages++;
      } else if (block.type === 'section') {
        stats.sections++;
        if (block.source === 'clusters') stats.has_clusters = true;
        if (block.source === 'inspirations') stats.has_inspirations = true;
        if (block.template_name === 'SAISON') stats.has_saisons = true;
      }
    });

    return stats;
  };

  const getBlockIcon = (block: any) => {
    if (block.type === 'fixed_page') {
      return <DocumentTextIcon className="w-4 h-4" />;
    }
    if (block.source === 'clusters') {
      return <Square3Stack3DIcon className="w-4 h-4" />;
    }
    if (block.source === 'inspirations') {
      return <LightBulbIcon className="w-4 h-4" />;
    }
    if (block.template_name === 'SAISON') {
      return <SparklesIcon className="w-4 h-4" />;
    }
    return <MapPinIcon className="w-4 h-4" />;
  };

  const getBlockLabel = (block: any) => {
    if (block.type === 'fixed_page') {
      return block.template_name || 'Page fixe';
    }
    if (block.type === 'section') {
      return block.section_title || block.name || 'Section';
    }
    return 'Bloc inconnu';
  };

  const handleDeleteTemplate = async (template: GuideTemplate) => {
    if (template.is_default) {
      alert('Impossible de supprimer un template par défaut');
      return;
    }

    if (!confirm(`Voulez-vous vraiment supprimer le template "${template.name}" ?`)) {
      return;
    }

    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(`${apiUrl}/api/v1/guide-templates/${template._id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });

      if (res.ok) {
        loadTemplates();
        if (selectedTemplate?._id === template._id) {
          setSelectedTemplate(null);
        }
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
      alert('Erreur lors de la suppression');
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Templates de guides</h1>
              <p className="text-gray-600 mt-1">
                Gérez les différents types de guides (Complet, Compact, Thématique...)
              </p>
            </div>
            <button
              onClick={() => {/* TODO: Ouvrir modal création */}}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
            >
              <PlusIcon className="w-5 h-5" />
              Nouveau template
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              <p className="text-gray-500 mt-4">Chargement...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
              <Square3Stack3DIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Aucun template de guide
              </h3>
              <p className="text-gray-500 mb-4">
                Lancez le script de seed pour créer les templates par défaut
              </p>
              <div className="bg-gray-50 rounded p-4 text-left max-w-xl mx-auto">
                <p className="text-sm font-mono text-gray-700">
                  $ MONGODB_URI=your_connection_string node seed-guide-templates.js
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {templates.map((template) => {
                const stats = getStructureStats(template.structure);
                return (
                  <div
                    key={template._id}
                    className={`bg-white rounded-lg border-2 transition-all cursor-pointer ${
                      selectedTemplate?._id === template._id
                        ? 'border-orange-500 shadow-lg'
                        : 'border-gray-200 hover:border-orange-300 hover:shadow-md'
                    }`}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="p-6">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-gray-900">
                              {template.name}
                            </h3>
                            {template.is_default && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded">
                                <CheckCircleIcon className="w-3 h-3" />
                                Par défaut
                              </span>
                            )}
                          </div>
                          {template.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {template.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTemplate(template);
                              setShowEditModal(true);
                            }}
                            className="p-2 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded transition-colors"
                            title="Éditer"
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          {!template.is_default && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTemplate(template);
                              }}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Supprimer"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-gray-50 rounded p-3">
                          <div className="text-2xl font-bold text-gray-900">
                            {template.structure.length}
                          </div>
                          <div className="text-xs text-gray-600">Blocs total</div>
                        </div>
                        <div className="bg-gray-50 rounded p-3">
                          <div className="text-2xl font-bold text-gray-900">
                            {stats.fixed_pages}
                          </div>
                          <div className="text-xs text-gray-600">Pages fixes</div>
                        </div>
                      </div>

                      {/* Features */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        {stats.has_clusters && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded">
                            <Square3Stack3DIcon className="w-3 h-3" />
                            Clusters
                          </span>
                        )}
                        {stats.has_inspirations && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded">
                            <LightBulbIcon className="w-3 h-3" />
                            Inspirations
                          </span>
                        )}
                        {stats.has_saisons && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded">
                            <SparklesIcon className="w-3 h-3" />
                            Saisons
                          </span>
                        )}
                      </div>

                      {/* Structure preview */}
                      {selectedTemplate?._id === template._id && (
                        <div className="border-t border-gray-200 pt-4 mt-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3">
                            Structure ({template.structure.length} blocs)
                          </h4>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {template.structure.map((block, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2 text-xs bg-gray-50 rounded p-2"
                              >
                                <div className="w-6 h-6 rounded bg-white flex items-center justify-center text-gray-600 font-semibold flex-shrink-0">
                                  {block.ordre}
                                </div>
                                <div className="text-gray-600 flex-shrink-0">
                                  {getBlockIcon(block)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 truncate">
                                    {getBlockLabel(block)}
                                  </div>
                                  {block.description && (
                                    <div className="text-gray-500 truncate">
                                      {block.description}
                                    </div>
                                  )}
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                                  block.type === 'fixed_page'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {block.type === 'fixed_page' ? 'Fixe' : 'Section'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modal d'édition */}
      {showEditModal && editingTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">
                Éditer : {editingTemplate.name}
              </h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingTemplate(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Note :</strong> L'édition complète des templates de guides sera disponible prochainement.
                  Pour l'instant, vous pouvez visualiser la structure du template.
                </p>
              </div>

              {/* Informations de base */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Informations</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nom</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Slug</label>
                    <input
                      type="text"
                      value={editingTemplate.slug}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      value={editingTemplate.description || ''}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editingTemplate.is_default}
                      disabled
                      className="rounded border-gray-300"
                    />
                    <label className="text-sm text-gray-700">Template par défaut</label>
                  </div>
                </div>
              </div>

              {/* Structure */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Structure ({editingTemplate.structure.length} blocs)
                </h3>
                <div className="space-y-3">
                  {editingTemplate.structure.map((block, index) => (
                    <div
                      key={index}
                      className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-gray-600 font-semibold flex-shrink-0 border border-gray-300">
                          {block.ordre}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="text-gray-600">
                              {getBlockIcon(block)}
                            </div>
                            <div className="font-semibold text-gray-900">
                              {getBlockLabel(block)}
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              block.type === 'fixed_page'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {block.type === 'fixed_page' ? 'Page fixe' : 'Section'}
                            </span>
                          </div>
                          
                          {block.description && (
                            <p className="text-sm text-gray-600 mb-2">{block.description}</p>
                          )}

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {block.template_name && (
                              <div>
                                <span className="text-gray-500">Template:</span>
                                <span className="ml-1 font-medium text-gray-700">{block.template_name}</span>
                              </div>
                            )}
                            {block.source && (
                              <div>
                                <span className="text-gray-500">Source:</span>
                                <span className="ml-1 font-medium text-gray-700">{block.source}</span>
                              </div>
                            )}
                            {block.content_type && (
                              <div>
                                <span className="text-gray-500">Type:</span>
                                <span className="ml-1 font-medium text-gray-700">{block.content_type}</span>
                              </div>
                            )}
                            {block.pages_count !== undefined && (
                              <div>
                                <span className="text-gray-500">Pages:</span>
                                <span className="ml-1 font-medium text-gray-700">{block.pages_count}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingTemplate(null);
                }}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
