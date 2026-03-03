'use client';

import { useState, useEffect, useRef } from 'react';
import {
  XMarkIcon,
  ArrowPathIcon,
  PhotoIcon,
  LinkIcon,
  ArrowUpTrayIcon,
  InformationCircleIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { StarIcon, CheckCircleIcon } from '@heroicons/react/24/solid';

interface ImageSelectorModalProps {
  guideId: string;
  pageId: string;
  /** Nom du POI de la page courante — active l'onglet "POI de l'article" */
  poiName?: string;
  /** 'page' : images de l'article lié à la page (POI/INSPIRATION)
   *  'guide': toutes les images analysées du guide (autres types) */
  scope?: 'page' | 'guide';
  currentImageUrl?: string;
  apiUrl: string;
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
}

interface ImageItem {
  image_id: string;
  url: string;
  source_article_title?: string;
  source_article_slug?: string;
  poi_names?: string[];
  // Analyse complète
  analysis_summary?: string;
  editorial_relevance?: 'forte' | 'moyenne' | 'faible';
  visual_clarity_score?: number;
  composition_quality_score?: number;
  lighting_quality_score?: number;
  readability_small_screen_score?: number;
  is_iconic_view?: boolean;
  shows_entire_site?: boolean;
  shows_detail?: boolean;
  detail_type?: string;
  is_contextual?: boolean;
  is_composite?: boolean;
  has_text_overlay?: boolean;
  has_graphic_effects?: boolean;
  analyzed_at?: string;
}

type AnalyzedScope = 'poi' | 'page' | 'guide';
type InputMode = 'analyzed' | 'url' | 'upload';
type UploadStep = 'select' | 'uploading' | 'analyzing' | 'tag-poi' | 'done';

interface UploadAnalysis {
  editorial_relevance?: 'forte' | 'moyenne' | 'faible';
  visual_clarity_score?: number;
  composition_quality_score?: number;
  lighting_quality_score?: number;
  readability_small_screen_score?: number;
  is_iconic_view?: boolean;
  shows_entire_site?: boolean;
  is_composite?: boolean;
  has_text_overlay?: boolean;
  analysis_summary?: string;
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-600 w-6 text-right">{pct}%</span>
    </div>
  );
}

