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
                              /* TODO: Éditer */
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
                                /* TODO: Supprimer */
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
    </div>
  );
}
