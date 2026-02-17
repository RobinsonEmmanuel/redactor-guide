'use client';

import { useState, useEffect } from 'react';
import { 
  MagnifyingGlassIcon, 
  PlusIcon,
  MapPinIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

interface POI {
  _id?: string;
  poi_id: string;
  nom: string;
  type: string;
  article_source?: string;
  autres_articles_mentions?: string[];
  raison_selection?: string;
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
  cluster_id?: string | null;
  cluster_name?: string;
  place_instance_id?: string;
  matched_automatically?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  score?: number;
  origine?: 'wordpress' | 'manuel' | 'bibliotheque';
}

interface ClusterMetadata {
  cluster_id: string;
  cluster_name: string;
  place_count: number;
}

interface POIWithMatch {
  poi: POI;
  current_cluster_id: string | 'unassigned';
  place_instance_id?: string;
  suggested_match?: {
    place_instance: {
      place_instance_id: string;
      place_name: string;
      place_type: string;
      cluster_id: string;
      cluster_name: string;
    };
    score: number;
    confidence: 'high' | 'medium' | 'low';
  };
  matched_automatically: boolean;
}

interface LieuxEtClustersTabProps {
  guideId: string;
  apiUrl: string;
  guide?: any;
}

export default function LieuxEtClustersTab({ guideId, apiUrl, guide }: LieuxEtClustersTabProps) {
  // États POIs
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unassigned' | 'assigned'>('all');
  
  // États matching
  const [assignment, setAssignment] = useState<any>(null);
  const [clustersMetadata, setClustersMetadata] = useState<ClusterMetadata[]>([]);
  const [matching, setMatching] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set(['unassigned']));
  
  // États modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  
  // Formulaire manuel
  const [manualForm, setManualForm] = useState({
    nom: '',
    type: 'autre',
    lat: '',
    lon: '',
    article_source: '',
  });

  useEffect(() => {
    loadPois();
    loadMatching();
  }, [guideId]);

  const loadPois = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois`);
      if (res.ok) {
        const data = await res.json();
        setPois(data.pois || []);
      }
    } catch (err) {
      console.error('Erreur chargement POIs:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMatching = async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/matching`);
      if (res.ok) {
        const data = await res.json();
        if (data.assignment) {
          setAssignment(data.assignment);
          setClustersMetadata(data.clusters_metadata || []);
        }
      }
    } catch (err) {
      console.log('Aucun matching existant');
    }
  };

  const generatePoisFromArticles = async () => {
    setGenerating(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/generate`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
        setGenerating(false);
        return;
      }

      const data = await res.json();
      const jobId = data.jobId;

      // Polling
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await authFetch(
            `${apiUrl}/api/v1/guides/${guideId}/pois/job-status/${jobId}`
          );
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            
            if (statusData.status === 'completed') {
              clearInterval(pollInterval);
              setGenerating(false);
              await loadPois();
              alert('✅ Lieux générés avec succès !');
            } else if (statusData.status === 'failed') {
              clearInterval(pollInterval);
              setGenerating(false);
              alert(`❌ Erreur: ${statusData.error || 'Échec de la génération'}`);
            }
          }
        } catch (err) {
          console.error('Erreur polling:', err);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (generating) {
          setGenerating(false);
          alert('⏱️ Timeout - Veuillez vérifier manuellement');
        }
      }, 180000);
    } catch (err) {
      console.error('Erreur génération:', err);
      setGenerating(false);
    }
  };

  const launchMatching = async () => {
    setMatching(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/matching`, {
        method: 'POST',
      });

      if (res.ok) {
        const data = await res.json();
        setAssignment(data.assignment);
        setClustersMetadata(data.clusters_metadata || []);
        await loadPois();
        alert('✅ Matching terminé !');
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur matching:', err);
      alert('❌ Erreur lors du matching');
    } finally {
      setMatching(false);
    }
  };

  const createManualPOI = async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: manualForm.nom,
          type: manualForm.type,
          coordinates: manualForm.lat && manualForm.lon ? {
            lat: parseFloat(manualForm.lat),
            lon: parseFloat(manualForm.lon),
          } : undefined,
          article_source: manualForm.article_source || undefined,
          origine: 'manuel',
        }),
      });

      if (res.ok) {
        await loadPois();
        setShowManualModal(false);
        setManualForm({ nom: '', type: 'autre', lat: '', lon: '', article_source: '' });
        alert('✅ Lieu créé !');
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur création POI:', err);
      alert('❌ Erreur lors de la création');
    }
  };

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  };

  const getStatusBadge = (poi: POI) => {
    if (!poi.cluster_id) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <XCircleIcon className="w-3 h-3" />
          Non affecté
        </span>
      );
    }

    if (poi.matched_automatically) {
      const confidenceColor = poi.confidence === 'high' ? 'bg-green-100 text-green-700' :
                              poi.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-orange-100 text-orange-700';
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${confidenceColor}`}>
          <SparklesIcon className="w-3 h-3" />
          Auto {poi.score ? `${Math.round(poi.score * 100)}%` : ''}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        Manuel
      </span>
    );
  };

  const filteredPois = pois.filter(poi => {
    const matchesSearch = poi.nom.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' ||
                         (filterStatus === 'unassigned' && !poi.cluster_id) ||
                         (filterStatus === 'assigned' && poi.cluster_id);
    return matchesSearch && matchesFilter;
  });

  const unassignedPois = filteredPois.filter(p => !p.cluster_id);
  const assignedPois = filteredPois.filter(p => p.cluster_id);

  const poisByCluster: Record<string, POI[]> = {};
  assignedPois.forEach(poi => {
    const clusterId = poi.cluster_id!;
    if (!poisByCluster[clusterId]) {
      poisByCluster[clusterId] = [];
    }
    poisByCluster[clusterId].push(poi);
  });

  const stats = {
    total: pois.length,
    assigned: assignedPois.length,
    unassigned: unassignedPois.length,
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">📍 Lieux et Clusters</h2>
        
        {/* Boutons d'action */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={generatePoisFromArticles}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            {generating ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <SparklesIcon className="w-4 h-4" />
                1. Générer les lieux
              </>
            )}
          </button>

          <button
            onClick={launchMatching}
            disabled={matching || pois.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            {matching ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Matching...
              </>
            ) : (
              <>
                <ArrowPathIcon className="w-4 h-4" />
                2. Lancer le matching
              </>
            )}
          </button>

          <div className="ml-auto text-sm text-gray-600">
            {stats.assigned}/{stats.total} affectés • {stats.unassigned} non affectés
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Partie gauche : Liste des POIs */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col bg-white">
          {/* Header liste */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Liste des lieux ({filteredPois.length})</h3>
              
              <button
                onClick={() => setShowManualModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <PlusIcon className="w-4 h-4" />
                Ajouter
              </button>
            </div>

            {/* Recherche */}
            <div className="relative mb-3">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un lieu..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Filtres */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Tous
              </button>
              <button
                onClick={() => setFilterStatus('unassigned')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === 'unassigned'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Non affectés ({unassignedPois.length})
              </button>
              <button
                onClick={() => setFilterStatus('assigned')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === 'assigned'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Affectés ({assignedPois.length})
              </button>
            </div>
          </div>

          {/* Liste scrollable */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading && (
              <div className="text-center py-8 text-gray-500">
                <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                Chargement...
              </div>
            )}

            {!loading && filteredPois.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <MapPinIcon className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p className="font-medium">Aucun lieu</p>
                <p className="text-sm">Générez les lieux depuis WordPress</p>
              </div>
            )}

            {!loading && filteredPois.map((poi) => (
              <button
                key={poi.poi_id}
                onClick={() => {
                  setSelectedPOI(poi);
                  setShowDetailPanel(true);
                }}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all"
              >
                <div className="flex items-start gap-2">
                  <MapPinIcon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 mb-1">{poi.nom}</div>
                    <div className="text-xs text-gray-500 mb-2">{poi.type}</div>
                    {getStatusBadge(poi)}
                    {poi.cluster_name && (
                      <div className="text-xs text-gray-600 mt-1">
                        → {poi.cluster_name}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Partie droite : Vue par cluster */}
        <div className="w-1/2 flex flex-col bg-gray-50">
          <div className="p-4 border-b border-gray-200 bg-white">
            <h3 className="font-semibold text-gray-900">Répartition par cluster</h3>
            <p className="text-xs text-gray-500 mt-1">{clustersMetadata.length} clusters</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Section Non affectés */}
            {unassignedPois.length > 0 && (
              <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleCluster('unassigned')}
                  className="w-full px-4 py-3 flex items-center justify-between bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <XCircleIcon className="w-5 h-5 text-red-600" />
                    <span className="font-semibold text-gray-900">Non affectés</span>
                    <span className="px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">
                      {unassignedPois.length}
                    </span>
                  </div>
                  {expandedClusters.has('unassigned') ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                  )}
                </button>

                {expandedClusters.has('unassigned') && (
                  <div className="p-3 space-y-1">
                    {unassignedPois.map((poi) => (
                      <div
                        key={poi.poi_id}
                        className="text-sm text-gray-700 py-1 px-2 hover:bg-gray-50 rounded cursor-pointer"
                        onClick={() => {
                          setSelectedPOI(poi);
                          setShowDetailPanel(true);
                        }}
                      >
                        • {poi.nom}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sections par cluster */}
            {clustersMetadata.map((cluster) => {
              const clusterPois = poisByCluster[cluster.cluster_id] || [];
              if (clusterPois.length === 0) return null;

              return (
                <div key={cluster.cluster_id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleCluster(cluster.cluster_id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="w-5 h-5 text-blue-600" />
                      <span className="font-semibold text-gray-900">{cluster.cluster_name}</span>
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
                        {clusterPois.length}
                      </span>
                    </div>
                    {expandedClusters.has(cluster.cluster_id) ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                    )}
                  </button>

                  {expandedClusters.has(cluster.cluster_id) && (
                    <div className="p-3 space-y-1">
                      {clusterPois.map((poi) => (
                        <div
                          key={poi.poi_id}
                          className="text-sm text-gray-700 py-1 px-2 hover:bg-gray-50 rounded cursor-pointer flex items-center justify-between"
                          onClick={() => {
                            setSelectedPOI(poi);
                            setShowDetailPanel(true);
                          }}
                        >
                          <span>• {poi.nom}</span>
                          {poi.matched_automatically && poi.score && (
                            <span className="text-xs text-gray-500">
                              {Math.round(poi.score * 100)}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {pois.length > 0 && clustersMetadata.length === 0 && unassignedPois.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p className="font-medium">Aucun cluster</p>
                <p className="text-sm">Lancez le matching automatique</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal création manuelle */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Créer un lieu</h2>
              <button
                onClick={() => setShowManualModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <span className="text-xl">×</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom du lieu *
                </label>
                <input
                  type="text"
                  value={manualForm.nom}
                  onChange={(e) => setManualForm({ ...manualForm, nom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ex: Mirador de la Esperanza"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type *
                </label>
                <select
                  value={manualForm.type}
                  onChange={(e) => setManualForm({ ...manualForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="autre">Autre</option>
                  <option value="musee">Musée</option>
                  <option value="plage">Plage</option>
                  <option value="parc">Parc</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="hotel">Hôtel</option>
                  <option value="point_de_vue">Point de vue</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Latitude
                  </label>
                  <input
                    type="text"
                    value={manualForm.lat}
                    onChange={(e) => setManualForm({ ...manualForm, lat: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="28.xxxxx"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Longitude
                  </label>
                  <input
                    type="text"
                    value={manualForm.lon}
                    onChange={(e) => setManualForm({ ...manualForm, lon: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="-16.xxxxx"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Article source (optionnel)
                </label>
                <input
                  type="text"
                  value={manualForm.article_source}
                  onChange={(e) => setManualForm({ ...manualForm, article_source: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="/tenerife/mirador-esperanza"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setShowManualModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={createManualPOI}
                disabled={!manualForm.nom}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
