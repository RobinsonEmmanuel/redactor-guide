'use client';

import { useState, useEffect } from 'react';
import { 
  DndContext, 
  DragOverlay, 
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent
} from '@dnd-kit/core';
import { MapPinIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface POI {
  poi_id: string;
  nom: string;
  type: string;
  article_source: string;
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
}

interface POIWithMatch {
  poi: POI;
  current_cluster_id: string | 'unassigned';
  suggested_cluster?: {
    cluster: {
      _id: string;
      place_name: string;
      place_type: string;
    };
    score: number;
    confidence: 'high' | 'medium' | 'low';
  };
  matched_automatically: boolean;
}

interface ClusterMetadata {
  cluster_id: string;
  place_name: string;
  place_type: string;
}

interface ClusterAssignment {
  unassigned: POIWithMatch[];
  clusters: Record<string, POIWithMatch[]>;
}

interface MatchingClusterTabProps {
  guideId: string;
  apiUrl: string;
  guide?: any;
}

export default function MatchingClusterTab({ guideId, apiUrl, guide }: MatchingClusterTabProps) {
  const [assignment, setAssignment] = useState<ClusterAssignment | null>(null);
  const [clustersMetadata, setClustersMetadata] = useState<ClusterMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeDragPOI, setActiveDragPOI] = useState<POIWithMatch | null>(null);
  const [stats, setStats] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Charger l'état existant au montage
  useEffect(() => {
    loadExistingMatching();
  }, [guideId]);

  const loadExistingMatching = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/matching`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setAssignment(data.assignment);
        setClustersMetadata(data.clusters_metadata || []);
        setStats(data.stats);
      }
    } catch (error) {
      console.log('Aucun matching existant');
    }
  };

  const generateMatching = async () => {
    // Vérifier que destination_rl_id est configuré
    if (!guide?.destination_rl_id) {
      alert('⚠️ Configuration manquante\n\nVeuillez renseigner l\'ID Region Lovers (destination_rl_id) dans les paramètres du guide avant de générer le matching.');
      return;
    }

    setLoading(true);
    try {
      console.log('🎯 Génération du matching...');
      
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/matching/generate`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        const errorMessage = errorData.message || errorData.details || errorData.error;
        alert(`❌ Erreur: ${errorData.error}\n\n${errorMessage}`);
        console.error('Détails erreur:', errorData);
        return;
      }

      const data = await res.json();
      setAssignment(data.assignment);
      setClustersMetadata(data.clusters_metadata || []);
      setStats(data.stats);
      
      console.log('✅ Matching généré');
    } catch (error: any) {
      console.error('❌ Erreur génération:', error);
      alert(`Erreur lors de la génération: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const saveMatching = async () => {
    if (!assignment) return;

    setSaving(true);
    try {
      console.log('💾 Sauvegarde du matching...');
      
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/matching/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assignment }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(`Erreur: ${errorData.error}`);
        return;
      }

      const data = await res.json();
      setStats(data.stats);
      
      console.log('✅ Matching sauvegardé');
      alert('✅ Clusterisation sauvegardée avec succès !');
    } catch (error: any) {
      console.error('❌ Erreur sauvegarde:', error);
      alert(`Erreur lors de la sauvegarde: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const [sourceClusterId, poiId] = (active.id as string).split('::');
    
    // Trouver le POI
    let poi: POIWithMatch | undefined;
    if (sourceClusterId === 'unassigned') {
      poi = assignment?.unassigned.find(p => p.poi.poi_id === poiId);
    } else {
      poi = assignment?.clusters[sourceClusterId]?.find(p => p.poi.poi_id === poiId);
    }
    
    setActiveDragPOI(poi || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragPOI(null);

    if (!over || !assignment) return;

    const [sourceClusterId, poiId] = (active.id as string).split('::');
    const targetClusterId = over.id as string;

    if (sourceClusterId === targetClusterId) return;

    console.log(`🔄 Déplacement POI ${poiId}: ${sourceClusterId} → ${targetClusterId}`);

    setAssignment(prev => {
      if (!prev) return prev;

      // Trouver le POI dans le cluster source
      let poi: POIWithMatch | undefined;
      let sourcePOIs: POIWithMatch[];

      if (sourceClusterId === 'unassigned') {
        sourcePOIs = prev.unassigned.filter(p => p.poi.poi_id !== poiId);
        poi = prev.unassigned.find(p => p.poi.poi_id === poiId);
      } else {
        sourcePOIs = prev.clusters[sourceClusterId]?.filter(p => p.poi.poi_id !== poiId) || [];
        poi = prev.clusters[sourceClusterId]?.find(p => p.poi.poi_id === poiId);
      }

      if (!poi) return prev;

      // Mettre à jour le POI
      const updatedPOI: POIWithMatch = {
        ...poi,
        current_cluster_id: targetClusterId,
        matched_automatically: false, // Devient manuel
      };

      // Ajouter au cluster cible
      let targetPOIs: POIWithMatch[];
      if (targetClusterId === 'unassigned') {
        targetPOIs = [...prev.unassigned, updatedPOI];
      } else {
        targetPOIs = [...(prev.clusters[targetClusterId] || []), updatedPOI];
      }

      // Construire le nouvel état
      const newAssignment: ClusterAssignment = {
        unassigned: sourceClusterId === 'unassigned' ? sourcePOIs : 
                     targetClusterId === 'unassigned' ? targetPOIs : prev.unassigned,
        clusters: { ...prev.clusters },
      };

      if (sourceClusterId !== 'unassigned') {
        newAssignment.clusters[sourceClusterId] = sourcePOIs;
      }
      if (targetClusterId !== 'unassigned') {
        newAssignment.clusters[targetClusterId] = targetPOIs;
      }

      return newAssignment;
    });
  };

  if (!assignment) {
    // Vérifier si destination_rl_id est configuré
    const isConfigured = guide?.destination_rl_id;

    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-md">
          <MapPinIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Matching Cluster
          </h3>
          <p className="text-gray-600 mb-6">
            Générez les lieux détectés dans vos articles et affectez-les aux clusters Region Lovers
          </p>

          {!isConfigured && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm font-medium mb-2">
                ⚠️ Configuration requise
              </p>
              <p className="text-yellow-700 text-xs">
                Veuillez renseigner l'ID Region Lovers (destination_rl_id) dans les paramètres du guide
              </p>
            </div>
          )}

          <button
            onClick={generateMatching}
            disabled={loading || !isConfigured}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 mx-auto"
          >
            {loading && (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            📍 Générer les POIs
          </button>
        </div>
      </div>
    );
  }

  const totalPOIs = assignment.unassigned.length + 
    Object.values(assignment.clusters).reduce((sum, pois) => sum + pois.length, 0);
  const assignedPOIs = totalPOIs - assignment.unassigned.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header avec actions */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Matching Cluster</h2>
            <p className="text-sm text-gray-500 mt-1">
              Glissez-déposez les POIs dans les clusters appropriés
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">
              📊 Progression: <span className="font-semibold">{assignedPOIs}/{totalPOIs}</span> POIs affectés
            </div>
            <button
              onClick={saveMatching}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              💾 Enregistrer
            </button>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="h-full flex gap-4 p-6 min-w-max">
            {/* Colonne Non affectés */}
            <ClusterColumn
              clusterId="unassigned"
              clusterName="❓ Non affectés"
              pois={assignment.unassigned}
              count={assignment.unassigned.length}
            />

            {/* Colonnes Clusters */}
            {clustersMetadata.map(cluster => (
              <ClusterColumn
                key={cluster.cluster_id}
                clusterId={cluster.cluster_id}
                clusterName={cluster.place_name}
                pois={assignment.clusters[cluster.cluster_id] || []}
                count={(assignment.clusters[cluster.cluster_id] || []).length}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeDragPOI && (
            <POICard poi={activeDragPOI} isDragging />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/**
 * Colonne de cluster (droppable)
 */
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';

function ClusterColumn({ clusterId, clusterName, pois, count }: {
  clusterId: string;
  clusterName: string;
  pois: POIWithMatch[];
  count: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: clusterId,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-80 bg-gray-50 rounded-lg border-2 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">{clusterName}</h3>
          <span className="bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-xs font-medium">
            {count}
          </span>
        </div>
      </div>

      {/* Liste des POIs */}
      <div className="p-3 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
        {pois.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            Glissez des POIs ici →
          </div>
        )}
        {pois.map(poiWithMatch => (
          <POICard
            key={poiWithMatch.poi.poi_id}
            poi={poiWithMatch}
            clusterId={clusterId}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Carte POI (draggable)
 */
function POICard({ poi, clusterId, isDragging }: {
  poi: POIWithMatch;
  clusterId?: string;
  isDragging?: boolean;
}) {
  const dragId = `${poi.current_cluster_id}::${poi.poi.poi_id}`;
  
  const { attributes, listeners, setNodeRef, isDragging: isDrag } = useDraggable({
    id: dragId,
    data: { poi, clusterId },
  });

  const getScoreBadge = () => {
    if (!poi.suggested_cluster) return null;

    const { score, confidence } = poi.suggested_cluster;
    const percentage = Math.round(score * 100);

    const badgeClass = {
      high: 'bg-green-100 text-green-700',
      medium: 'bg-yellow-100 text-yellow-700',
      low: 'bg-orange-100 text-orange-700',
    }[confidence];

    const icon = {
      high: <CheckCircleIcon className="w-3 h-3" />,
      medium: <ExclamationTriangleIcon className="w-3 h-3" />,
      low: <XCircleIcon className="w-3 h-3" />,
    }[confidence];

    return (
      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
        {icon}
        {percentage}%
        {poi.matched_automatically && ' (Auto)'}
      </div>
    );
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`bg-white border-2 border-gray-200 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${
        isDrag || isDragging ? 'opacity-50 scale-95' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <MapPinIcon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 text-sm line-clamp-2">
            {poi.poi.nom}
          </h4>
          {poi.poi.coordinates && (
            <p className="text-[10px] text-gray-400 font-mono mt-1">
              📍 {poi.poi.coordinates.lat.toFixed(5)}, {poi.poi.coordinates.lon.toFixed(5)}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            🏷️ {poi.poi.type}
          </p>
          {getScoreBadge() && (
            <div className="mt-2">
              {getScoreBadge()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
