'use client';

import { useState, useEffect } from 'react';
import { 
  MagnifyingGlassIcon, 
  PlusIcon, 
  TrashIcon,
  MapPinIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';
import { authFetch } from '@/lib/api-client';

interface POI {
  poi_id: string;
  nom: string;
  type: string;
  source: 'article' | 'manual' | 'library';
  article_source?: string;
  raison_selection?: string;
  autres_articles_mentions?: string[];
  coordinates?: {
    lat: number;
    lon: number;
    display_name?: string;
  };
  cluster_id?: string;
  cluster_name?: string;
  region_lovers_id?: string;
}

interface LieuxManagementTabProps {
  guideId: string;
  apiUrl: string;
  guide?: any;
}

export default function LieuxManagementTab({ guideId, apiUrl, guide }: LieuxManagementTabProps) {
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Modal ajout manuel
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    nom: '',
    type: 'autre',
    lat: '',
    lon: '',
  });

  // Bibliothèque RL
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryData, setLibraryData] = useState<Record<string, POI[]>>({});
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadPois();
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

  const generatePoisFromArticles = async () => {
    setGenerating(true);
    try {
      console.log('🔍 Génération POIs depuis articles...');
      
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/generate`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(`❌ Erreur: ${errorData.error}\n${errorData.message || errorData.details || ''}`);
        setGenerating(false);
        return;
      }

      const data = await res.json();
      const jobId = data.jobId;

      console.log(`📋 Job de génération lancé: ${jobId}`);
      alert('🔄 Génération des lieux lancée en arrière-plan...');

      // 2. Polling pour vérifier le statut
      const checkStatus = async (): Promise<boolean> => {
        try {
          const statusRes = await authFetch(
            `${apiUrl}/api/v1/guides/${guideId}/pois/job-status/${jobId}`
          );

          if (!statusRes.ok) {
            console.error('Erreur lors de la vérification du statut');
            return false;
          }

          const statusData = await statusRes.json();
          console.log(`📊 Statut job: ${statusData.status}`);

          if (statusData.status === 'completed') {
            // Recharger les POIs
            await loadPois();
            alert(`✅ ${statusData.count || 0} lieu(x) identifié(s) avec succès !`);
            return true;
          } else if (statusData.status === 'failed') {
            alert(`❌ Erreur lors de la génération: ${statusData.error || 'Erreur inconnue'}`);
            return true;
          }

          // Toujours en cours (pending ou processing)
          return false;

        } catch (error) {
          console.error('Erreur polling:', error);
          return false;
        }
      };

      // 3. Polling toutes les 3 secondes
      const pollInterval = setInterval(async () => {
        const isDone = await checkStatus();
        if (isDone) {
          clearInterval(pollInterval);
          setGenerating(false);
        }
      }, 3000);

      // Timeout de 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setGenerating(false);
        alert('⏱️ Timeout: la génération prend trop de temps. Rafraîchissez la page plus tard.');
      }, 5 * 60 * 1000);
      
    } catch (error: any) {
      console.error('❌ Erreur génération:', error);
      alert(`Erreur lors de la génération: ${error.message}`);
      setGenerating(false);
    }
  };

  const addManualPoi = async () => {
    if (!manualForm.nom.trim()) {
      alert('Le nom du lieu est requis');
      return;
    }

    try {
      const payload: any = {
        nom: manualForm.nom.trim(),
        type: manualForm.type,
      };

      if (manualForm.lat && manualForm.lon) {
        payload.coordinates = {
          lat: parseFloat(manualForm.lat),
          lon: parseFloat(manualForm.lon),
        };
      }

      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/add-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(`Erreur: ${errorData.error}`);
        return;
      }

      const data = await res.json();
      setPois([...pois, data.poi]);
      setShowManualModal(false);
      setManualForm({ nom: '', type: 'autre', lat: '', lon: '' });
      
    } catch (error: any) {
      console.error('Erreur ajout manuel:', error);
      alert(`Erreur: ${error.message}`);
    }
  };

  const deletePoi = async (poiId: string) => {
    if (!confirm('Supprimer ce lieu de la sélection ?')) return;

    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/${poiId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setPois(pois.filter(p => p.poi_id !== poiId));
      }
    } catch (error: any) {
      console.error('Erreur suppression:', error);
      alert(`Erreur: ${error.message}`);
    }
  };

  const loadLibrary = async () => {
    if (!guide?.destination_rl_id) {
      alert('⚠️ Configuration manquante\n\nVeuillez renseigner l\'ID Region Lovers (destination_rl_id) dans les paramètres du guide.');
      return;
    }

    setLoadingLibrary(true);
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/library`);

      if (!res.ok) {
        const errorData = await res.json();
        alert(`Erreur: ${errorData.error}\n${errorData.message || ''}`);
        return;
      }

      const data = await res.json();
      setLibraryData(data.clusters || {});
      setShowLibrary(true);
      
    } catch (error: any) {
      console.error('Erreur chargement bibliothèque:', error);
      alert(`Erreur: ${error.message}`);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const addPoiFromLibrary = async (poi: POI) => {
    try {
      const res = await authFetch(`${apiUrl}/api/v1/guides/${guideId}/pois/add-from-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region_lovers_id: poi.region_lovers_id,
          nom: poi.nom,
          type: poi.type,
          coordinates: poi.coordinates,
          cluster_id: poi.cluster_id,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(`Erreur: ${errorData.error}`);
        return;
      }

      const data = await res.json();
      setPois([...pois, data.poi]);
      alert(`✅ "${poi.nom}" ajouté à la sélection`);
      
    } catch (error: any) {
      console.error('Erreur ajout bibliothèque:', error);
      alert(`Erreur: ${error.message}`);
    }
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'article':
        return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">Article</span>;
      case 'manual':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">Manuel</span>;
      case 'library':
        return <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">Bibliothèque</span>;
      default:
        return null;
    }
  };

  // Filtrer bibliothèque par recherche
  const filterLibrary = (poisList: POI[]) => {
    if (!searchTerm) return poisList;
    return poisList.filter(p => p.nom.toLowerCase().includes(searchTerm.toLowerCase()));
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      {/* Section 1: POIs détectés */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Lieux identifiés</h3>
            <p className="text-sm text-gray-600 mt-1">
              {pois.length} lieu(x) dans la sélection
            </p>
          </div>
          <button
            onClick={generatePoisFromArticles}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="w-5 h-5" />
                🔍 Identifier les lieux dans nos articles
              </>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Chargement...</div>
        ) : pois.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Aucun lieu identifié. Cliquez sur le bouton ci-dessus pour démarrer.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {pois.map((poi) => (
              <div
                key={poi.poi_id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="w-5 h-5 text-gray-400" />
                    <span className="font-medium text-gray-900">{poi.nom}</span>
                    {getSourceBadge(poi.source)}
                    <span className="text-xs text-gray-500 capitalize">{poi.type}</span>
                  </div>
                  {poi.coordinates && (
                    <p className="text-xs text-gray-400 font-mono mt-1 ml-7">
                      📍 {poi.coordinates.lat.toFixed(5)}, {poi.coordinates.lon.toFixed(5)}
                    </p>
                  )}
                  {poi.raison_selection && (
                    <p className="text-xs text-gray-600 mt-1 ml-7">{poi.raison_selection}</p>
                  )}
                </div>
                <button
                  onClick={() => deletePoi(poi.poi_id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Supprimer"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Ajout manuel */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Ajout manuel</h3>
            <p className="text-sm text-gray-600 mt-1">Créer un lieu depuis une page blanche</p>
          </div>
          <button
            onClick={() => setShowManualModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            Créer un lieu manuellement
          </button>
        </div>
      </div>

      {/* Section 3: Bibliothèque Region Lovers */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Bibliothèque Region Lovers</h3>
            <p className="text-sm text-gray-600 mt-1">
              Tous les lieux disponibles pour cette région
            </p>
          </div>
          <button
            onClick={() => (showLibrary ? setShowLibrary(false) : loadLibrary())}
            disabled={loadingLibrary}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {loadingLibrary ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : showLibrary ? (
              <>
                <ChevronUpIcon className="w-5 h-5" />
                Masquer la bibliothèque
              </>
            ) : (
              <>
                <BookOpenIcon className="w-5 h-5" />
                Parcourir la bibliothèque
              </>
            )}
          </button>
        </div>

        {showLibrary && (
          <div className="space-y-4">
            {/* Barre de recherche */}
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un lieu..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Liste groupée par cluster */}
            <div className="max-h-96 overflow-y-auto space-y-4">
              {Object.entries(libraryData).map(([clusterId, poisList]) => {
                const filteredPois = filterLibrary(poisList);
                if (filteredPois.length === 0) return null;

                const clusterName = poisList[0]?.cluster_name || 'Non affecté';

                return (
                  <div key={clusterId} className="border border-gray-200 rounded-lg">
                    <div className="bg-gray-50 px-4 py-2 font-semibold text-gray-700 border-b border-gray-200">
                      🗂️ {clusterName} ({filteredPois.length})
                    </div>
                    <div className="p-2 space-y-1">
                      {filteredPois.map((poi) => {
                        const isAlreadyAdded = pois.some(
                          p => p.region_lovers_id === poi.region_lovers_id
                        );

                        return (
                          <div
                            key={poi.region_lovers_id}
                            className="flex items-center justify-between p-3 hover:bg-gray-50 rounded transition-colors"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{poi.nom}</span>
                                <span className="text-xs text-gray-500 capitalize">{poi.type}</span>
                              </div>
                              {poi.coordinates && (
                                <p className="text-xs text-gray-400 font-mono mt-1">
                                  📍 {poi.coordinates.lat.toFixed(5)}, {poi.coordinates.lon.toFixed(5)}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => addPoiFromLibrary(poi)}
                              disabled={isAlreadyAdded}
                              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                                isAlreadyAdded
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              }`}
                            >
                              {isAlreadyAdded ? '✓ Ajouté' : '+ Ajouter'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal ajout manuel */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Créer un lieu manuellement
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom du lieu *
                </label>
                <input
                  type="text"
                  value={manualForm.nom}
                  onChange={(e) => setManualForm({ ...manualForm, nom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Ex: Tour Eiffel"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={manualForm.type}
                  onChange={(e) => setManualForm({ ...manualForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  <option value="autre">Autre</option>
                  <option value="musée">Musée</option>
                  <option value="site_culturel">Site culturel</option>
                  <option value="village">Village</option>
                  <option value="ville">Ville</option>
                  <option value="plage">Plage</option>
                  <option value="site_naturel">Site naturel</option>
                  <option value="panorama">Panorama</option>
                  <option value="quartier">Quartier</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Latitude (optionnel)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={manualForm.lat}
                    onChange={(e) => setManualForm({ ...manualForm, lat: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="48.8584"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Longitude (optionnel)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={manualForm.lon}
                    onChange={(e) => setManualForm({ ...manualForm, lon: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="2.2945"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowManualModal(false);
                  setManualForm({ nom: '', type: 'autre', lat: '', lon: '' });
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={addManualPoi}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
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
