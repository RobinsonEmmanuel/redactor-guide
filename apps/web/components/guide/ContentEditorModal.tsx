'use client';

import { useState, useEffect, useRef } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon, PhotoIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import ImageAnalysisModal from './ImageAnalysisModal';
import ImageSelectorModal from './ImageSelectorModal';

interface Template {
  _id: string;
  name: string;
  info_source?: string;
  fields: TemplateField[];
}

interface SubField {
  name: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta';
  label?: string;
  ai_instructions?: string;
}

interface LinkPartConfig {
  ai_instructions?: string;
  default_value?: string;
  skip_ai?: boolean;
}

interface TemplateField {
  name: string;
  type: 'titre' | 'texte' | 'image' | 'lien' | 'meta' | 'liste' | 'picto' | 'repetitif';
  label: string;
  description?: string;
  ai_instructions?: string;
  max_chars?: number;
  options?: string[];
  sub_fields?: SubField[];
  max_repetitions?: number;
  link_label?: LinkPartConfig;
  link_url?: LinkPartConfig;
}

// Labels et icônes pour les valeurs de picto
const PICTO_OPTION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  incontournable: { label: 'Incontournable', icon: '😄', color: 'bg-green-100 border-green-400 text-green-800' },
  interessant:    { label: 'Intéressant',    icon: '😊', color: 'bg-blue-100 border-blue-400 text-blue-800' },
  a_voir:         { label: 'À voir',         icon: '🙂', color: 'bg-gray-100 border-gray-400 text-gray-700' },
  '100':          { label: 'Accessible 100%', icon: '♿', color: 'bg-green-100 border-green-400 text-green-800' },
  '50':           { label: 'Partiellement',   icon: '♿', color: 'bg-yellow-100 border-yellow-400 text-yellow-800' },
  '0':            { label: 'Non accessible',  icon: '🚫', color: 'bg-red-100 border-red-400 text-red-800' },
  oui:            { label: 'Oui',             icon: '✅', color: 'bg-green-100 border-green-400 text-green-800' },
  non:            { label: 'Non',             icon: '❌', color: 'bg-gray-100 border-gray-400 text-gray-600' },
};

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_id: string;
  template_name?: string;
  type_de_page?: string;
  ordre: number;
  url_source?: string;
}

// ─── RichTextArea ──────────────────────────────────────────────────────────────
// Textarea enrichi avec des boutons de style compatibles avec le script InDesign.
//
// Marqueurs :
//   **texte**  → style "Gras"        (caractère gras)
//   {texte}    → style "Orange"      (couleur #f39428)
//   ^texte^    → style "Chiffre"     (taille 18pt)
//   ~texte~    → style "Gras-orange" (gras + couleur #f39428)

interface RichTextAreaProps {
  value: string;
  onChange: (val: string) => void;
  rows?: number;
  className?: string;
}

