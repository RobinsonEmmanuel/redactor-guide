'use client';

import { useState, useEffect } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, CheckCircleIcon, DocumentTextIcon, PhotoIcon, SwatchIcon } from '@heroicons/react/24/outline';

interface ExportTabProps {
  guideId: string;
  guide: any;
  apiUrl: string;
}

const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'Anglais',  flag: '🇬🇧' },
  { code: 'de', label: 'Allemand', flag: '🇩🇪' },
  { code: 'it', label: 'Italien',  flag: '🇮🇹' },
  { code: 'es', label: 'Espagnol', flag: '🇪🇸' },
  { code: 'pt-pt', label: 'Portugais', flag: '🇵🇹' },
  { code: 'nl', label: 'Néerlandais', flag: '🇳🇱' },
  { code: 'da', label: 'Danois',   flag: '🇩🇰' },
  { code: 'sv', label: 'Suédois',  flag: '🇸🇪' },
];

const TEMPLATE_COLORS: Record<string, string> = {
  COUVERTURE:                'bg-purple-100 text-purple-700',
  PRESENTATION_GUIDE:        'bg-blue-100 text-blue-700',
  PRESENTATION_DESTINATION:  'bg-blue-100 text-blue-700',
  CARTE_DESTINATION:         'bg-cyan-100 text-cyan-700',
  CLUSTER:                   'bg-orange-100 text-orange-700',
  SECTION_INTRO:             'bg-orange-100 text-orange-700',
  POI:                       'bg-green-100 text-green-700',
  INSPIRATION:               'bg-pink-100 text-pink-700',
  SAISON:                    'bg-yellow-100 text-yellow-700',
  ALLER_PLUS_LOIN:           'bg-gray-100 text-gray-700',
  A_PROPOS_RL:               'bg-gray-100 text-gray-700',
};

export default function ExportTab({ guideId, guide, apiUrl }: ExportTabProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['fr']);
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);

  useEffect(() => {
    loadPreview();
  }, []);

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/export/preview`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } catch (err) {
      console.error('Erreur chargement preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleLanguage = (code: string) => {
    setSelectedLanguages(prev =>
      prev.includes(code) ? prev.filter(l => l !== code) : [...prev, code]
    );
  };

  const downloadExport = async (lang: string) => {
    setDownloading(prev => ({ ...prev, [lang]: true }));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/export?lang=${lang}&download=true`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Erreur export');

      const data = await res.json();
      const destination = data.meta?.destination?.toLowerCase().replace(/\s+/g, '_') || 'guide';
      const year = data.meta?.year || new Date().getFullYear();
      const filename = `guide_${destination}_${year}_${lang}.json`;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setDownloadedFiles(prev => [...prev.filter(f => !f.includes(`_${lang}.json`)), filename]);
    } catch (err) {
      alert(`Erreur lors de l'export en ${lang}`);
    } finally {
      setDownloading(prev => ({ ...prev, [lang]: false }));
    }
  };

  const downloadAllSelected = async () => {
    for (const lang of selectedLanguages) {
      await downloadExport(lang);
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">📦 Export InDesign</h2>
            <p className="text-sm text-gray-500 mt-1">JSON normalisé layout-ready pour data merge</p>
          </div>
          {selectedLanguages.length > 0 && (
            <button
              onClick={downloadAllSelected}
              disabled={Object.values(downloading).some(Boolean)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Exporter {selectedLanguages.length > 1 ? `(${selectedLanguages.length} langues)` : selectedLanguages[0].toUpperCase()}
            </button>
          )}
        </div>

        {/* Stats */}
        {loadingPreview ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-3">
            <ArrowPathIcon className="w-5 h-5 text-gray-400 animate-spin" />
            <span className="text-gray-500 text-sm">Chargement des statistiques...</span>
          </div>
        ) : preview ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
              Contenu disponible à l'export
            </h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{preview.meta.stats.exported}</div>
                <div className="text-xs text-blue-600 mt-1">Pages exportables</div>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <div className="text-2xl font-bold text-amber-700">{preview.meta.stats.excluded_draft}</div>
                <div className="text-xs text-amber-600 mt-1">Brouillons exclus</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{preview.meta.stats.total_pages}</div>
                <div className="text-xs text-green-600 mt-1">Pages totales</div>
              </div>
            </div>

            {/* Répartition par template */}
            {preview.summary_by_template && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.summary_by_template).map(([template, count]) => (
                  <span
                    key={template}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${TEMPLATE_COLORS[template] || 'bg-gray-100 text-gray-700'}`}
                  >
                    {template}
                    <span className="bg-white/60 px-1.5 py-0.5 rounded-full font-bold">{count as number}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Sélection des langues */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Langues à exporter <span className="text-gray-400 font-normal">(un fichier JSON par langue)</span>
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.map(lang => {
              const isSelected = selectedLanguages.includes(lang.code);
              const isDownloading = downloading[lang.code];
              const isDownloaded = downloadedFiles.some(f => f.endsWith(`_${lang.code}.json`));
              return (
                <div key={lang.code} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleLanguage(lang.code)}
                    className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.label}</span>
                    {isDownloaded && <CheckCircleIcon className="w-4 h-4 text-green-500 ml-auto" />}
                  </button>
                  {isSelected && (
                    <button
                      onClick={() => downloadExport(lang.code)}
                      disabled={isDownloading}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                      title={`Exporter ${lang.label}`}
                    >
                      {isDownloading
                        ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        : <ArrowDownTrayIcon className="w-4 h-4" />
                      }
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Structure du JSON */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">
            Structure du fichier JSON
          </h3>
          <div className="space-y-3">
            {[
              {
                icon: <DocumentTextIcon className="w-4 h-4" />,
                color: 'text-blue-600 bg-blue-50',
                title: 'meta',
                desc: 'Nom, destination, année, langue, date export, statistiques (pages exportées / brouillons exclus)',
              },
              {
                icon: <SwatchIcon className="w-4 h-4" />,
                color: 'text-purple-600 bg-purple-50',
                title: 'mappings',
                desc: 'Correspondances field → calque InDesign, picto_layers, picto_values (valeur brute → clé abstraite PICTO_XXX)',
              },
              {
                icon: <DocumentTextIcon className="w-4 h-4" />,
                color: 'text-green-600 bg-green-50',
                title: 'pages[].content.text',
                desc: 'Champs texte et méta indexés par nom de champ (ex: POI_titre_1, POI_meta_duree)',
              },
              {
                icon: <PhotoIcon className="w-4 h-4" />,
                color: 'text-orange-600 bg-orange-50',
                title: 'pages[].content.images',
                desc: 'Images avec url distante + local_filename normalisé (p012_poi_grand_rond.jpg) + local_path',
              },
              {
                icon: <SwatchIcon className="w-4 h-4" />,
                color: 'text-pink-600 bg-pink-50',
                title: 'pages[].content.pictos',
                desc: 'Pictos avec valeur brute (incontournable/oui/50…) + picto_key abstrait (PICTO_SMILEY_3 ou null si non affiché) + calque InDesign',
              },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`p-1.5 rounded-lg flex-shrink-0 ${item.color}`}>
                  {item.icon}
                </div>
                <div>
                  <code className="text-xs font-mono font-semibold text-gray-800">{item.title}</code>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Fichiers téléchargés */}
        {downloadedFiles.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-green-800 mb-2">✅ Fichiers téléchargés</h3>
            <div className="space-y-1">
              {downloadedFiles.map(filename => (
                <div key={filename} className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
                  <code className="font-mono text-xs">{filename}</code>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
