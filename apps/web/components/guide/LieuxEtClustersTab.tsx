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

const POI_TYPE_COLORS: Record<string, string> = {
  site_naturel: 'bg-green-100 text-green-700',
  plage: 'bg-cyan-100 text-cyan-700',
  panorama: 'bg-sky-100 text-sky-700',
  village: 'bg-yellow-100 text-yellow-700',
  ville: 'bg-yellow-100 text-yellow-700',
  quartier: 'bg-orange-100 text-orange-700',
  site_culturel: 'bg-purple-100 text-purple-700',
  autre: 'bg-gray-100 text-gray-600',
};

function PoiRow({ poi }: { poi: any }) {
  return (
    <div className="px-3 py-2 flex items-start gap-2">
      <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium mt-0.5 ${POI_TYPE_COLORS[poi.type] || POI_TYPE_COLORS.autre}`}>
        {poi.type}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{poi.nom}</div>
        {poi.raison_selection && (
          <div className="text-xs text-gray-500 mt-0.5">{poi.raison_selection}</div>
        )}
      </div>
      {poi.mentions === 'principale' && (
        <span className="flex-shrink-0 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">★</span>
      )}
    </div>
  );
}

// Affichage par batches (avec articles + URLs)
function ClassificationTable({ log }: { log: any[] }) {
  const [filter, setFilter] = useState<'all' | 'mono' | 'multi' | 'exclude'>('all');
  const filtered = filter === 'all' ? log : log.filter(a => a.type === filter);

  const counts = {
    mono: log.filter(a => a.type === 'mono').length,
    multi: log.filter(a => a.type === 'multi').length,
    exclude: log.filter(a => a.type === 'exclude').length,
  };

  const rowStyle: Record<string, string> = {
    mono: 'bg-amber-50',
    multi: 'bg-blue-50',
    exclude: 'bg-gray-50 opacity-60',
  };

  const badgeStyle: Record<string, string> = {
    mono: 'bg-amber-200 text-amber-800',
    multi: 'bg-blue-200 text-blue-800',
    exclude: 'bg-gray-200 text-gray-600',
  };

  const badgeLabel: Record<string, string> = {
    mono: '🎯 mono',
    multi: '📋 multi',
    exclude: '⛔ exclu',
  };

  return (
    <div>
      {/* Filtres */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {(['all', 'mono', 'multi', 'exclude'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
              filter === f
                ? f === 'mono' ? 'bg-amber-500 text-white'
                : f === 'multi' ? 'bg-blue-600 text-white'
                : f === 'exclude' ? 'bg-gray-500 text-white'
                : 'bg-gray-700 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? `Tous (${log.length})` : f === 'mono' ? `🎯 Mono (${counts.mono})` : f === 'multi' ? `📋 Multi (${counts.multi})` : `⛔ Exclus (${counts.exclude})`}
          </button>
        ))}
      </div>

      {/* Tableau */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
            <th className="text-left py-2 px-3 border border-gray-200 font-semibold">Type</th>
            <th className="text-left py-2 px-3 border border-gray-200 font-semibold">Article</th>
            <th className="text-left py-2 px-3 border border-gray-200 font-semibold">Raison IA</th>
            <th className="text-left py-2 px-3 border border-gray-200 font-semibold">Détail</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((entry, i) => (
            <tr key={i} className={`border-b border-gray-100 ${rowStyle[entry.type] ?? ''}`}>
              <td className="py-2 px-3 border border-gray-100">
                <span className={`px-2 py-0.5 rounded-full font-semibold text-xs ${badgeStyle[entry.type] ?? ''}`}>
                  {badgeLabel[entry.type] ?? entry.type}
                </span>
              </td>
              <td className="py-2 px-3 border border-gray-100 max-w-xs">
                {entry.url ? (
                  <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline leading-snug line-clamp-2">
                    {entry.title}
                  </a>
                ) : (
                  <span className="text-gray-700 leading-snug line-clamp-2">{entry.title}</span>
                )}
              </td>
              <td className="py-2 px-3 border border-gray-100 text-gray-600 italic">{entry.reason}</td>
              <td className="py-2 px-3 border border-gray-100 text-gray-500">
                {entry.type === 'mono' && entry.poiName && (
                  <span>POI : <strong className="text-amber-700">{entry.poiName}</strong></span>
                )}
                {entry.type === 'multi' && entry.headingCount !== undefined && (
                  <span>{entry.headingCount} H2/H3</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchCard({ batch }: { batch: any }) {
  const [articlesOpen, setArticlesOpen] = useState(false);
  const isMono = !!batch.is_mono_batch;
  const headerBg = isMono ? 'bg-amber-500' : 'bg-blue-600';
  const sectionBg = isMono ? 'bg-amber-50' : 'bg-blue-50';
  const textColor = isMono ? 'text-amber-700' : 'text-blue-700';
  const dotColor = isMono ? 'text-amber-400' : 'text-blue-400';
  const linkColor = isMono ? 'text-amber-700 hover:text-amber-900' : 'text-blue-700 hover:text-blue-900';
  const borderColor = isMono ? 'border-amber-200' : 'border-blue-200';
  const typeLabel = isMono ? '🎯 Mono-POI' : '📋 Multi-POI';

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      {/* Header */}
      <div className={`px-4 py-2.5 flex items-center justify-between ${headerBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-white truncate">
            {batch.label || `Batch ${batch.batch_num}/${batch.total_batches}`}
          </span>
          <span className="text-xs text-white/70 font-normal flex-shrink-0">{typeLabel}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-white/80 font-semibold">
            {batch.pois?.length || 0} POI{(batch.pois?.length || 0) > 1 ? 's' : ''}
          </span>
          {/* Toggle articles */}
          <button
            onClick={() => setArticlesOpen(o => !o)}
            className="text-xs text-white/70 hover:text-white flex items-center gap-1 border border-white/30 rounded px-2 py-0.5 hover:border-white/60 transition-colors"
          >
            {articlesOpen ? '▲' : '▼'} {batch.articles?.length || 0} articles
          </button>
        </div>
      </div>

      {/* Articles (repliable) */}
      {articlesOpen && (
        <div className={`px-4 py-2 border-b border-gray-100 ${sectionBg}`}>
          <ul className="space-y-1.5">
            {batch.articles?.map((article: any, idx: number) => (
              <li key={idx} className="text-xs">
                <div className="flex items-start gap-1.5">
                  <span className={`flex-shrink-0 mt-0.5 ${dotColor}`}>{idx + 1}.</span>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hover:underline font-medium ${linkColor}`}
                    title={article.url}
                  >
                    {article.title}
                  </a>
                </div>
                {!isMono && article.headings?.length > 0 && (
                  <div className={`ml-4 mt-0.5 text-xs ${textColor} opacity-70`}>
                    {article.headings.slice(0, 4).map((h: string, hi: number) => (
                      <span key={hi} className="mr-2">• {h}</span>
                    ))}
                    {article.headings.length > 4 && <span className="opacity-60">+{article.headings.length - 4} H2/H3</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* POIs — toujours visibles */}
      {batch.pois?.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {batch.pois.map((poi: any, idx: number) => (
            <PoiRow key={`${poi.poi_id}-${idx}`} poi={poi} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-gray-400 italic">Aucun POI extrait pour ce batch</div>
      )}
    </div>
  );
}

function PoiPreviewList({ batches, poisFallback }: { batches: any[]; poisFallback: any[] }) {
  if (batches.length > 0) {
    return (
      <div className="space-y-5">
        {batches.map((batch: any) => (
          <BatchCard key={`${batch.batch_num}-${batch.label}`} batch={batch} />
        ))}
      </div>
    );
  }

  // Fallback : grouper par article_source si pas de batches
  const grouped: Record<string, any[]> = {};
  for (const poi of poisFallback) {
    const src = poi.article_source || 'Source inconnue';
    if (!grouped[src]) grouped[src] = [];
    grouped[src].push(poi);
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([articleTitle, articlePois]) => (
        <div key={articleTitle} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 truncate flex-1 mr-2">{articleTitle}</span>
            <span className="text-xs text-gray-400 flex-shrink-0">{articlePois.length} POI{articlePois.length > 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {articlePois.map((poi: any, idx: number) => (
              <PoiRow key={`${poi.poi_id}-${idx}`} poi={poi} />
            ))}
          </div>
        </div>
      ))}
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

  // États preview génération en temps réel
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState<string | null>(null);
  const [previewPois, setPreviewPois] = useState<any[]>([]);
  const [previewBatches, setPreviewBatches] = useState<any[]>([]);
  const [classificationLog, setClassificationLog] = useState<any[]>([]);
  const [monoCount, setMonoCount] = useState<number | null>(null);
  const [multiCount, setMultiCount] = useState<number | null>(null);
  const [excludedCount, setExcludedCount] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState<'batches' | 'classification'>('batches');
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [deduplicating, setDeduplicating] = useState(false);
  const [dedupPois, setDedupPois] = useState<any[]>([]);
  const [confirming, setConfirming] = useState(false);

  // États validation humaine (après dedup_complete)
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationPois, setValidationPois] = useState<any[]>([]);
  const [excludedPoiIds, setExcludedPoiIds] = useState<Set<string>>(new Set());
  const [validationSearch, setValidationSearch] = useState('');
  const [validationTypeFilter, setValidationTypeFilter] = useState<string>('all');
  
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

  // Job en attente détecté au chargement (reprise après rafraîchissement)
  const [pendingJobRawCount, setPendingJobRawCount] = useState<number | null>(null);

  useEffect(() => {
    loadPois();
    loadMatching();
    checkForPendingJob();
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

  // Vérifie au montage si un job est en attente d'action (extraction_complete / dedup_complete)
  const checkForPendingJob = async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/latest-job`);
      if (!res.ok) return;
      const data = await res.json();
        if (data.job) {
        const { jobId, status, raw_count, preview_pois, preview_batches,
                classification_log, mono_count, multi_count, excluded_count,
                deduplicated_pois } = data.job;
        setCurrentJobId(jobId);
        setJobStatus(status);
        if (preview_pois.length) setPreviewPois(preview_pois);
        if (preview_batches.length) setPreviewBatches(preview_batches);
        if (classification_log.length) setClassificationLog(classification_log);
        if (mono_count !== null) setMonoCount(mono_count);
        if (multi_count !== null) setMultiCount(multi_count);
        if (excluded_count !== null) setExcludedCount(excluded_count);

        if (status === 'dedup_complete' && deduplicated_pois.length) {
          // Ouvrir directement le modal de validation
          setDedupPois(deduplicated_pois);
          setValidationPois(deduplicated_pois);
          setExcludedPoiIds(new Set());
          setShowValidationModal(true);
        } else {
          // Extraction en attente → bouton "Reprendre"
          setPendingJobRawCount(raw_count || preview_pois.length);
        }
      }
    } catch (err) {
      console.error('Erreur vérification job en attente:', err);
    }
  };

  const generatePoisFromArticles = async () => {
    setGenerating(true);
    setPreviewPois([]);
    setPreviewBatches([]);
    setClassificationLog([]);
    setMonoCount(null);
    setMultiCount(null);
    setExcludedCount(null);
    setPreviewTab('batches');
    setDedupPois([]);
    setJobStatus(null);
    setCurrentJobId(null);
    setPendingJobRawCount(null);
    setGeneratingProgress('Initialisation...');
    setShowPreviewModal(true);

    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/generate`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`❌ Erreur: ${err.error || 'Erreur inconnue'}`);
        setGenerating(false);
        setGeneratingProgress(null);
        setShowPreviewModal(false);
        return;
      }

      const data = await res.json();
      const jobId = data.jobId;
      setCurrentJobId(jobId);

      const pollInterval = setInterval(async () => {
        try {
          const checkRes = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/job-status/${jobId}`);
          if (checkRes.ok) {
            const status = await checkRes.json();

            if (status.progress) setGeneratingProgress(status.progress);
            if (status.preview_pois?.length) setPreviewPois(status.preview_pois);
            if (status.preview_batches?.length) setPreviewBatches(status.preview_batches);
            if (status.classification_log?.length) setClassificationLog(status.classification_log);
            if (status.mono_count !== null) setMonoCount(status.mono_count);
            if (status.multi_count !== null) setMultiCount(status.multi_count);
            if (status.excluded_count !== null) setExcludedCount(status.excluded_count);
            setJobStatus(status.status);

            if (status.status === 'dedup_complete') {
              clearInterval(pollInterval);
              const finalPois = status.deduplicated_pois || [];
              if (finalPois.length) {
                setDedupPois(finalPois);
                setValidationPois(finalPois);
                setExcludedPoiIds(new Set());
                setValidationSearch('');
                setValidationTypeFilter('all');
                setShowValidationModal(true);
                setShowPreviewModal(false);
              }
              setDeduplicating(false);
              setPendingJobRawCount(null);
            } else if (status.status === 'extraction_complete') {
              clearInterval(pollInterval);
              setGeneratingProgress(null);
              setGenerating(false);
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval);
              setGeneratingProgress(null);
              setGenerating(false);
              setDeduplicating(false);
              if (status.status === 'failed') alert(`❌ Erreur: ${status.error || 'Erreur inconnue'}`);
            } else if (status.status === 'completed') {
              clearInterval(pollInterval);
              setGeneratingProgress(null);
              setGenerating(false);
              await loadPois();
            }
          }
        } catch (pollErr) {
          console.error('Erreur polling:', pollErr);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setGenerating(false);
        setGeneratingProgress(null);
      }, 10 * 60 * 1000);

    } catch (err) {
      console.error('Erreur génération:', err);
      setGenerating(false);
      setGeneratingProgress(null);
      setShowPreviewModal(false);
    }
  };

  const launchDedup = async () => {
    if (!currentJobId) return;
    setDeduplicating(true);
    setDedupPois([]);

    try {
      // Déclenche le worker via QStash — réponse immédiate
      const res = await authFetch(
        `${apiUrl}/api/v1/guides/${guideId}/pois/jobs/${currentJobId}/deduplicate`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`❌ Erreur dédoublonnage: ${err.error || 'Erreur inconnue'}`);
        setDeduplicating(false);
        return;
      }

      // Polling dédié — indépendant du polling d'extraction
      const jobId = currentJobId;
      const dedupPoll = setInterval(async () => {
        try {
          const checkRes = await authFetch(
            `${apiUrl}/api/v1/guides/${guideId}/pois/job-status/${jobId}`
          );
          if (!checkRes.ok) return;
          const status = await checkRes.json();
          setJobStatus(status.status);

          if (status.status === 'dedup_complete') {
            clearInterval(dedupPoll);
            const finalPois = status.deduplicated_pois || [];
            if (finalPois.length) {
              setDedupPois(finalPois);
              setValidationPois(finalPois);
              setExcludedPoiIds(new Set());
              setValidationSearch('');
              setValidationTypeFilter('all');
              setShowValidationModal(true);
              setShowPreviewModal(false);
            }
            setDeduplicating(false);
            setPendingJobRawCount(null);
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            clearInterval(dedupPoll);
            setDeduplicating(false);
            alert(`❌ Dédoublonnage échoué: ${status.error || 'Erreur inconnue'}`);
          }
        } catch (pollErr) {
          console.error('Erreur polling dédup:', pollErr);
        }
      }, 3000);

      // Timeout de sécurité : 10 minutes
      setTimeout(() => {
        clearInterval(dedupPoll);
        if (deduplicating) {
          setDeduplicating(false);
          alert('⏱️ Timeout dédoublonnage — vérifiez les logs Railway et rechargez la page.');
        }
      }, 10 * 60 * 1000);

    } catch (err) {
      console.error('Erreur dédup:', err);
      alert('Erreur lors du dédoublonnage');
      setDeduplicating(false);
    }
  };

  const confirmSave = async (poisToSave?: any[]) => {
    if (!currentJobId) return;
    const finalPois = poisToSave ?? (dedupPois.length ? dedupPois : previewPois);

    setConfirming(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId, validatedPois: finalPois }),
      });
      if (res.ok) {
        const data = await res.json();
        await loadPois();
        setJobStatus('completed');
        setShowPreviewModal(false);
        setShowValidationModal(false);
        setPendingJobRawCount(null);
        alert(`✅ ${data.count} POI(s) sauvegardés avec succès !`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`❌ Erreur: ${err.error || 'Erreur inconnue'}`);
      }
    } catch (err) {
      console.error('Erreur confirmation:', err);
    } finally {
      setConfirming(false);
    }
  };

  const clearJobs = async () => {
    if (!confirm('Supprimer tous les jobs de génération pour ce guide ?')) return;
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/jobs`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        alert(`✅ ${data.deleted} job(s) supprimé(s)`);
      }
    } catch (err) {
      console.error('Erreur nettoyage jobs:', err);
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
    <>
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header — 3 étapes */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={clearJobs}
              disabled={generating}
              title="Nettoyer les anciens jobs de génération"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs transition-colors"
            >
              🧹
            </button>

            {/* Séparateur */}
            <div className="w-px h-5 bg-gray-200" />

            {/* Étape 1 : Identification des POIs */}
            <button
              onClick={generatePoisFromArticles}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {generating ? (
                <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />Identification...</>
              ) : (
                <><SparklesIcon className="w-3.5 h-3.5" />1. Identifier les POIs</>
              )}
            </button>

            {/* Bouton de reprise si extraction en attente — s'affiche dès qu'un job est détecté,
                indépendamment du jobStatus exact pour éviter les blocages */}
            {pendingJobRawCount !== null && !generating && !deduplicating && (
              <button
                onClick={() => setShowPreviewModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-md hover:bg-orange-600 text-xs font-medium transition-colors"
                title="Voir les POIs extraits en attente de dédoublonnage"
              >
                <ArrowPathIcon className="w-3.5 h-3.5" />
                Voir l'extraction ({pendingJobRawCount})
              </button>
            )}

            {/* Étape 2 : Dédoublonnage
                Actif dès qu'un jobId existe et que l'extraction est terminée (peu importe le status exact).
                Les états terminaux (completed/failed/cancelled) désactivent le bouton. */}
            {(() => {
              const isTerminal = jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'cancelled';
              const hasJob = !!currentJobId && !generating && !deduplicating;
              const isDedupDone = jobStatus === 'dedup_complete' && dedupPois.length > 0;
              const canDedup = hasJob && !isTerminal && (jobStatus === 'extraction_complete' || pendingJobRawCount !== null);
              const isEnabled = isDedupDone || canDedup;

              return (
                <button
                  onClick={() => {
                    if (isDedupDone) {
                      setValidationPois(dedupPois);
                      setExcludedPoiIds(new Set());
                      setShowValidationModal(true);
                    } else if (hasJob) {
                      setShowPreviewModal(true);
                      launchDedup();
                    }
                  }}
                  disabled={!isEnabled}
                  title={
                    isDedupDone ? 'Voir les résultats du dédoublonnage'
                    : canDedup ? 'Lancer le dédoublonnage des POIs extraits'
                    : 'Disponible après l\'identification des POIs'
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed ${
                    isDedupDone
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : canDedup
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {deduplicating ? (
                    <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />Dédoublonnage...</>
                  ) : isDedupDone ? (
                    <>✅ 2. Voir la sélection ({dedupPois.length})</>
                  ) : (
                    <>🔁 2. Dédoublonner</>
                  )}
                </button>
              );
            })()}

            {/* Séparateur */}
            <div className="w-px h-5 bg-gray-200" />

            {/* Étape 3 : Ventilation dans les clusters */}
            <button
              onClick={launchMatching}
              disabled={matching || pois.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {matching ? (
                <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />Ventilation...</>
              ) : (
                <><ArrowPathIcon className="w-3.5 h-3.5" />3. Ventiler dans les clusters</>
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

    {/* Modale preview génération temps réel */}
    {showPreviewModal && (

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-3">
              {generating || deduplicating ? (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : jobStatus === 'dedup_complete' ? (
                <span className="text-blue-500 text-lg">🔁</span>
              ) : jobStatus === 'completed' ? (
                <span className="text-green-500 text-lg">✅</span>
              ) : (
                <span className="text-orange-500 text-lg">⏳</span>
              )}
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {generating ? 'Extraction en cours...'
                    : deduplicating ? 'Dédoublonnage en cours...'
                    : jobStatus === 'extraction_complete' ? 'Extraction terminée — à dédoublonner'
                    : jobStatus === 'dedup_complete' ? 'Dédoublonnage terminé — à valider'
                    : 'Analyse terminée'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {generatingProgress && <span className="font-medium text-blue-600">{generatingProgress} — </span>}
                  {jobStatus === 'dedup_complete'
                    ? <><span className="text-green-600 font-medium">{dedupPois.length} POIs dédoublonnés</span> <span className="text-gray-400">(sur {previewPois.length} bruts)</span></>
                    : <>{previewPois.length} POI{previewPois.length > 1 ? 's' : ''} extraits</>
                  }
                </p>
              </div>
            </div>
            <button onClick={() => setShowPreviewModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
          </div>

          {/* Bandeau de synthèse classification (dès que disponible) */}
          {(monoCount !== null || multiCount !== null) && (
            <div className="flex items-center gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-xs flex-shrink-0">
              <span className="text-gray-500 font-medium">Classification :</span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full font-semibold">
                🎯 {monoCount} mono-POI
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full font-semibold">
                📋 {multiCount} multi-POI
              </span>
              {excludedCount !== null && excludedCount > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full font-semibold">
                  ⛔ {excludedCount} exclus
                </span>
              )}
              <span className="text-gray-400">
                {(monoCount ?? 0) + (multiCount ?? 0) + (excludedCount ?? 0)} articles au total
              </span>
            </div>
          )}

          {/* Onglets POIs / Classification */}
          {(previewBatches.length > 0 || classificationLog.length > 0) && (
            <div className="flex border-b border-gray-200 flex-shrink-0">
              <button
                onClick={() => setPreviewTab('batches')}
                className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${previewTab === 'batches' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                POIs extraits
                {previewPois.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">{previewPois.length}</span>}
              </button>
              <button
                onClick={() => setPreviewTab('classification')}
                className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${previewTab === 'classification' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                Contrôle classification
                {classificationLog.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{classificationLog.length}</span>}
              </button>
            </div>
          )}

          {/* Corps scrollable */}
          <div className="overflow-y-auto flex-1 px-5 py-4">
            {previewTab === 'classification' && classificationLog.length > 0 ? (
              <ClassificationTable log={classificationLog} />
            ) : jobStatus === 'dedup_complete' && dedupPois.length > 0 ? (
              <PoiPreviewList batches={[]} poisFallback={dedupPois} />
            ) : previewBatches.length === 0 && previewPois.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                En attente des premiers résultats...
              </div>
            ) : (
              <PoiPreviewList batches={previewBatches} poisFallback={previewPois} />
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50 rounded-b-xl gap-3">
            <span className="text-xs text-gray-500 flex-1">
              {generating
                ? 'La fenêtre peut être fermée, la génération continue en arrière-plan.'
                : jobStatus === 'extraction_complete'
                ? `${previewPois.length} POIs temporaires — lancez le dédoublonnage avant de sauvegarder.`
                : jobStatus === 'dedup_complete'
                ? `Validez pour remplacer les ${pois.length} POIs existants par les ${dedupPois.length} POIs dédoublonnés.`
                : ''}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {jobStatus === 'extraction_complete' && !generating && (
                <button
                  onClick={launchDedup}
                  disabled={deduplicating}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {deduplicating ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Dédoublonnage...</>
                  ) : (
                    <>🔁 Lancer le dédoublonnage</>
                  )}
                </button>
              )}
              {jobStatus === 'dedup_complete' && (
                <button
                  onClick={() => {
                    setValidationPois(dedupPois);
                    setExcludedPoiIds(new Set());
                    setShowValidationModal(true);
                    setShowPreviewModal(false);
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                >
                  ✅ Valider la liste ({dedupPois.length} POIs)
                </button>
              )}
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {/* ─── Modal de validation humaine des POIs dédoublonnés ─────────────────── */}
    {showValidationModal && (() => {
      const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
        POI:          { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'POI' },
        RESTAURANT:   { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Restaurant' },
        HOTEL:        { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Hôtel' },
        ACTIVITE:     { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Activité' },
        SHOPPING:     { bg: 'bg-pink-100',   text: 'text-pink-800',   label: 'Shopping' },
        INSPIRATION:  { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Inspiration' },
      };
      const allTypes = Array.from(new Set(validationPois.map(p => p.type || 'POI'))).sort();
      const activePois = validationPois.filter(p => !excludedPoiIds.has(p.poi_id));
      const filteredPois = validationPois.filter(p => {
        const matchesType = validationTypeFilter === 'all' || p.type === validationTypeFilter;
        const matchesSearch = !validationSearch.trim()
          || p.nom?.toLowerCase().includes(validationSearch.toLowerCase())
          || p.article_source?.toLowerCase().includes(validationSearch.toLowerCase());
        return matchesType && matchesSearch;
      });
      const excludedInView = filteredPois.filter(p => excludedPoiIds.has(p.poi_id)).length;
      const activeInView = filteredPois.length - excludedInView;

      const toggleExclude = (poiId: string) => {
        setExcludedPoiIds(prev => {
          const next = new Set(prev);
          if (next.has(poiId)) next.delete(poiId); else next.add(poiId);
          return next;
        });
      };
      const excludeAll = () => setExcludedPoiIds(new Set(filteredPois.map(p => p.poi_id)));
      const restoreAll = () => setExcludedPoiIds(prev => {
        const next = new Set(prev);
        filteredPois.forEach(p => next.delete(p.poi_id));
        return next;
      });

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col mx-4">

            {/* ── En-tête ── */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <span>🔍</span> Validation de la liste des POIs
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Revoyez chaque entrée avant de confirmer. Les lignes supprimées ne seront pas sauvegardées.
                </p>
              </div>
              <button
                onClick={() => setShowValidationModal(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1 mt-0.5"
              >×</button>
            </div>

            {/* ── Bandeau statistiques ── */}
            <div className="flex items-center gap-5 px-6 py-3 bg-gray-50 border-b border-gray-200 flex-shrink-0 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
                <span className="text-gray-500">Bruts :</span>
                <span className="font-semibold text-gray-700">{previewPois.length}</span>
              </div>
              <span className="text-gray-300">→</span>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
                <span className="text-gray-500">Après dédup :</span>
                <span className="font-semibold text-blue-700">{validationPois.length}</span>
                {previewPois.length > 0 && (
                  <span className="text-xs text-gray-400">
                    (−{previewPois.length - validationPois.length} doublons)
                  </span>
                )}
              </div>
              <span className="text-gray-300">→</span>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                <span className="text-gray-500">Sélectionnés :</span>
                <span className="font-bold text-green-700">{activePois.length}</span>
                {excludedPoiIds.size > 0 && (
                  <span className="ml-1 text-xs text-red-500">(−{excludedPoiIds.size} retirés)</span>
                )}
              </div>
            </div>

            {/* ── Filtres ── */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 flex-shrink-0 flex-wrap">
              <input
                type="text"
                value={validationSearch}
                onChange={e => setValidationSearch(e.target.value)}
                placeholder="Rechercher par nom ou source…"
                className="flex-1 min-w-48 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                <button
                  onClick={() => setValidationTypeFilter('all')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${validationTypeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Tous ({validationPois.length})
                </button>
                {allTypes.map(type => {
                  const c = TYPE_COLORS[type] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: type };
                  const count = validationPois.filter(p => p.type === type).length;
                  return (
                    <button
                      key={type}
                      onClick={() => setValidationTypeFilter(type === validationTypeFilter ? 'all' : type)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${validationTypeFilter === type ? `${c.bg} ${c.text} ring-2 ring-offset-1 ring-current` : `${c.bg} ${c.text} hover:opacity-80`}`}
                    >
                      {c.label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                <button onClick={restoreAll} className="text-xs text-blue-600 hover:text-blue-800 underline">Tout restaurer</button>
                <span className="text-gray-300">|</span>
                <button onClick={excludeAll} className="text-xs text-red-500 hover:text-red-700 underline">Tout exclure</button>
                <span className="text-gray-400 text-xs ml-1">{activeInView}/{filteredPois.length} visibles</span>
              </div>
            </div>

            {/* ── Liste scrollable ── */}
            <div className="overflow-y-auto flex-1">
              {filteredPois.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                  Aucun POI ne correspond aux filtres.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2">Nom</th>
                      <th className="px-4 py-2 w-32">Type</th>
                      <th className="px-4 py-2">Source article</th>
                      <th className="px-4 py-2 w-28">Mentions</th>
                      <th className="px-4 py-2 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPois.map((poi, idx) => {
                      const isExcluded = excludedPoiIds.has(poi.poi_id);
                      const c = TYPE_COLORS[poi.type] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: poi.type };
                      const extraMentions = poi.autres_articles_mentions?.length || 0;
                      return (
                        <tr
                          key={poi.poi_id}
                          className={`border-b border-gray-50 transition-colors ${isExcluded ? 'bg-red-50 opacity-50' : idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-50'}`}
                        >
                          <td className="px-4 py-2 text-center text-xs text-gray-300">{idx + 1}</td>
                          <td className="px-4 py-2">
                            <span className={`font-medium ${isExcluded ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                              {poi.nom}
                            </span>
                            {extraMentions > 0 && !isExcluded && (
                              <span
                                className="ml-2 text-xs text-gray-400 cursor-default"
                                title={poi.autres_articles_mentions.join(', ')}
                              >
                                +{extraMentions} source{extraMentions > 1 ? 's' : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
                              {c.label}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 truncate max-w-xs" title={poi.article_source}>
                            {poi.article_source || '—'}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`text-xs ${poi.mentions === 'principal' ? 'text-green-700 font-medium' : 'text-gray-400'}`}>
                              {poi.mentions === 'principal' ? '★ Principal' : 'Secondaire'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => toggleExclude(poi.poi_id)}
                              title={isExcluded ? 'Restaurer ce POI' : 'Exclure ce POI'}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isExcluded ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : 'bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600'}`}
                            >
                              {isExcluded ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C9.327 4.025 10.157 4 11 4h-1zm-2.5 9a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm4.5 0a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0 bg-gray-50 rounded-b-2xl gap-4">
              <div className="text-sm text-gray-600">
                {excludedPoiIds.size > 0 ? (
                  <span>
                    <span className="font-semibold text-red-600">{excludedPoiIds.size} POI{excludedPoiIds.size > 1 ? 's' : ''} exclus</span>
                    {' — '}
                    <span className="font-semibold text-green-700">{activePois.length} seront sauvegardés</span>
                  </span>
                ) : (
                  <span>
                    <span className="font-semibold text-green-700">{activePois.length} POIs</span> prêts à être sauvegardés
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/* Relancer le dédoublonnage */}
                {currentJobId && (
                  <button
                    onClick={() => {
                      setShowValidationModal(false);
                      setShowPreviewModal(true);
                      launchDedup();
                    }}
                    disabled={deduplicating}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    Relancer le dédoublonnage
                  </button>
                )}
                <button
                  onClick={() => setShowValidationModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => confirmSave(activePois)}
                  disabled={confirming || activePois.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {confirming ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Sauvegarde…</>
                  ) : (
                    <>✅ Confirmer et sauvegarder ({activePois.length} POIs)</>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>
      );
    })()}
    </>
  );
}