function RichTextArea({ value, onChange, rows = 4, className }: RichTextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const applyStyle = (open: string, close: string) => {
    const ta = ref.current;
    if (!ta) return;

    const start    = ta.selectionStart;
    const end      = ta.selectionEnd;
    if (start === end) return;

    const selected = value.slice(start, end);
    let newValue: string;
    let newStart: number;
    let newEnd:   number;

    // Toggle : déjà stylé → retirer les marqueurs
    if (selected.startsWith(open) && selected.endsWith(close) &&
        selected.length > open.length + close.length) {
      const inner = selected.slice(open.length, -close.length);
      newValue = value.slice(0, start) + inner + value.slice(end);
      newStart = start;
      newEnd   = start + inner.length;
    } else {
      newValue = value.slice(0, start) + open + selected + close + value.slice(end);
      newStart = start + open.length;
      newEnd   = end   + open.length;
    }

    onChange(newValue);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.setSelectionRange(newStart, newEnd);
        ref.current.focus();
      }
    });
  };

  return (
    <div>
      {/* Barre d'outils */}
      <div className="flex items-center gap-1.5 mb-1">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); applyStyle('**', '**'); }}
          title="Gras — style InDesign &quot;Gras&quot;"
          className="px-2 py-0.5 text-sm font-bold border border-gray-300 rounded hover:bg-gray-100 active:bg-gray-200 transition-colors select-none"
        >
          G
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); applyStyle('{', '}'); }}
          title="Orange — style InDesign &quot;Orange&quot; (#f39428)"
          className="px-2 py-0.5 text-sm font-bold border rounded hover:opacity-80 active:opacity-60 transition-colors select-none"
          style={{ color: '#f39428', borderColor: '#f39428', backgroundColor: '#fff8f0' }}
        >
          O
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); applyStyle('^', '^'); }}
          title="Chiffre — style InDesign &quot;Chiffre&quot; (18pt)"
          className="px-2 py-0.5 border border-purple-400 rounded text-purple-700 bg-purple-50 hover:bg-purple-100 active:bg-purple-200 transition-colors select-none font-semibold"
          style={{ fontSize: '15px' }}
        >
          C
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); applyStyle('~', '~'); }}
          title="Gras-orange — style InDesign &quot;Gras-orange&quot; (gras + #f39428)"
          className="px-2 py-0.5 text-sm font-bold border rounded hover:opacity-80 active:opacity-60 transition-colors select-none"
          style={{ color: '#f39428', borderColor: '#f39428', backgroundColor: '#fff8f0', fontWeight: 900 }}
        >
          GO
        </button>
        <span className="text-xs text-gray-400 ml-1">
          Sélectionner du texte puis <strong>G</strong> gras · <span style={{ color: '#f39428' }}>O</span> orange · <span className="text-purple-600">C</span> chiffre · <span style={{ color: '#f39428', fontWeight: 900 }}>GO</span> gras-orange
        </span>
      </div>

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={className}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ContentEditorModalProps {
  page: Page;
  template: Template | null;
  content: Record<string, any>;
  onClose: () => void;
  onSave: (content: Record<string, any>) => void;
  onGenerationStarted?: () => void; // ✅ Callback pour recharger les pages après lancement génération
  guideId: string;
  apiUrl: string;
}

