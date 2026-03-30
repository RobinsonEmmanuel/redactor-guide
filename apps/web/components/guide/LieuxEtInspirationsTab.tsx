'use client';

import { useState, useEffect } from 'react';
import { 
  MagnifyingGlassIcon,
  MapPinIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LightBulbIcon,
  ArrowPathIcon,
  SparklesIcon,
  PlusIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { authFetch } from '@/lib/api-client';

interface POI {
  _id?: string;
  poi_id: string;
  nom: string;
  type: string;
  cluster_name?: string;
  url_source?: string;
}

interface Inspiration {
  theme_id: string;
  titre: string;
  angle_editorial: string;
  lieux_associes: string[]; // POI IDs
}

interface LieuxEtInspirationsTabProps {
  guideId: string;
  apiUrl: string;
}

// Composant POI draggable
function DraggablePOI({ poi, inspirationsCount, apiUrl, guideId }: { poi: POI; inspirationsCount: number; apiUrl: string; guideId: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: poi.poi_id,
  });
  const [openingArticle, setOpeningArticle] = useState(false);

  const handleOpenArticle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!poi.url_source) return;
    if (poi.url_source.startsWith('http')) { window.open(poi.url_source, '_blank', 'noopener'); return; }
    setOpeningArticle(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles?slug=${encodeURIComponent(poi.url_source)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const article = Array.isArray(data) ? data[0] : data.articles?.[0] ?? data;
        const url = article?.urls_by_lang?.fr || article?.urls_by_lang?.en;
        if (url) window.open(url, '_blank', 'noopener');
      }
    } finally { setOpeningArticle(false); }
  };

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

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
        <div className="flex items-center gap-1 flex-shrink-0">
          {inspirationsCount > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
              <LightBulbIcon className="w-3 h-3" />
              {inspirationsCount}
            </span>
          )}
          {poi.url_source && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleOpenArticle}
              disabled={openingArticle}
              title="Ouvrir l'article source"
              className="text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Composant Inspiration droppable
