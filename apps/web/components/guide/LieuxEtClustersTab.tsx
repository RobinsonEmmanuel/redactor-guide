'use client';

import { useState, useEffect } from 'react';
import { 
  MagnifyingGlassIcon, 
  PlusIcon,
  MapPinIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XCircleIcon,
  ArrowPathIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDraggable, useDroppable } from '@dnd-kit/core';
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

interface LieuxEtClustersTabProps {
  guideId: string;
  apiUrl: string;
  guide?: any;
}

// Composant POI draggable
function DraggablePOI({ poi }: { poi: POI }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: poi.poi_id,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const getStatusBadge = () => {
    if (!poi.cluster_id) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
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
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${confidenceColor}`}>
          <SparklesIcon className="w-3 h-3" />
          {poi.score ? `${Math.round(poi.score * 100)}%` : 'Auto'}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
        Manuel
      </span>
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="bg-white p-2 rounded border border-gray-200 hover:border-blue-400 cursor-move transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{poi.nom}</div>
          <div className="text-xs text-gray-500">{poi.type}</div>
          {poi.cluster_name && (
            <div className="text-xs text-blue-600 mt-0.5">📍 {poi.cluster_name}</div>
          )}
        </div>
        {getStatusBadge()}
      </div>
    </div>
  );
}

// Composant Cluster droppable
function DroppableCluster({ 
  cluster, 
  pois, 
  isExpanded, 
  onToggle,
  onDelete,
}: { 
  cluster: ClusterMetadata | 'unassigned'; 
  pois: POI[];
  isExpanded: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const clusterId = cluster === 'unassigned' ? 'unassigned' : cluster.cluster_id;
  const clusterName = cluster === 'unassigned' ? 'Non affectés' : cluster.cluster_name;
  const isUnassigned = cluster === 'unassigned';

  const { setNodeRef, isOver } = useDroppable({
    id: clusterId,
  });

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border rounded overflow-hidden transition-all ${
        isUnassigned ? 'border-red-200' : 'border-gray-200'
      } ${
        isOver ? 'ring-2 ring-blue-500 border-blue-500' : ''
      }`}
    >
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className={`flex-1 px-3 py-2 flex items-center justify-between transition-colors ${
            isUnassigned ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2">
            {isUnassigned ? (
              <XCircleIcon className="w-4 h-4 text-red-600" />
            ) : (
              <MapPinIcon className="w-4 h-4 text-blue-600" />
            )}
            <span className="text-sm font-semibold text-gray-900">{clusterName}</span>
            <span className={`px-1.5 py-0.5 text-xs rounded-full ${
              isUnassigned ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}>
              {pois.length}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUpIcon className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-gray-500" />
          )}
        </button>
        
        {/* Bouton supprimer (uniquement pour les clusters non "unassigned") */}
        {!isUnassigned && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="px-3 py-2 text-red-500 hover:bg-red-50 transition-colors border-l border-gray-200"
            title="Supprimer le cluster"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="p-2 space-y-0.5 max-h-64 overflow-y-auto">
          {pois.length === 0 ? (
            <div className="text-center py-4 text-xs text-gray-400">
              Glissez-déposez des lieux ici
            </div>
          ) : (
            pois.map((poi) => (
              <div
                key={poi.poi_id}
                className="text-xs text-gray-700 py-1 px-2 hover:bg-gray-50 rounded"
              >
                <div className="flex items-center justify-between">
                  <span>• {poi.nom}</span>
                  {poi.matched_automatically && poi.score && (
                    <span className="text-xs text-gray-500">
                      {Math.round(poi.score * 100)}%
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function LieuxEtClustersTab({ guideId, apiUrl, guide }: LieuxEtClustersTabProps) {
  // États POIs
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unassigned' | string>('all');
  
  // États matching
  const [clustersMetadata, setClustersMetadata] = useState<ClusterMetadata[]>([]);
  const [matching, setMatching] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  
  // États drag & drop
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  
  // États modals
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showClusterModal, setShowClusterModal] = useState(false);
  
  // États bibliothèque
  const [libraryPois, setLibraryPois] = useState<Record<string, any[]>>({});
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [librarySearchTerm, setLibrarySearchTerm] = useState('');
  
  const [manualForm, setManualForm] = useState({
    nom: '',
    type: 'autre',
    lat: '',
    lon: '',
    article_source: '',
  });

  const [clusterForm, setClusterForm] = useState({
    cluster_name: '',
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
          setClustersMetadata(data.clusters_metadata || []);
        }
      }
    } catch (err) {
      console.error('Erreur chargement matching:', err);
    }
  };

  const generatePoisFromArticles = async () => {
    setGenerating(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/generate`, {
        method: 'POST',
      });

      if (res.ok) {
        const pollInterval = setInterval(async () => {
          const checkRes = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/generation/status`);
          if (checkRes.ok) {
            const status = await checkRes.json();
            if (status.status === 'completed') {
              clearInterval(pollInterval);
              await loadPois();
              setGenerating(false);
              alert('✅ Génération terminée !');
            } else if (status.status === 'failed') {
              clearInterval(pollInterval);
              setGenerating(false);
              alert('❌ Erreur lors de la génération');
            }
          }
        }, 3000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setGenerating(false);
          alert('⏱️ Timeout - Veuillez vérifier manuellement');
        }, 180000);
      }
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

  const loadLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/library`);
      if (res.ok) {
        const data = await res.json();
        setLibraryPois(data.clusters || {});
      } else {
        alert('❌ Erreur lors du chargement de la bibliothèque');
      }
    } catch (err) {
      console.error('Erreur chargement bibliothèque:', err);
      alert('❌ Erreur lors du chargement');
    } finally {
      setLoadingLibrary(false);
    }
  };

  const addFromLibrary = async (libraryPoi: any) => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: libraryPoi.nom,
          type: libraryPoi.type,
          coordinates: libraryPoi.coordinates,
          region_lovers_id: libraryPoi.region_lovers_id,
          cluster_id: libraryPoi.cluster_id !== 'non_affecte' ? libraryPoi.cluster_id : null,
          cluster_name: libraryPoi.cluster_name !== 'Non affecté' ? libraryPoi.cluster_name : null,
          origine: 'bibliotheque',
        }),
      });

      if (res.ok) {
        await loadPois();
        alert('✅ Lieu ajouté depuis la bibliothèque !');
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur ajout depuis bibliothèque:', err);
      alert('❌ Erreur lors de l\'ajout');
    }
  };

  const createCluster = async () => {
    if (!clusterForm.cluster_name.trim()) {
      alert('⚠️ Veuillez saisir un nom de cluster');
      return;
    }

    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster_name: clusterForm.cluster_name.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Ajouter le nouveau cluster à la liste
        setClustersMetadata([...clustersMetadata, data.cluster]);
        setShowClusterModal(false);
        setClusterForm({ cluster_name: '' });
        alert('✅ Cluster créé !');
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur création cluster:', err);
      alert('❌ Erreur lors de la création');
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const poiId = active.id as string;
    const targetClusterId = over.id as string;

    const poi = pois.find(p => p.poi_id === poiId);
    if (!poi) return;

    if (poi.cluster_id === targetClusterId) return;

    const targetCluster = clustersMetadata.find(c => c.cluster_id === targetClusterId);
    const clusterName = targetClusterId === 'unassigned' ? null : (targetCluster?.cluster_name || null);

    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/${poiId}/cluster`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster_id: targetClusterId === 'unassigned' ? null : targetClusterId,
          cluster_name: clusterName,
        }),
      });

      if (res.ok) {
        await loadPois();
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur réaffectation:', err);
      alert('❌ Erreur lors de la réaffectation');
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

  const deleteCluster = async (clusterId: string, clusterName: string) => {
    const affectedPois = pois.filter(p => p.cluster_id === clusterId);
    
    if (!confirm(
      `Voulez-vous vraiment supprimer le cluster "${clusterName}" ?\n\n` +
      `${affectedPois.length} POI(s) seront déplacés vers "Non affectés".`
    )) {
      return;
    }

    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/clusters/${clusterId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // Recharger les POIs et les clusters
        await Promise.all([loadPois(), loadMatching()]);
        
        // Retirer le cluster de la liste expanded s'il y était
        setExpandedClusters(prev => {
          const next = new Set(prev);
          next.delete(clusterId);
          return next;
        });
        
        alert(`✅ Cluster "${clusterName}" supprimé. ${affectedPois.length} POI(s) déplacé(s) vers "Non affectés".`);
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur suppression cluster:', err);
      alert('❌ Erreur lors de la suppression');
    }
  };

  // Filtrage pour la colonne de gauche
  const filteredPois = pois.filter(poi => {
    const matchesSearch = poi.nom.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (filterMode === 'all') return matchesSearch;
    if (filterMode === 'unassigned') return matchesSearch && !poi.cluster_id;
    return matchesSearch && poi.cluster_id === filterMode;
  });

  // Groupement pour la colonne de droite
  const unassignedPois = pois.filter(p => !p.cluster_id);
  const assignedPois = pois.filter(p => p.cluster_id);

  const poisByCluster: Record<string, POI[]> = {};
  assignedPois.forEach(poi => {
    const clusterId = poi.cluster_id!;
    if (!poisByCluster[clusterId]) {
      poisByCluster[clusterId] = [];
    }
    poisByCluster[clusterId].push(poi);
  });

  // Construire displayClusters et filtrer pour ne garder que ceux avec des POIs
  const displayClusters: ClusterMetadata[] = clustersMetadata.filter(
    cluster => (poisByCluster[cluster.cluster_id] || []).length > 0
  );

  const stats = {
    total: pois.length,
    assigned: assignedPois.length,
    unassigned: unassignedPois.length,
  };

  const activePoi = activeDragId ? pois.find(p => p.poi_id === activeDragId) : null;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header compact */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={generatePoisFromArticles}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {generating ? (
                <>
                  <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                  Génération...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-3.5 h-3.5" />
                  1. Générer
                </>
              )}
            </button>

            <button
              onClick={launchMatching}
              disabled={matching || pois.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {matching ? (
                <>
                  <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                  Matching...
                </>
              ) : (
                <>
                  <ArrowPathIcon className="w-3.5 h-3.5" />
                  2. Matching
                </>
              )}
            </button>

            <div className="ml-auto text-xs text-gray-600">
              {stats.assigned}/{stats.total} affectés • {stats.unassigned} non affectés
            </div>
          </div>
        </div>

        {/* Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Colonne gauche : Liste TOUS les POIs */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col bg-white">
            {/* Header */}
            <div className="p-3 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-gray-900">Lieux ({filteredPois.length})</div>
                
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Ajouter
                    <ChevronDownIcon className="w-3 h-3" />
                  </button>
                  
                  {showAddMenu && (
                    <>
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setShowAddMenu(false)}
                      />
                      <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                        <button
                          onClick={() => {
                            setShowAddMenu(false);
                            setShowManualModal(true);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2"
                        >
                          <PlusIcon className="w-3.5 h-3.5 text-gray-600" />
                          <span>Créer un lieu vierge</span>
                        </button>
                        <button
                          onClick={() => {
                            setShowAddMenu(false);
                            setShowLibraryModal(true);
                            loadLibrary();
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors border-t border-gray-100 flex items-center gap-2"
                        >
                          <MapPinIcon className="w-3.5 h-3.5 text-gray-600" />
                          <span>Depuis la bibliothèque RL</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Recherche */}
              <div className="relative mb-2">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Filtre déroulant */}
              <div>
                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="all">Tous ({pois.length})</option>
                  <option value="unassigned">Non affectés ({unassignedPois.length})</option>
                  {displayClusters.map(cluster => (
                    <option key={cluster.cluster_id} value={cluster.cluster_id}>
                      {cluster.cluster_name} ({(poisByCluster[cluster.cluster_id] || []).length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Liste scrollable des POIs */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {loading && (
                <div className="text-center py-6 text-gray-500">
                  <ArrowPathIcon className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-xs">Chargement...</p>
                </div>
              )}

              {!loading && filteredPois.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <MapPinIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm font-medium">Aucun lieu</p>
                  {pois.length === 0 && <p className="text-xs">Cliquez sur "1. Générer"</p>}
                </div>
              )}

              {!loading && filteredPois.map((poi) => (
                <DraggablePOI key={poi.poi_id} poi={poi} />
              ))}
            </div>
          </div>

          {/* Colonne droite : TOUS les Clusters */}
          <div className="w-1/2 flex flex-col bg-gray-50">
            <div className="p-3 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">Clusters ({displayClusters.length + 1})</div>
                
                <button
                  onClick={() => setShowClusterModal(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Ajouter
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* Cluster Non affectés */}
              <DroppableCluster
                cluster="unassigned"
                pois={unassignedPois}
                isExpanded={expandedClusters.has('unassigned')}
                onToggle={() => toggleCluster('unassigned')}
              />

              {/* Clusters Region Lovers */}
              {displayClusters.map((cluster) => (
                <DroppableCluster
                  key={cluster.cluster_id}
                  cluster={cluster}
                  pois={poisByCluster[cluster.cluster_id] || []}
                  isExpanded={expandedClusters.has(cluster.cluster_id)}
                  onToggle={() => toggleCluster(cluster.cluster_id)}
                  onDelete={() => deleteCluster(cluster.cluster_id, cluster.cluster_name)}
                />
              ))}

              {pois.length > 0 && displayClusters.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <p className="text-sm font-medium">Aucun cluster</p>
                  <p className="text-xs">Cliquez sur "2. Matching"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activePoi ? (
          <div className="bg-white p-2 rounded border-2 border-blue-500 shadow-lg">
            <div className="text-sm font-medium text-gray-900">{activePoi.nom}</div>
            <div className="text-xs text-gray-500">{activePoi.type}</div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Modal création manuelle */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-md">
            <h3 className="text-base font-semibold mb-3">Ajouter un lieu manuellement</h3>
            
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Nom *</label>
                <input
                  type="text"
                  value={manualForm.nom}
                  onChange={(e) => setManualForm({ ...manualForm, nom: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="Ex: Tour Eiffel"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Type</label>
                <select
                  value={manualForm.type}
                  onChange={(e) => setManualForm({ ...manualForm, type: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="ville">Ville</option>
                  <option value="plage">Plage</option>
                  <option value="parc">Parc</option>
                  <option value="monument">Monument</option>
                  <option value="musee">Musée</option>
                  <option value="autre">Autre</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">Latitude</label>
                  <input
                    type="text"
                    value={manualForm.lat}
                    onChange={(e) => setManualForm({ ...manualForm, lat: e.target.value })}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="Ex: 48.8584"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">Longitude</label>
                  <input
                    type="text"
                    value={manualForm.lon}
                    onChange={(e) => setManualForm({ ...manualForm, lon: e.target.value })}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="Ex: 2.2945"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">URL article source</label>
                <input
                  type="text"
                  value={manualForm.article_source}
                  onChange={(e) => setManualForm({ ...manualForm, article_source: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="Ex: /que-faire-paris/"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowManualModal(false)}
                className="flex-1 px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={createManualPOI}
                disabled={!manualForm.nom}
                className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal bibliothèque Region Lovers */}
      {showLibraryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">Bibliothèque Region Lovers</h3>
              <button
                onClick={() => setShowLibraryModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircleIcon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Recherche */}
            <div className="relative mb-3">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un lieu..."
                value={librarySearchTerm}
                onChange={(e) => setLibrarySearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Liste des POIs par cluster */}
            <div className="flex-1 overflow-y-auto space-y-3">
              {loadingLibrary ? (
                <div className="text-center py-8 text-gray-500">
                  <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Chargement de la bibliothèque...</p>
                </div>
              ) : (
                Object.keys(libraryPois).map((clusterId) => {
                  const clusterPois = libraryPois[clusterId].filter(poi =>
                    poi.nom.toLowerCase().includes(librarySearchTerm.toLowerCase())
                  );

                  if (clusterPois.length === 0) return null;

                  return (
                    <div key={clusterId} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <MapPinIcon className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-semibold text-gray-900">
                            {clusterPois[0]?.cluster_name || 'Sans nom'}
                          </span>
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
                            {clusterPois.length}
                          </span>
                        </div>
                      </div>

                      <div className="p-2 space-y-1">
                        {clusterPois.map((poi: any, index: number) => (
                          <div
                            key={`${poi.region_lovers_id}-${index}`}
                            className="flex items-center justify-between p-2 hover:bg-gray-50 rounded transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {poi.nom}
                              </div>
                              <div className="text-xs text-gray-500">{poi.type}</div>
                            </div>
                            <button
                              onClick={() => addFromLibrary(poi)}
                              className="ml-2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            >
                              Ajouter
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {!loadingLibrary && Object.keys(libraryPois).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <MapPinIcon className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm font-medium">Aucun lieu dans la bibliothèque</p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200">
              <button
                onClick={() => setShowLibraryModal(false)}
                className="w-full px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm font-medium"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal création de cluster */}
      {showClusterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-md">
            <h3 className="text-base font-semibold mb-3">Créer un nouveau cluster</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Nom du cluster *</label>
                <input
                  type="text"
                  value={clusterForm.cluster_name}
                  onChange={(e) => setClusterForm({ cluster_name: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="Ex: Nord de l'île"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  Ce cluster pourra recevoir des POIs par glisser-déposer
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowClusterModal(false);
                  setClusterForm({ cluster_name: '' });
                }}
                className="flex-1 px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={createCluster}
                disabled={!clusterForm.cluster_name.trim()}
                className="flex-1 px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