export default function ContentEditorModal({
  page,
  template,
  content,
  onClose,
  onSave,
  onGenerationStarted,
  guideId,
  apiUrl,
}: ContentEditorModalProps) {
  const [formData, setFormData] = useState<Record<string, any>>(content || {});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImageAnalysis, setShowImageAnalysis] = useState(false);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [currentImageField, setCurrentImageField] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<any | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  // Map field name → résultat de validation pour accès rapide inline
  const validationByField: Record<string, any> = {};
  if (validationReport?.results) {
    for (const r of validationReport.results) validationByField[r.field] = r;
  }

  useEffect(() => {
    setFormData(content || {});
  }, [content]);

  const handleValidateContent = async () => {
    setValidating(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/validate-content`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: formData, poi_name: page.titre }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        setValidationReport(data);
        setShowValidation(true);
      } else {
        setError(data.error || 'Erreur lors de la validation');
      }
    } catch (err) {
      setError('Erreur lors de la validation Perplexity');
    } finally {
      setValidating(false);
    }
  };

  // POI et INSPIRATION nécessitent un article source ; les autres types génèrent
  // depuis le contexte général du site WordPress.
  const requiresUrlForGeneration = ['poi', 'inspiration'].includes(
    (page.type_de_page ?? page.template_name ?? '').toLowerCase()
  );

  const handleGenerateContent = async () => {
    if (requiresUrlForGeneration && !page.url_source) {
      setError('Aucun article WordPress source associé à cette page. Veuillez lier un article via les paramètres de la page.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      console.log('🤖 Lancement génération contenu (analyse images incluse)...');
      
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/generate-content`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      const data = await res.json();

      if (res.ok) {
        if (data.content) {
          // Génération synchrone (dev) : contenu immédiat
          setFormData(data.content);
          alert('✅ Contenu généré avec succès !');
        } else if (data.async) {
          // Génération asynchrone (prod) : via worker
          console.log('🤖 Génération IA lancée en arrière-plan');
          
          // Appeler le callback pour recharger les pages
          if (onGenerationStarted) {
            onGenerationStarted();
          }
          
          // Fermer la modal
          onClose();
          
          // Notifier l'utilisateur (moins intrusif qu'avant)
          console.log('✅ Modal fermée, polling activé pour suivi auto');
        }
      } else {
        const errorMsg = data.details ? `${data.error}\n\nDétails: ${data.details}` : data.error;
        setError(errorMsg);
        console.error('Erreur serveur:', data);
      }
    } catch (err: any) {
      console.error('Erreur génération:', err);
      setError('Erreur lors de la génération du contenu');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleOpenImageSelector = (fieldName: string) => {
    setCurrentImageField(fieldName);
    setShowImageSelector(true);
  };

  const handleImageSelected = (imageUrl: string) => {
    if (currentImageField) {
      handleFieldChange(currentImageField, imageUrl);
    }
  };

  const getCharacterCount = (fieldName: string, maxChars?: number) => {
    const value = formData[fieldName] || '';
    // Les marqueurs de style ne comptent pas dans la longueur finale InDesign
    const count = String(value).replace(/\*\*|\{|\}|\^|~/g, '').length;
    if (!maxChars) return null;
    const percentage = (count / maxChars) * 100;
    const color = percentage > 100 ? 'text-red-600' : percentage > 90 ? 'text-orange-600' : 'text-gray-500';
    return (
      <span className={`text-xs ${color}`}>
        {count} / {maxChars}
      </span>
    );
  };

  // ─── Badge catégorie de source ──────────────────────────────────────────────
  const SOURCE_TYPE_CFG: Record<string, { label: string; color: string }> = {
    official:      { label: 'Officiel',      color: 'bg-emerald-100 text-emerald-700' },
    institutional: { label: 'Institutionnel', color: 'bg-teal-100 text-teal-700' },
    media_high:    { label: 'Presse inter.', color: 'bg-blue-100 text-blue-700' },
    media_local:   { label: 'Presse locale', color: 'bg-sky-100 text-sky-700' },
    commercial:    { label: 'Commercial',    color: 'bg-amber-100 text-amber-700' },
    ugc:           { label: 'Avis/forum',    color: 'bg-gray-100 text-gray-500' },
  };

  const SourceTypeBadge = ({ type }: { type?: string }) => {
    if (!type) return null;
    const cfg = SOURCE_TYPE_CFG[type];
    if (!cfg) return null;
    return (
      <span className={`ml-1 text-[10px] font-medium px-1 py-px rounded ${cfg.color}`}>
        {cfg.label}
      </span>
    );
  };

  // ─── Bloc validation compact par champ ─────────────────────────────────────

  const FieldValidationBlock = ({ fieldName }: { fieldName: string }) => {
    const v = validationByField[fieldName];
    if (!v) return null;

    const hasInvalid = (v.invalid_points?.length ?? 0) > 0;
    const hasValidated = (v.validated_points?.length ?? 0) > 0;
    const hasArticle = v.article_consistency && v.article_consistency !== 'not_checked';
    const allValid = v.status === 'valid' && !hasInvalid;

    const borderColor = hasInvalid
      ? 'border-l-red-400'
      : v.status === 'uncertain'
      ? 'border-l-amber-400'
      : 'border-l-emerald-400';

    const ARTICLE_CFG: Record<string, { label: string; color: string }> = {
      present: { label: 'Présent dans l\'article',  color: 'text-teal-600' },
      partial: { label: 'Approximatif vs article',  color: 'text-purple-600' },
      absent:  { label: 'Absent de l\'article',     color: 'text-slate-500' },
    };

    return (
      <div className={`mt-2 border-l-2 pl-3 py-1 text-xs space-y-1 ${borderColor}`}>

        {/* Ligne cohérence article */}
        {hasArticle && (() => {
          const cfg = ARTICLE_CFG[v.article_consistency!];
          if (!cfg) return null;
          return (
            <p className={`${cfg.color} leading-snug`} title={v.article_comment || undefined}>
              <span className="font-medium">Article :</span> {cfg.label}
              {v.article_excerpt && (
                <span className="text-gray-400 italic"> — "{v.article_excerpt}"</span>
              )}
            </p>
          );
        })()}

        {/* Points validés */}
        {hasValidated && v.validated_points!.map((p: any, i: number) => (
          <div key={i} className="flex items-start gap-1.5 text-emerald-700 leading-snug">
            <span className="flex-shrink-0 font-bold mt-0.5">✓</span>
            <span>
              {p.point}
              <SourceTypeBadge type={p.source_type} />
              {p.source_display && (
                p.source_url
                  ? <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                      className="ml-1 text-gray-400 hover:text-blue-500 hover:underline">{p.source_display}</a>
                  : <span className="ml-1 text-gray-400">{p.source_display}</span>
              )}
            </span>
          </div>
        ))}

        {/* Points invalides */}
        {hasInvalid && v.invalid_points!.map((p: any, i: number) => (
          <div key={i} className="flex items-start gap-1.5 text-red-700 leading-snug">
            <span className="flex-shrink-0 font-bold mt-0.5">✗</span>
            <span className="flex-1">
              {p.point}
              {p.correction && (
                <span className="ml-1">
                  <span className="text-gray-500">→</span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange(fieldName, p.correction)}
                    className="ml-1 font-semibold text-red-800 underline decoration-dotted hover:decoration-solid cursor-pointer"
                    title="Cliquer pour appliquer cette correction"
                  >
                    {p.correction}
                  </button>
                </span>
              )}
              <SourceTypeBadge type={p.source_type} />
              {p.source_display && (
                p.source_url
                  ? <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                      className="ml-1 text-gray-400 hover:text-blue-500 hover:underline">{p.source_display}</a>
                  : <span className="ml-1 text-gray-400">{p.source_display}</span>
              )}
            </span>
          </div>
        ))}

        {/* Incertain sans points détaillés */}
        {!hasValidated && !hasInvalid && v.comment && (
          <p className="text-gray-500 leading-snug">{v.comment}</p>
        )}
      </div>
    );
  };

  // Badge minimal dans le label (juste le statut)
  const ValidationBadge = ({ fieldName }: { fieldName: string }) => {
    const v = validationByField[fieldName];
    if (!v) return null;
    const hasInvalid = (v.invalid_points?.length ?? 0) > 0;
    const cfg = (hasInvalid || v.status === 'invalid')
      ? { bg: 'bg-red-100 text-red-700', label: 'Incorrect' }
      : v.status === 'uncertain'
      ? { bg: 'bg-amber-100 text-amber-700', label: 'Incertain' }
      : { bg: 'bg-emerald-100 text-emerald-700', label: 'Valide' };
    return (
      <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${cfg.bg}`}>
        {cfg.label}
      </span>
    );
  };

  // ────────────────────────────────────────────────────────────────────────────

  const renderField = (field: TemplateField) => {
    const fieldValue = formData[field.name] || '';

    switch (field.type) {
      case 'titre':
        const isTitleOverLimit = field.max_chars && fieldValue.length > field.max_chars;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              <ValidationBadge fieldName={field.name} />
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isTitleOverLimit 
                  ? 'border-red-500 bg-red-50 text-red-900' 
                  : validationByField[field.name]?.status === 'invalid' ? 'border-red-400'
                  : validationByField[field.name]?.status === 'uncertain' ? 'border-amber-400'
                  : 'border-gray-300'
              }`}
            />
            <FieldValidationBlock fieldName={field.name} />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isTitleOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Titre en dépassement de {fieldValue.length - field.max_chars!} caractères
              </p>
            )}
          </div>
        );

      case 'texte': {
        const plainLength = String(fieldValue).replace(/\*\*|\{|\}|\^/g, '').length;
        const isOverLimit = field.max_chars ? plainLength > field.max_chars : false;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              <ValidationBadge fieldName={field.name} />
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <RichTextArea
              value={fieldValue}
              onChange={(val) => handleFieldChange(field.name, val)}
              rows={4}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isOverLimit
                  ? 'border-red-500 bg-red-50 text-red-900'
                  : validationByField[field.name]?.status === 'invalid' ? 'border-red-400'
                  : validationByField[field.name]?.status === 'uncertain' ? 'border-amber-400'
                  : 'border-gray-300'
              }`}
            />
            <FieldValidationBlock fieldName={field.name} />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Texte en dépassement de {plainLength - field.max_chars!} caractères
              </p>
            )}
          </div>
        );
      }

      case 'image':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            
            <div className="flex gap-2">
              <input
                type="text"
                value={fieldValue}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                placeholder="URL de l'image ou chemin local"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => handleOpenImageSelector(field.name)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                title="Choisir parmi les images analysées"
              >
                <PhotoIcon className="h-5 w-5" />
                Choisir
              </button>
            </div>

            {fieldValue && (
              <div
                className="mt-3 relative group cursor-pointer inline-block"
                onClick={() => handleOpenImageSelector(field.name)}
              >
                <img
                  src={fieldValue}
                  alt={field.label}
                  className="max-h-48 rounded-lg border border-gray-200 shadow-sm group-hover:opacity-80 transition-opacity block"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const container = target.parentElement;
                    if (container) {
                      const placeholder = document.createElement('div');
                      placeholder.className = 'flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors';
                      placeholder.innerHTML = `
                        <svg class="w-8 h-8 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <div>
                          <p class="text-xs font-medium text-gray-700">Image non prévisualisable</p>
                          <p class="text-[11px] text-gray-400 mt-0.5 break-all line-clamp-1">${fieldValue}</p>
                          <p class="text-[11px] text-purple-600 mt-1">Cliquer pour changer →</p>
                        </div>
                      `;
                      container.appendChild(placeholder);
                    }
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all rounded-lg pointer-events-none">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                    <PhotoIcon className="h-4 w-4" />
                    Changer l'image
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'lien': {
        // Détecter si la valeur est un objet structuré {label, url} ou une URL simple
        const isSplitLink = !!(field.link_label || field.link_url);
        let linkLabelVal = '';
        let linkUrlVal   = '';
        let isStructured = false;

        if (typeof fieldValue === 'object' && fieldValue !== null && 'url' in fieldValue) {
          // Objet déjà parsé
          isStructured  = true;
          linkLabelVal  = fieldValue.label ?? '';
          linkUrlVal    = fieldValue.url   ?? '';
        } else if (typeof fieldValue === 'string' && fieldValue.startsWith('{')) {
          // String JSON
          try {
            const parsed = JSON.parse(fieldValue);
            if ('url' in parsed) {
              isStructured = true;
              linkLabelVal = parsed.label ?? '';
              linkUrlVal   = parsed.url   ?? '';
            }
          } catch { /* pas du JSON valide → URL simple */ }
        }

        if (!isStructured && !isSplitLink) {
          // ── Lien simple (comportement legacy) ─────────────────────────────
          return (
            <div key={field.name} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
              </label>
              {field.description && <p className="text-xs text-gray-500 mb-2">{field.description}</p>}
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">🔗</span>
                <input
                  type="url"
                  value={isStructured ? linkUrlVal : (typeof fieldValue === 'string' ? fieldValue : '')}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 border border-orange-200 rounded-lg bg-orange-50/20 focus:ring-2 focus:ring-orange-400 focus:border-transparent text-sm"
                />
              </div>
            </div>
          );
        }

        // ── Lien structuré : deux champs séparés ──────────────────────────
        const handleLinkPartChange = (part: 'label' | 'url', val: string) => {
          const next = { label: linkLabelVal, url: linkUrlVal, [part]: val };
          handleFieldChange(field.name, next);
        };

        const previewUrl = linkUrlVal || (isStructured ? '' : (typeof fieldValue === 'string' ? fieldValue : ''));

        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            {field.description && <p className="text-xs text-gray-500 mb-2">{field.description}</p>}

            <div className="rounded-xl border border-orange-200 bg-orange-50/30 overflow-hidden">
              {/* Intitulé */}
              <div className="px-4 pt-3 pb-2">
                <label className="block text-xs font-semibold text-orange-700 mb-1 uppercase tracking-wide">
                  Intitulé
                </label>
                <input
                  type="text"
                  value={linkLabelVal}
                  onChange={(e) => handleLinkPartChange('label', e.target.value)}
                  placeholder="Ex : En savoir plus →"
                  className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg bg-white focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                />
              </div>

              {/* Divider */}
              <div className="border-t border-orange-100 mx-4" />

              {/* URL */}
              <div className="px-4 pt-2 pb-3">
                <label className="block text-xs font-semibold text-orange-700 mb-1 uppercase tracking-wide">
                  URL
                </label>
                <input
                  type="url"
                  value={linkUrlVal}
                  onChange={(e) => handleLinkPartChange('url', e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg bg-white focus:ring-2 focus:ring-orange-400 focus:border-transparent font-mono"
                />
              </div>

              {/* Aperçu */}
              {(linkLabelVal || previewUrl) && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-orange-100 text-sm">
                    <span className="text-orange-400">🔗</span>
                    {previewUrl ? (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate"
                      >
                        {linkLabelVal || previewUrl}
                      </a>
                    ) : (
                      <span className="text-gray-500 truncate">{linkLabelVal}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'meta':
        const isMetaOverLimit = field.max_chars && fieldValue.length > field.max_chars;
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              <ValidationBadge fieldName={field.name} />
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="Valeur courte et normée"
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isMetaOverLimit
                  ? 'border-red-500 bg-red-50 text-red-900'
                  : validationByField[field.name]?.status === 'invalid' ? 'border-red-400'
                  : validationByField[field.name]?.status === 'uncertain' ? 'border-amber-400'
                  : 'border-gray-300'
              }`}
            />
            <FieldValidationBlock fieldName={field.name} />
            {field.max_chars && (
              <div className="mt-1 text-right">
                {getCharacterCount(field.name, field.max_chars)}
              </div>
            )}
            {isMetaOverLimit && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                ⚠️ Métadonnée en dépassement de {fieldValue.length - field.max_chars!} caractères
              </p>
            )}
          </div>
        );

      case 'liste':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              <ValidationBadge fieldName={field.name} />
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <textarea
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              rows={Math.max(3, (fieldValue || '').split('\n').filter(Boolean).length + 1)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">Un élément par ligne</p>
            <FieldValidationBlock fieldName={field.name} />
          </div>
        );

      case 'picto':
        return (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              <ValidationBadge fieldName={field.name} />
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            {field.options && field.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {field.options.map((option) => {
                  const config = PICTO_OPTION_CONFIG[option] || { label: option, icon: '●', color: 'bg-gray-100 border-gray-300 text-gray-700' };
                  const isSelected = fieldValue === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleFieldChange(field.name, option)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                        isSelected
                          ? `${config.color} shadow-sm scale-105`
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                      }`}
                    >
                      <span className="text-base">{config.icon}</span>
                      <span>{config.label}</span>
                      {isSelected && <span className="ml-1">✓</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={fieldValue}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            )}
            {!fieldValue && (
              <p className="mt-1 text-xs text-amber-600">⚠️ Valeur non renseignée</p>
            )}
            <FieldValidationBlock fieldName={field.name} />
          </div>
        );

      case 'repetitif': {
        // La valeur est un tableau d'objets (ou une string JSON brute de l'IA)
        let items: Record<string, string>[] = [];
        try {
          const raw = formData[field.name];
          items = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
        } catch { items = []; }

        const subFields = field.sub_fields ?? [];
        const maxRep = field.max_repetitions ?? 20;

        const updateItems = (next: Record<string, string>[]) => {
          handleFieldChange(field.name, next);
        };

        return (
          <div key={field.name} className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                {field.label || field.name}
                <span className="ml-2 text-xs font-normal text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full">
                  répétitif · {items.length}/{maxRep}
                </span>
              </label>
              {items.length < maxRep && (
                <button
                  type="button"
                  onClick={() => {
                    const blank = subFields.reduce((acc: Record<string, string>, sf) => { acc[sf.name] = ''; return acc; }, {});
                    updateItems([...items, blank]);
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-600 border border-rose-300 rounded-md hover:bg-rose-50"
                >
                  + Ajouter
                </button>
              )}
            </div>
            {field.description && (
              <p className="text-xs text-gray-500 mb-3">{field.description}</p>
            )}

            {items.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-rose-200 rounded-lg text-xs text-gray-400">
                Aucune entrée — génère le contenu par IA ou clique sur "+ Ajouter"
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="border border-rose-100 rounded-lg overflow-hidden">
                    {/* Header de l'entrée */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-rose-50 border-b border-rose-100">
                      <span className="text-xs font-medium text-rose-700">Entrée {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => updateItems(items.filter((_, i) => i !== idx))}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        ✕ Supprimer
                      </button>
                    </div>
                    {/* Sous-champs */}
                    <div className="p-3 grid grid-cols-1 gap-2">
                      {subFields.map((sf) => (
                        <div key={sf.name} className="flex items-start gap-2">
                          <label className="text-xs text-gray-500 w-24 shrink-0 pt-2">
                            {sf.label || sf.name}
                            <span className="block font-mono text-gray-400 text-[10px]">{sf.type}</span>
                          </label>
                          {sf.type === 'image' ? (
                            <div className="flex-1 flex gap-2 items-center">
                              <input
                                type="text"
                                value={item[sf.name] || ''}
                                onChange={(e) => {
                                  const next = [...items];
                                  next[idx] = { ...item, [sf.name]: e.target.value };
                                  updateItems(next);
                                }}
                                placeholder="https://…"
                                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md"
                              />
                              {item[sf.name] && (
                                <img src={item[sf.name]} alt="" className="h-8 w-8 object-cover rounded border" onError={(e) => (e.currentTarget.style.display = 'none')} />
                              )}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={item[sf.name] || ''}
                              onChange={(e) => {
                                const next = [...items];
                                next[idx] = { ...item, [sf.name]: e.target.value };
                                updateItems(next);
                              }}
                              placeholder={sf.type === 'lien' ? 'https://…' : `${sf.label || sf.name}…`}
                              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6">
          <p className="text-gray-600">Template introuvable</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* ── Header compact ────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-white flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            {/* Titre */}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">Rédaction de la page</h2>
              <p className="text-sm text-blue-100 mt-0.5 truncate">
                {page.titre} • Template : {template.name}
              </p>
            </div>

            {/* Actions + fermer sur la même ligne */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleGenerateContent}
                disabled={generating || (requiresUrlForGeneration && !page.url_source)}
                title={generating ? 'Génération en cours…' : 'Générer le contenu automatiquement'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {generating
                  ? <><ArrowPathIcon className="h-4 w-4 animate-spin" /><span className="hidden sm:inline">Génération…</span></>
                  : <><SparklesIcon className="h-4 w-4" /><span className="hidden sm:inline">Générer</span></>}
              </button>

              {page.url_source && (
                <button
                  type="button"
                  onClick={() => setShowImageAnalysis(true)}
                  title="Voir les analyses d'images"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg transition-colors text-sm"
                >
                  <PhotoIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Images</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleValidateContent}
                disabled={validating || Object.keys(formData).length === 0}
                title={validating ? 'Vérification en cours…' : 'Contrôler le contenu'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/80 hover:bg-emerald-500 border border-emerald-400/40 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {validating
                  ? <><ArrowPathIcon className="h-4 w-4 animate-spin" /><span className="hidden sm:inline">Contrôle…</span></>
                  : <><ShieldCheckIcon className="h-4 w-4" /><span className="hidden sm:inline">Contrôler</span></>}
              </button>

              <button onClick={onClose} className="ml-1 text-white/70 hover:text-white transition-colors">
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Avertissement URL manquante */}
          {requiresUrlForGeneration && !page.url_source && (
            <p className="text-xs text-white/70 mt-2">⚠️ Article WordPress source requis pour ce type de page</p>
          )}

          {/* Erreur */}
          {error && (
            <div className="mt-2 px-3 py-2 bg-red-500/20 border border-red-300/30 rounded text-xs text-white">
              {error}
            </div>
          )}
        </div>

        {/* ── Zone scrollable : résumé validation + formulaire ──────────────── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto">

          {/* Champs du formulaire */}
          <div className="px-6 py-6 max-w-3xl mx-auto">
            {template.fields.map((field) => renderField(field))}
          </div>
        </form>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="border-t border-gray-200 px-6 py-4 flex gap-3 bg-gray-50 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Enregistrer le contenu
          </button>
        </div>
      </div>

      {/* Modal d'analyse des images */}
      {showImageAnalysis && (
        <ImageAnalysisModal
          guideId={guideId}
          pageId={page._id}
          apiUrl={apiUrl}
          onClose={() => setShowImageAnalysis(false)}
        />
      )}

      {/* Modal de sélection d'images */}
      {showImageSelector && currentImageField && (
        <ImageSelectorModal
          guideId={guideId}
          pageId={page._id}
          scope={
            // "Ne s'applique pas" → toutes les images analysées de la destination
            template?.info_source === 'non_applicable' ||
            template?.info_source === 'tous_articles_site' ||
            template?.info_source === 'tous_articles_et_llm'
              ? 'guide'
              : page.url_source
              ? 'page'
              : 'guide'
          }
          currentImageUrl={formData[currentImageField]}
          apiUrl={apiUrl}
          onSelect={handleImageSelected}
          onClose={() => {
            setShowImageSelector(false);
            setCurrentImageField(null);
          }}
        />
      )}
    </div>
  );
}