function DroppableInspiration({ 
  inspiration, 
  pois, 
  isExpanded, 
  onToggle,
  onRemovePOI,
  onEdit,
  onDelete,
}: { 
  inspiration: Inspiration;
  pois: POI[];
  isExpanded: boolean;
  onToggle: () => void;
  onRemovePOI: (poiId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: inspiration.theme_id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border rounded overflow-hidden transition-all ${
        isOver ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-200'
      }`}
    >
      <div className="w-full px-2 py-2 flex items-center gap-1 hover:bg-gray-50 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left rounded px-1 py-0.5 -mx-1"
        >
          <LightBulbIcon className="w-4 h-4 text-purple-600 flex-shrink-0" />
          <div className="text-left flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{inspiration.titre}</div>
            <div className="text-xs text-gray-500 truncate">{inspiration.angle_editorial}</div>
          </div>
          <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full flex-shrink-0">
            {pois.length}
          </span>
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Modifier titre et angle éditorial"
            className="p-1.5 rounded text-gray-500 hover:text-purple-700 hover:bg-purple-50 transition-colors"
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Supprimer cette inspiration"
            className="p-1.5 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 text-gray-500 hover:bg-gray-100 rounded flex-shrink-0"
          aria-label={isExpanded ? 'Replier' : 'Déplier'}
        >
          {isExpanded ? (
            <ChevronUpIcon className="w-4 h-4" />
          ) : (
            <ChevronDownIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="p-2 space-y-0.5 max-h-64 overflow-y-auto border-t border-gray-100">
          {pois.length === 0 ? (
            <div className="text-center py-4 text-xs text-gray-400">
              Glissez-déposez des lieux ici
            </div>
          ) : (
            pois.map((poi) => (
              <div
                key={poi.poi_id}
                className="text-xs text-gray-700 py-1 px-2 hover:bg-gray-50 rounded flex items-center justify-between"
              >
                <span className="flex-1">• {poi.nom}</span>
                <button
                  onClick={() => onRemovePOI(poi.poi_id)}
                  className="ml-2 text-red-500 hover:text-red-700 text-xs"
                  title="Retirer"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function LieuxEtInspirationsTab({ guideId, apiUrl }: LieuxEtInspirationsTabProps) {
  // États POIs
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // États inspirations
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [generating, setGenerating] = useState(false);
  const [expandedInspirations, setExpandedInspirations] = useState<Set<string>>(new Set());
  
  // États drag & drop
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // États modal création / édition inspiration
  const [showInspirationModal, setShowInspirationModal] = useState(false);
  const [inspirationModalMode, setInspirationModalMode] = useState<'create' | 'edit'>('create');
  const [editingInspirationId, setEditingInspirationId] = useState<string | null>(null);
  const [inspirationForm, setInspirationForm] = useState({
    titre: '',
    angle_editorial: '',
  });

  useEffect(() => {
    loadPois();
    loadInspirations();
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

  const loadInspirations = async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/inspirations`);
      if (res.ok) {
        const data = await res.json();
        setInspirations(data.inspirations || []);
      }
    } catch (err) {
      console.log('Aucune inspiration chargée');
    }
  };

  const generateInspirations = async () => {
    setGenerating(true);
    try {
      const res = await authFetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/generate-sommaire?parts=inspirations`,
        { method: 'POST' }
      );

      if (res.ok) {
        const data = await res.json();
        const newInspirations = data.proposal?.inspirations || [];
        setInspirations(newInspirations);
        
        // Sauvegarder les inspirations vides (sans POIs assignés encore)
        await saveInspirations(newInspirations);
        alert('✅ Inspirations générées !');
      } else {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Erreur génération:', err);
      alert('❌ Erreur lors de la génération');
    } finally {
      setGenerating(false);
    }
  };

  const saveInspirations = async (inspirationsToSave: Inspiration[], changedInspirationId?: string) => {
    try {
      await authFetch(`${apiUrl}/api/v1/guides/${guideId}/inspirations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspirations: inspirationsToSave }),
      });

      // Synchroniser automatiquement les pages chemin de fer de l'inspiration modifiée
      if (changedInspirationId) {
        fetch(`${apiUrl}/api/v1/workers/sync-inspiration-pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ guideId, inspirationId: changedInspirationId }),
        }).catch(() => { /* silencieux — ne bloque pas l'UX */ });
      }
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
    }
  };

  const createInspiration = async () => {
    if (!inspirationForm.titre.trim()) {
      alert('⚠️ Veuillez saisir un titre');
      return;
    }

    const newInspiration: Inspiration = {
      theme_id: `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      titre: inspirationForm.titre.trim(),
      angle_editorial: inspirationForm.angle_editorial.trim() || 'Inspiration créée manuellement',
      lieux_associes: [],
    };

    const updatedInspirations = [...inspirations, newInspiration];
    setInspirations(updatedInspirations);
    await saveInspirations(updatedInspirations);

    closeInspirationModal();
    alert('✅ Inspiration créée !');
  };

  const closeInspirationModal = () => {
    setShowInspirationModal(false);
    setInspirationModalMode('create');
    setEditingInspirationId(null);
    setInspirationForm({ titre: '', angle_editorial: '' });
  };

  const openEditInspirationModal = (insp: Inspiration) => {
    setInspirationModalMode('edit');
    setEditingInspirationId(insp.theme_id);
    setInspirationForm({
      titre: insp.titre,
      angle_editorial: insp.angle_editorial || '',
    });
    setShowInspirationModal(true);
  };

  const updateInspiration = async () => {
    if (!editingInspirationId || !inspirationForm.titre.trim()) {
      alert('⚠️ Veuillez saisir un titre');
      return;
    }

    const updatedInspirations = inspirations.map((insp) =>
      insp.theme_id === editingInspirationId
        ? {
            ...insp,
            titre: inspirationForm.titre.trim(),
            angle_editorial:
              inspirationForm.angle_editorial.trim() || 'Inspiration mise à jour manuellement',
          }
        : insp
    );

    setInspirations(updatedInspirations);
    await saveInspirations(updatedInspirations, editingInspirationId);
    closeInspirationModal();
    alert('✅ Inspiration mise à jour !');
  };

  const deleteInspiration = async (themeId: string, titre: string) => {
    if (
      !confirm(
        `Supprimer l'inspiration « ${titre} » ?\n\nLes lieux associés seront retirés de cette inspiration. Pensez à synchroniser le chemin de fer si des pages inspiration existent déjà.`
      )
    ) {
      return;
    }

    const updatedInspirations = inspirations.filter((insp) => insp.theme_id !== themeId);
    setInspirations(updatedInspirations);
    setExpandedInspirations((prev) => {
      const next = new Set(prev);
      next.delete(themeId);
      return next;
    });
    await saveInspirations(updatedInspirations);
    alert('✅ Inspiration supprimée.');
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const poiId = active.id as string;
    const inspirationId = over.id as string;

    // Trouver l'inspiration
    const inspiration = inspirations.find(i => i.theme_id === inspirationId);
    if (!inspiration) return;

    // Vérifier si le POI est déjà dans cette inspiration
    if (inspiration.lieux_associes.includes(poiId)) {
      alert('ℹ️ Ce lieu est déjà dans cette inspiration');
      return;
    }

    // Ajouter le POI à l'inspiration
    const updatedInspirations = inspirations.map(insp => 
      insp.theme_id === inspirationId
        ? { ...insp, lieux_associes: [...insp.lieux_associes, poiId] }
        : insp
    );

    setInspirations(updatedInspirations);
    await saveInspirations(updatedInspirations, inspirationId);
  };

  const removePOIFromInspiration = async (inspirationId: string, poiId: string) => {
    const updatedInspirations = inspirations.map(insp =>
      insp.theme_id === inspirationId
        ? { ...insp, lieux_associes: insp.lieux_associes.filter(id => id !== poiId) }
        : insp
    );

    setInspirations(updatedInspirations);
    await saveInspirations(updatedInspirations, inspirationId);
  };

  const toggleInspiration = (inspirationId: string) => {
    setExpandedInspirations(prev => {
      const next = new Set(prev);
      if (next.has(inspirationId)) {
        next.delete(inspirationId);
      } else {
        next.add(inspirationId);
      }
      return next;
    });
  };

  // Filtrage POIs
  const filteredPois = pois.filter(poi =>
    poi.nom.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Compter combien de fois chaque POI apparaît dans les inspirations
  const poiInspirationsCount: Record<string, number> = {};
  inspirations.forEach(insp => {
    insp.lieux_associes.forEach(poiId => {
      poiInspirationsCount[poiId] = (poiInspirationsCount[poiId] || 0) + 1;
    });
  });

  // POIs par inspiration
  const poisByInspiration: Record<string, POI[]> = {};
  inspirations.forEach(insp => {
    poisByInspiration[insp.theme_id] = insp.lieux_associes
      .map(poiId => pois.find(p => p.poi_id === poiId))
      .filter((p): p is POI => p !== undefined);
  });

  const stats = {
    total: pois.length,
    withInspirations: Object.keys(poiInspirationsCount).length,
    inspirations: inspirations.length,
  };

  const activePoi = activeDragId ? pois.find(p => p.poi_id === activeDragId) : null;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header compact */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={generateInspirations}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {generating ? (
                <>
                  <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                  Génération...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-3.5 h-3.5" />
                  Générer les inspirations
                </>
              )}
            </button>

            <div className="ml-auto text-xs text-gray-600">
              {stats.withInspirations}/{stats.total} lieux • {stats.inspirations} inspirations
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
              </div>

              {/* Recherche */}
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
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
                </div>
              )}

              {!loading && filteredPois.map((poi) => (
                <DraggablePOI
                  key={poi.poi_id}
                  poi={poi}
                  inspirationsCount={poiInspirationsCount[poi.poi_id] || 0}
                  apiUrl={apiUrl}
                  guideId={guideId}
                />
              ))}
            </div>
          </div>

          {/* Colonne droite : Inspirations */}
          <div className="w-1/2 flex flex-col bg-gray-50">
            <div className="p-3 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">Inspirations ({inspirations.length})</div>
                
                <button
                  onClick={() => {
                    setInspirationModalMode('create');
                    setEditingInspirationId(null);
                    setInspirationForm({ titre: '', angle_editorial: '' });
                    setShowInspirationModal(true);
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Ajouter
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {inspirations.map((inspiration) => (
                <DroppableInspiration
                  key={inspiration.theme_id}
                  inspiration={inspiration}
                  pois={poisByInspiration[inspiration.theme_id] || []}
                  isExpanded={expandedInspirations.has(inspiration.theme_id)}
                  onToggle={() => toggleInspiration(inspiration.theme_id)}
                  onRemovePOI={(poiId) => removePOIFromInspiration(inspiration.theme_id, poiId)}
                  onEdit={() => openEditInspirationModal(inspiration)}
                  onDelete={() => deleteInspiration(inspiration.theme_id, inspiration.titre)}
                />
              ))}

              {inspirations.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <LightBulbIcon className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm font-medium">Aucune inspiration</p>
                  <p className="text-xs">Cliquez sur "Générer les inspirations"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activePoi ? (
          <div className="bg-white p-2 rounded border-2 border-purple-500 shadow-lg">
            <div className="text-sm font-medium text-gray-900">{activePoi.nom}</div>
            <div className="text-xs text-gray-500">{activePoi.type}</div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Modal création / édition d'inspiration */}
      {showInspirationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-md">
            <h3 className="text-base font-semibold mb-3">
              {inspirationModalMode === 'edit'
                ? 'Modifier l’inspiration'
                : 'Créer une nouvelle inspiration'}
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Titre *</label>
                <input
                  type="text"
                  value={inspirationForm.titre}
                  onChange={(e) => setInspirationForm({ ...inspirationForm, titre: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="Ex: Les plus beaux points de vue"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Angle éditorial</label>
                <textarea
                  value={inspirationForm.angle_editorial}
                  onChange={(e) => setInspirationForm({ ...inspirationForm, angle_editorial: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="Ex: Une sélection des panoramas incontournables"
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Décrivez l'angle éditorial de cette inspiration
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={closeInspirationModal}
                className="flex-1 px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={inspirationModalMode === 'edit' ? updateInspiration : createInspiration}
                disabled={!inspirationForm.titre.trim()}
                className="flex-1 px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
              >
                {inspirationModalMode === 'edit' ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