function AnalysisPanel({ image, onClose }: { image: ImageItem; onClose: () => void }) {
  const relevanceColor =
    image.editorial_relevance === 'forte'   ? 'bg-green-100 text-green-700 border-green-200' :
    image.editorial_relevance === 'moyenne' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                              'bg-red-100 text-red-700 border-red-200';

  const flags = [
    image.is_iconic_view     && { label: '⭐ Iconique', color: 'bg-purple-100 text-purple-700' },
    image.shows_entire_site  && { label: '🗺 Vue d\'ensemble', color: 'bg-blue-100 text-blue-700' },
    image.shows_detail       && { label: `🔍 Détail${image.detail_type ? ` (${image.detail_type})` : ''}`, color: 'bg-sky-100 text-sky-700' },
    image.is_contextual      && { label: '🌿 Contextuelle', color: 'bg-teal-100 text-teal-700' },
    image.is_composite       && { label: '⚠ Composite', color: 'bg-orange-100 text-orange-700' },
    image.has_text_overlay   && { label: '✏️ Texte incrusté', color: 'bg-orange-100 text-orange-700' },
    image.has_graphic_effects && { label: '🎨 Effets graphiques', color: 'bg-orange-100 text-orange-700' },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div
      className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm rounded-lg p-3 overflow-y-auto flex flex-col gap-2"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Analyse IA</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 transition-colors"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Pertinence éditoriale */}
      <div className={`text-[10px] font-semibold px-2 py-0.5 rounded border w-fit ${relevanceColor}`}>
        Pertinence : {image.editorial_relevance ?? '—'}
      </div>

      {/* Scores */}
      {image.visual_clarity_score !== undefined && (
        <div className="flex flex-col gap-1">
          <ScoreBar value={image.visual_clarity_score}       label="Clarté" />
          <ScoreBar value={image.composition_quality_score!} label="Composition" />
          <ScoreBar value={image.lighting_quality_score!}    label="Lumière" />
          <ScoreBar value={image.readability_small_screen_score!} label="Lisibilité" />
        </div>
      )}

      {/* Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map(f => (
            <span key={f.label} className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${f.color}`}>
              {f.label}
            </span>
          ))}
        </div>
      )}

      {/* Résumé */}
      {image.analysis_summary && (
        <p className="text-[10px] text-gray-600 leading-relaxed">{image.analysis_summary}</p>
      )}

      {/* POIs associés */}
      {image.poi_names && image.poi_names.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100">
          {image.poi_names.map(p => (
            <span key={p} className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImageSelectorModal({
  guideId,
  pageId,
  poiName,
  scope = 'page',
  currentImageUrl,
  apiUrl,
  onSelect,
  onClose,
}: ImageSelectorModalProps) {
  // Onglet par défaut : "poi" si poiName est fourni, sinon scope initial
  const defaultScope: AnalyzedScope = poiName ? 'poi' : scope === 'guide' ? 'guide' : 'page';

  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(currentImageUrl || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'relevance' | 'clarity' | 'composition'>('relevance');
  const [activeScope, setActiveScope] = useState<AnalyzedScope>(defaultScope);
  const [openAnalysisId, setOpenAnalysisId] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<InputMode>('analyzed');
  const [urlInput, setUrlInput] = useState('');
  const [urlPreviewOk, setUrlPreviewOk] = useState<boolean | null>(null);

  // États upload multi-étapes
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('select');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadAnalysis, setUploadAnalysis] = useState<UploadAnalysis | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Sélection POI — initialisé avec le POI de la page
  const [poiTagInput, setPoiTagInput] = useState<string>(poiName ?? '');
  const [taggingPoi, setTaggingPoi] = useState(false);
  // Liste de tous les noms de POIs du guide pour l'autocomplétion
  const [poiSuggestions, setPoiSuggestions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadImages(); }, [activeScope, sortBy]);

  const loadImages = async () => {
    setLoading(true);
    setOpenAnalysisId(null);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      let url: string;
      if (activeScope === 'poi' && poiName) {
        url = `${apiUrl}/api/v1/images/by-poi?poi_name=${encodeURIComponent(poiName)}&sort=${sortBy}`;
      } else if (activeScope === 'guide') {
        url = `${apiUrl}/api/v1/guides/${guideId}/images?sort=${sortBy}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ''}`;
      } else {
        url = `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}/image-analysis`;
      }

      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setImages(data.images || []);
      } else {
        console.error('Erreur chargement images:', res.status);
      }
    } catch (err) {
      console.error('Erreur chargement images:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadImages();
  };

  const handleScopeChange = (newScope: AnalyzedScope) => {
    if (newScope === activeScope) return;
    setSearchQuery('');
    setImages([]);
    setActiveScope(newScope);
  };

  // ── URL externe ──────────────────────────────────────────────────────────────
  const handleUrlChange = (value: string) => {
    setUrlInput(value);
    setUrlPreviewOk(null);
    if (value.trim()) setSelectedImage(value.trim());
    else setSelectedImage(null);
  };

  // ── Upload fichier ───────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setUploadError(null);
    setSelectedImage(null);
    setUploadStep('select');
    setUploadedUrl(null);
    setUploadAnalysis(null);
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    if (file) setUploadPreviewUrl(URL.createObjectURL(file));
    else setUploadPreviewUrl(null);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadError(null);
    setUploadStep('uploading');

    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const form = new FormData();
      form.append('file', uploadFile);

      // L'API upload sur Cloudinary et déclenche l'analyse IA en une seule requête
      setUploadStep('analyzing');
      const res = await fetch(
        `${apiUrl}/api/v1/images/upload?guide_id=${guideId}`,
        {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          credentials: 'include',
          body: form,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Erreur ${res.status}`);
      }

      const data = await res.json();
      setUploadedUrl(data.url);
      setSelectedImage(data.url);
      if (data.analysis) setUploadAnalysis(data.analysis);
      setPoiTagInput(poiName ?? '');
      setUploadStep('tag-poi');

      // Charger la liste des POIs du guide en arrière-plan pour l'autocomplétion
      const t = document.cookie.split('; ').find(r => r.startsWith('accessToken='))?.split('=')[1];
      fetch(`${apiUrl}/api/v1/guides/${guideId}/poi-names`, {
        headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        credentials: 'include',
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.names) setPoiSuggestions(d.names); })
        .catch(() => {});
    } catch (err: any) {
      setUploadError(err.message ?? 'Erreur lors de l\'upload');
      setUploadStep('select');
    }
  };

  const handleTagPoi = async () => {
    if (!uploadedUrl) return;
    const trimmed = poiTagInput.trim();
    if (!trimmed) {
      // Passer l'étape sans taguer
      setUploadStep('done');
      return;
    }
    setTaggingPoi(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];
      await fetch(`${apiUrl}/api/v1/images/tag-poi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ url: uploadedUrl, poi_names: [trimmed] }),
      });
    } catch {
      // Non bloquant
    } finally {
      setTaggingPoi(false);
      setUploadStep('done');
    }
  };

  // ── Sélection finale ─────────────────────────────────────────────────────────
  const handleSelect = () => {
    if (selectedImage) {
      onSelect(selectedImage);
      onClose();
    }
  };

  const scopeLabel: Record<AnalyzedScope, string> = {
    poi:   'POI de l\'article',
    page:  'Article lié',
    guide: 'Toute la destination',
  };

  const emptyMessage: Record<AnalyzedScope, string> = {
    poi:   poiName
      ? `Aucune image encore associée à "${poiName}". Générez la page une première fois pour peupler cet onglet.`
      : 'Aucun POI défini pour cette page.',
    page:  'Les images de l\'article n\'ont pas encore été analysées',
    guide: searchQuery
      ? `Aucune image trouvée pour "${searchQuery}"`
      : 'Aucune image analysée pour cette destination',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <PhotoIcon className="h-6 w-6" />
              <div>
                <h2 className="text-xl font-semibold">Sélectionner une image</h2>
                <p className="text-sm text-purple-100 mt-0.5">
                  {inputMode === 'analyzed'
                    ? `${images.length} image${images.length !== 1 ? 's' : ''}${activeScope === 'guide' && searchQuery ? ` · "${searchQuery}"` : ''}`
                    : inputMode === 'url'
                    ? 'Coller une URL d\'image'
                    : 'Charger depuis l\'ordinateur'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-white hover:text-purple-100 transition-colors">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Onglets de mode saisie */}
          <div className="flex bg-white/10 rounded-lg p-0.5 w-fit mb-3">
            <button
              onClick={() => { setInputMode('analyzed'); setSelectedImage(null); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                inputMode === 'analyzed' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
              }`}
            >
              <PhotoIcon className="h-4 w-4" />
              Images analysées
            </button>
            <button
              onClick={() => { setInputMode('url'); setSelectedImage(urlInput.trim() || null); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                inputMode === 'url' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
              }`}
            >
              <LinkIcon className="h-4 w-4" />
              URL externe
            </button>
            <button
              onClick={() => { setInputMode('upload'); setSelectedImage(null); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                inputMode === 'upload' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
              }`}
            >
              <ArrowUpTrayIcon className="h-4 w-4" />
              Mon ordinateur
            </button>
          </div>

          {/* Filtres scope / recherche (onglet analysées uniquement) */}
          {inputMode === 'analyzed' && (
            <div className="flex flex-col gap-2">
              <div className="flex bg-white/10 rounded-lg p-0.5 w-fit">
                {/* Onglet POI — affiché uniquement si poiName est fourni */}
                {poiName && (
                  <button
                    onClick={() => handleScopeChange('poi')}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeScope === 'poi' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
                    }`}
                  >
                    <MapPinIcon className="h-3.5 w-3.5" />
                    POI de l&apos;article
                  </button>
                )}
                <button
                  onClick={() => handleScopeChange('page')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeScope === 'page' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
                  }`}
                >
                  Article lié
                </button>
                <button
                  onClick={() => handleScopeChange('guide')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeScope === 'guide' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
                  }`}
                >
                  Toute la destination
                </button>
              </div>

              {/* Tri + recherche (scope guide et poi) */}
              {(activeScope === 'guide' || activeScope === 'poi') && (
                <div className="flex gap-2">
                  {activeScope === 'guide' && (
                    <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Filtrer par article source..."
                        className="flex-1 px-3 py-1.5 rounded-lg text-sm text-gray-900 bg-white/90 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50"
                      />
                      <button type="submit" className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors">
                        Filtrer
                      </button>
                    </form>
                  )}
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as typeof sortBy)}
                    className="px-2 py-1.5 rounded-lg text-sm text-gray-900 bg-white/90 focus:outline-none"
                  >
                    <option value="relevance">Pertinence</option>
                    <option value="clarity">Clarté</option>
                    <option value="composition">Composition</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">

          {/* ── URL externe ─────────────────────────────────────────────────── */}
          {inputMode === 'url' && (
            <div className="max-w-xl mx-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL de l&apos;image
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => handleUrlChange(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  L&apos;image sera téléchargée depuis cette URL lors de la génération du ZIP InDesign.
                </p>
              </div>
              {urlInput.trim() && (
                <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                  <div className="aspect-video flex items-center justify-center">
                    <img
                      src={urlInput.trim()}
                      alt="Aperçu"
                      className="max-w-full max-h-full object-contain"
                      referrerPolicy="no-referrer"
                      onLoad={() => setUrlPreviewOk(true)}
                      onError={() => setUrlPreviewOk(false)}
                    />
                  </div>
                  {urlPreviewOk === false && (
                    <p className="text-xs text-red-600 text-center p-2">
                      Image inaccessible — l&apos;URL sera quand même conservée.
                    </p>
                  )}
                  {urlPreviewOk === true && (
                    <p className="text-xs text-green-600 text-center p-2">Aperçu OK</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Upload fichier ──────────────────────────────────────────────── */}
          {inputMode === 'upload' && (
            <div className="max-w-xl mx-auto space-y-4">

              {/* Étape 1 : sélection + bouton upload */}
              {(uploadStep === 'select' || uploadStep === 'uploading' || uploadStep === 'analyzing') && (
                <>
                  <div
                    onClick={() => uploadStep === 'select' && fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                      uploadStep === 'select'
                        ? 'border-gray-300 cursor-pointer hover:border-purple-400 hover:bg-purple-50'
                        : 'border-gray-200 cursor-default bg-gray-50'
                    }`}
                  >
                    <ArrowUpTrayIcon className="h-10 w-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-700">
                      {uploadFile ? uploadFile.name : 'Cliquer pour choisir un fichier'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">JPG, PNG, WEBP, GIF — max 15 Mo</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>

                  {uploadPreviewUrl && uploadStep === 'select' && (
                    <div className="rounded-lg overflow-hidden border border-gray-200 aspect-video flex items-center justify-center bg-gray-50">
                      <img src={uploadPreviewUrl} alt="Aperçu" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}

                  {uploadError && (
                    <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{uploadError}</p>
                  )}

                  <button
                    onClick={handleUpload}
                    disabled={!uploadFile || uploadStep !== 'select'}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    {uploadStep === 'uploading' && (
                      <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Upload sur Cloudinary…</>
                    )}
                    {uploadStep === 'analyzing' && (
                      <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Analyse IA en cours…</>
                    )}
                    {uploadStep === 'select' && (
                      <><ArrowUpTrayIcon className="h-4 w-4" /> Uploader et analyser</>
                    )}
                  </button>
                </>
              )}

              {/* Étape 2 : résultat analyse + choix POI */}
              {(uploadStep === 'tag-poi' || uploadStep === 'done') && uploadedUrl && (
                <div className="space-y-4">
                  {/* Aperçu + analyse */}
                  <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <div className="aspect-video flex items-center justify-center overflow-hidden">
                      <img
                        src={uploadedUrl}
                        alt="Image uploadée"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    {uploadAnalysis && (
                      <div className="p-3 bg-white border-t border-gray-100 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-600">Analyse IA</p>
                          {uploadAnalysis.editorial_relevance && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              uploadAnalysis.editorial_relevance === 'forte'
                                ? 'bg-green-100 text-green-700'
                                : uploadAnalysis.editorial_relevance === 'moyenne'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              Pertinence : {uploadAnalysis.editorial_relevance}
                            </span>
                          )}
                        </div>
                        {uploadAnalysis.visual_clarity_score !== undefined && (
                          <div className="flex flex-col gap-1">
                            <ScoreBar value={uploadAnalysis.visual_clarity_score}       label="Clarté" />
                            <ScoreBar value={uploadAnalysis.composition_quality_score!} label="Composition" />
                            <ScoreBar value={uploadAnalysis.lighting_quality_score!}    label="Lumière" />
                            <ScoreBar value={uploadAnalysis.readability_small_screen_score!} label="Lisibilité" />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {uploadAnalysis.is_iconic_view     && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">⭐ Iconique</span>}
                          {uploadAnalysis.shows_entire_site  && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">🗺 Vue d'ensemble</span>}
                          {uploadAnalysis.is_composite       && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">⚠ Composite</span>}
                          {uploadAnalysis.has_text_overlay   && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">✏️ Texte incrusté</span>}
                        </div>
                        {uploadAnalysis.analysis_summary && (
                          <p className="text-[10px] text-gray-500 leading-relaxed">{uploadAnalysis.analysis_summary}</p>
                        )}
                      </div>
                    )}
                    {!uploadAnalysis && (
                      <p className="text-xs text-gray-500 text-center p-2">
                        Analyse IA non disponible — image prête à être utilisée.
                      </p>
                    )}
                  </div>

                  {/* Sélection POI */}
                  {uploadStep === 'tag-poi' && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <MapPinIcon className="h-4 w-4 text-indigo-600 shrink-0" />
                        <p className="text-sm font-semibold text-indigo-800">
                          Associer à un POI
                        </p>
                      </div>
                      <p className="text-xs text-indigo-600">
                        Cette association permettra de retrouver l&apos;image depuis l&apos;onglet &laquo; POI de l&apos;article &raquo;.
                      </p>
                      <input
                        type="text"
                        list="poi-suggestions"
                        value={poiTagInput}
                        onChange={e => setPoiTagInput(e.target.value)}
                        placeholder="Nom du POI (ex: Piscines Naturelles Los Abrigos)"
                        className="w-full px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                        autoComplete="off"
                      />
                      {poiSuggestions.length > 0 && (
                        <datalist id="poi-suggestions">
                          {poiSuggestions.map(name => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleTagPoi}
                          disabled={taggingPoi}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-300 text-sm font-medium"
                        >
                          {taggingPoi
                            ? <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Association…</>
                            : <><CheckCircleIcon className="h-4 w-4" /> Confirmer</>}
                        </button>
                        <button
                          onClick={() => setUploadStep('done')}
                          className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm transition-colors"
                        >
                          Passer
                        </button>
                      </div>
                    </div>
                  )}

                  {uploadStep === 'done' && (
                    <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg flex items-center gap-2">
                      <CheckCircleIcon className="w-4 h-4 shrink-0" />
                      Image prête — cliquez sur &laquo; Sélectionner &raquo; pour l&apos;utiliser.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Images analysées ────────────────────────────────────────────── */}
          {inputMode === 'analyzed' && (
            loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <ArrowPathIcon className="h-12 w-12 text-purple-600 mx-auto mb-4 animate-spin" />
                  <p className="text-gray-600">Chargement des images…</p>
                  {activeScope === 'poi' && poiName && (
                    <p className="text-sm text-gray-400 mt-1">Photos de « {poiName} »</p>
                  )}
                </div>
              </div>
            ) : images.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center max-w-sm">
                  <PhotoIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">Aucune image disponible</p>
                  <p className="text-sm text-gray-500">{emptyMessage[activeScope]}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {images.map((image, index) => {
                  const isSelected = selectedImage === image.url;
                  const isCurrent  = image.url === currentImageUrl;
                  const analysisOpen = openAnalysisId === (image.image_id || String(index));
                  const hasAnalysis  = !!(image.editorial_relevance || image.analysis_summary);

                  return (
                    <div
                      key={image.image_id || index}
                      onClick={() => { setSelectedImage(image.url); setOpenAnalysisId(null); }}
                      className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                        isSelected
                          ? 'border-purple-600 ring-2 ring-purple-300 shadow-lg scale-105'
                          : 'border-gray-200 hover:border-purple-400 hover:shadow-md'
                      }`}
                    >
                      {/* ── Panneau analyse (overlay) ─── */}
                      {analysisOpen && (
                        <AnalysisPanel
                          image={image}
                          onClose={() => setOpenAnalysisId(null)}
                        />
                      )}

                      {/* ── Picto sélectionné ─── */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 z-10 bg-purple-600 text-white rounded-full p-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}

                      {/* ── Badge "Actuelle" ─── */}
                      {isCurrent && (
                        <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded">
                          Actuelle
                        </div>
                      )}

                      {/* ── Bouton détail analyse ─── */}
                      {hasAnalysis && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setOpenAnalysisId(prev =>
                              prev === (image.image_id || String(index)) ? null : (image.image_id || String(index))
                            );
                          }}
                          title="Voir l'analyse IA"
                          className={`absolute bottom-2 right-2 z-10 p-1 rounded-full transition-colors ${
                            analysisOpen
                              ? 'bg-purple-600 text-white'
                              : 'bg-black/50 text-white hover:bg-purple-600'
                          }`}
                        >
                          <InformationCircleIcon className="h-4 w-4" />
                        </button>
                      )}

                      {/* ── Badge iconique ─── */}
                      {image.is_iconic_view && !isCurrent && (
                        <div className="absolute top-2 left-2 z-10">
                          <span className="flex items-center gap-0.5 bg-purple-600/90 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                            <StarIcon className="h-3 w-3" /> Iconique
                          </span>
                        </div>
                      )}

                      {/* ── Source article (scope guide/poi) ─── */}
                      {activeScope !== 'page' && image.source_article_title && !image.is_iconic_view && (
                        <div className="absolute bottom-2 left-2 right-8 z-10">
                          <span className="block text-[9px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded truncate">
                            {image.source_article_title}
                          </span>
                        </div>
                      )}

                      {/* ── Miniature ─── */}
                      <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                        <img
                          src={image.url}
                          alt={image.analysis_summary || `Image ${index + 1}`}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center gap-2 p-2 bg-gray-50">
                                <svg class="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span class="text-[10px] text-gray-400 text-center break-all line-clamp-2">Image non accessible</span>
                              </div>`;
                            }
                          }}
                        />
                      </div>

                      {/* ── Badge pertinence (bas de carte, hors overlay) ─── */}
                      {!analysisOpen && image.editorial_relevance && (
                        <div className="px-2 py-1.5 bg-white border-t border-gray-100 flex items-center justify-between gap-1">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            image.editorial_relevance === 'forte'   ? 'bg-green-100 text-green-700' :
                            image.editorial_relevance === 'moyenne' ? 'bg-yellow-100 text-yellow-700' :
                                                                      'bg-red-100 text-red-700'
                          }`}>
                            {image.editorial_relevance}
                          </span>
                          {image.visual_clarity_score !== undefined && (
                            <span className="text-[10px] text-gray-400">
                              ✦ {Math.round(image.visual_clarity_score * 100)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex gap-3 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedImage}
            className="flex-1 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {selectedImage === currentImageUrl ? 'Conserver cette image' : 'Sélectionner'}
          </button>
        </div>
      </div>
    </div>
  );
}
