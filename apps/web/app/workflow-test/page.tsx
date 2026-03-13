'use client';

import { useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MergedField {
  field_id: string;
  section_id: string;
  key: string; // "section_id.field_id"
  val1: any;
  val2: any;
  identical: boolean;
  isText: boolean; // champ validable par Perplexity
}

interface ValidatedElement {
  element: string;
  confidence: number;
  source_types: string[];
  sources: { type: string; url: string }[];
  short_reason: string;
}

interface FieldValidation {
  validated: ValidatedElement[];
  uncertain: { element: string; reason: string }[];
  rejected:  { element: string; reason: string }[];
  grounding_sources: { uri: string; display_name: string }[];
  loading?: boolean;
  error?: string;
}

interface FieldRewrite {
  rewritten: string[];
  loading?: boolean;
  error?: string;
}

// ─── Prompt templates ────────────────────────────────────────────────────────

const VALIDATE_PROMPT_TEMPLATE = `You are a factual verification agent responsible for validating tourism data.

Your role is NOT to generate new information.
Your role is ONLY to evaluate candidate elements using reliable web sources.

We are building a structured tourism database.
Each element must be validated by reliable sources before being stored.

====================
INPUT
====================

Place:
{{PLACE_NAME}}

Field being validated:
{{FIELD_NAME}}

Candidate elements (generated from multiple sources):
{{LIST_OF_CANDIDATES}}

These candidates may come from:
- Draft database values
- Gemini model
- Perplexity model

Your task is to verify which elements are factually supported by reliable sources.

====================
SOURCING RULES
====================

Search information systematically in multiple languages:
- the local language of the place
- English
- French

Prioritize sources according to the following hierarchy:

1. Official website of the place or institution (official)
2. Official tourism organizations, UNESCO, public authorities (institutional)
3. Major international media or recognized travel guides (media_high)
4. Credible local media (media_local)
5. Commercial tourism websites or specialized blogs (commercial)

User-generated content (reviews, forums, aggregators) must never be used alone to validate information (ugc).

====================
VALIDATION RULES
====================

An element can be considered VALIDATED if:
- it is confirmed by the official website
OR
- it is confirmed by at least two independent reliable sources.

If sources contradict each other:
- prioritize the most official source
- prioritize the most recent information
- indicate uncertainty if the contradiction cannot be resolved.

If the element is not supported by credible sources, classify it as REJECTED.

If evidence is weak or ambiguous, classify it as UNCERTAIN.

Do NOT invent new elements.
Do NOT modify the candidate wording.

====================
OUTPUT FORMAT
====================

Return STRICT JSON.

{
  "validated": [
    {
      "element": "...",
      "confidence": 0.0-1.0,
      "source_types": ["official", "institutional", "media_high", "media_local", "commercial"],
      "sources": [
        {
          "type": "...",
          "url": "..."
        }
      ],
      "short_reason": "..."
    }
  ],
  "uncertain": [
    {
      "element": "...",
      "reason": "..."
    }
  ],
  "rejected": [
    {
      "element": "...",
      "reason": "..."
    }
  ]
}

====================
IMPORTANT RULES
====================

- Do NOT add elements that are not in the candidate list.
- Only evaluate the candidates.
- Prefer factual descriptions rather than promotional marketing language.
- When possible, rely on official or institutional sources.`;

const REWRITE_PROMPT_TEMPLATE = `You are a controlled rewriting agent.

Your task is to rewrite validated tourism information clearly and concisely.

You must ONLY use the elements provided below.

Do NOT introduce any new information.
Do NOT infer missing details.
Do NOT add examples or interpretations.

====================
INPUT
====================

Place:
{{PLACE}}

Field:
{{FIELD}}

Validated elements:
{{VALIDATED_ELEMENTS}}

====================
TASK
====================

Rewrite the validated elements into a clear and concise description.

Rules:
- Use only the information contained in the validated elements.
- Do not add new activities, locations, or facts.
- Do not infer or generalize.
- If an element is unclear, keep its wording close to the original.
- Prefer neutral factual wording.

====================
OUTPUT
====================

Return a structured list of elements.

Each element must correspond to one validated element.

Do not add or remove elements.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderPrompt(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`{{${k}}}`, 'g'), v),
    template
  );
}

function isTextValue(val: any): boolean {
  if (typeof val === 'string') return val.trim().length > 0;
  if (Array.isArray(val)) return val.some(v => typeof v === 'string');
  return false;
}

function flattenValue(val: any): string {
  if (Array.isArray(val)) return val.join(', ');
  return String(val ?? '');
}

function mergeJsons(j1: any, j2: any): MergedField[] {
  const fields: MergedField[] = [];
  for (const section1 of j1.sections ?? []) {
    const section2 = (j2.sections ?? []).find((s: any) => s.section_id === section1.section_id) ?? { fields: [] };
    for (const f1 of section1.fields ?? []) {
      const f2 = (section2.fields ?? []).find((f: any) => f.field_id === f1.field_id);
      const v1 = f1.value;
      const v2 = f2?.value ?? null;
      fields.push({
        field_id:   f1.field_id,
        section_id: section1.section_id,
        key:        `${section1.section_id}.${f1.field_id}`,
        val1:       v1,
        val2:       v2,
        identical:  JSON.stringify(v1) === JSON.stringify(v2),
        isText:     isTextValue(v1) || isTextValue(v2),
      });
    }
  }
  return fields;
}

function reconstructJson(original: any, fields: MergedField[], rewrites: Record<string, FieldRewrite>): any {
  const result = JSON.parse(JSON.stringify(original));
  for (const section of result.sections ?? []) {
    for (const field of section.fields ?? []) {
      const key = `${section.section_id}.${field.field_id}`;
      const rw = rewrites[key];
      if (rw?.rewritten?.length) {
        field.value = Array.isArray(field.value) ? rw.rewritten : rw.rewritten[0];
      }
    }
  }
  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
      done   ? 'bg-green-100 text-green-700' :
      active ? 'bg-blue-100 text-blue-700' :
               'bg-gray-100 text-gray-400'
    }`}>
      {done
        ? <CheckCircleIcon className="w-4 h-4" />
        : <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-500'}`}>{n}</span>
      }
      {label}
    </div>
  );
}

function CandidateBadge({ val }: { val: any }) {
  if (val === null || val === undefined) return <span className="text-gray-300 italic text-xs">absent</span>;
  const s = flattenValue(val);
  return (
    <span className="font-mono text-xs bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded max-w-xs truncate inline-block" title={s}>
      {s}
    </span>
  );
}

function ExpandableRow({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
        {open ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
        {label}
      </button>
      {open && <div className="mt-1 ml-4">{children}</div>}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function WorkflowTestPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  // Inputs
  const [placeName, setPlaceName]  = useState('');
  const [json1Text, setJson1Text]  = useState('');
  const [json2Text, setJson2Text]  = useState('');
  const [parseError, setParseError] = useState('');

  // Workflow state
  const [step, setStep]                   = useState(0); // 0=inputs, 1=merged, 2=validation, 3=rewrite, 4=final
  const [mergedFields, setMergedFields]   = useState<MergedField[]>([]);
  const [parsedJ1, setParsedJ1]           = useState<any>(null);
  const [validations, setValidations]     = useState<Record<string, FieldValidation>>({});
  const [rewrites, setRewrites]           = useState<Record<string, FieldRewrite>>({});
  const [finalJson, setFinalJson]         = useState<any>(null);
  const [processing, setProcessing]       = useState(false);
  const [copied, setCopied]               = useState(false);

  // ── Step 1: Merge ──────────────────────────────────────────────────────────
  const handleMerge = useCallback(() => {
    setParseError('');
    try {
      const j1 = JSON.parse(json1Text);
      const j2 = JSON.parse(json2Text);
      setParsedJ1(j1);
      setMergedFields(mergeJsons(j1, j2));
      setValidations({});
      setRewrites({});
      setFinalJson(null);
      setStep(1);
    } catch (e: any) {
      setParseError(`JSON invalide : ${e.message}`);
    }
  }, [json1Text, json2Text]);

  // ── Step 2: Validate with Perplexity ──────────────────────────────────────
  const handleValidate = useCallback(async () => {
    setProcessing(true);
    const fieldsToValidate = mergedFields.filter(f => !f.identical && f.isText);
    const newValidations: Record<string, FieldValidation> = {};

    // Init loading states
    for (const f of fieldsToValidate) {
      newValidations[f.key] = { validated: [], uncertain: [], rejected: [], grounding_sources: [], loading: true };
    }
    setValidations({ ...newValidations });

    for (const field of fieldsToValidate) {
      const candidates: string[] = [
        flattenValue(field.val1),
        flattenValue(field.val2),
      ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);

      const candidatesList = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
      const rendered = renderPrompt(VALIDATE_PROMPT_TEMPLATE, {
        PLACE_NAME:         placeName || 'Unknown place',
        FIELD_NAME:         field.field_id,
        LIST_OF_CANDIDATES: candidatesList,
      });

      try {
        const res = await fetch(`${apiUrl}/api/v1/workflow/validate`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rendered_prompt: rendered }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        newValidations[field.key] = { ...data, loading: false };
      } catch (err: any) {
        newValidations[field.key] = { validated: [], uncertain: [], rejected: [], grounding_sources: [], loading: false, error: err.message };
      }
      setValidations({ ...newValidations });
    }

    setProcessing(false);
    setStep(2);
  }, [mergedFields, placeName, apiUrl]);

  // ── Step 3: Rewrite with OpenAI ───────────────────────────────────────────
  const handleRewrite = useCallback(async () => {
    setProcessing(true);
    const newRewrites: Record<string, FieldRewrite> = {};

    const fieldsWithValidated = Object.entries(validations).filter(([, v]) => v.validated.length > 0);

    for (const [key, v] of fieldsWithValidated) newRewrites[key] = { rewritten: [], loading: true };
    setRewrites({ ...newRewrites });

    for (const [key, val] of fieldsWithValidated) {
      const fieldId = key.split('.').pop() ?? key;
      const validatedList = val.validated.map((e, i) => `${i + 1}. ${e.element}`).join('\n');
      const rendered = renderPrompt(REWRITE_PROMPT_TEMPLATE, {
        PLACE:              placeName || 'Unknown place',
        FIELD:              fieldId,
        VALIDATED_ELEMENTS: validatedList,
      });

      try {
        const res = await fetch(`${apiUrl}/api/v1/workflow/rewrite`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rendered_prompt: rendered }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        newRewrites[key] = { rewritten: data.rewritten ?? [], loading: false };
      } catch (err: any) {
        newRewrites[key] = { rewritten: [], loading: false, error: err.message };
      }
      setRewrites({ ...newRewrites });
    }

    setProcessing(false);
    setStep(3);
  }, [validations, placeName, apiUrl]);

  // ── Step 4: Reconstruct JSON ──────────────────────────────────────────────
  const handleReconstruct = useCallback(() => {
    const result = reconstructJson(parsedJ1, mergedFields, rewrites);
    setFinalJson(result);
    setStep(4);
  }, [parsedJ1, mergedFields, rewrites]);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(finalJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─────────────────────────────────────────────────────────────────────────

  const diffFields    = mergedFields.filter(f => !f.identical && f.isText);
  const identFields   = mergedFields.filter(f => f.identical);
  const validatedCount = Object.values(validations).reduce((n, v) => n + v.validated.length, 0);
  const uncertainCount = Object.values(validations).reduce((n, v) => n + v.uncertain.length, 0);
  const rejectedCount  = Object.values(validations).reduce((n, v) => n + v.rejected.length, 0);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-5xl mx-auto p-6 space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workflow de validation — Test</h1>
            <p className="text-sm text-gray-500 mt-1">Fusion → Vérification Perplexity → Réécriture OpenAI → JSON final</p>
          </div>

          {/* Stepper */}
          <div className="flex flex-wrap gap-2">
            {[
              'Saisie',
              'Fusion',
              'Validation Perplexity',
              'Réécriture OpenAI',
              'JSON final',
            ].map((label, i) => (
              <StepBadge key={i} n={i + 1} label={label} active={step === i} done={step > i} />
            ))}
          </div>

          {/* ── STEP 0 : Inputs ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Paramètres</h2>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Nom du lieu (PLACE_NAME)</label>
              <input
                type="text"
                value={placeName}
                onChange={e => setPlaceName(e.target.value)}
                placeholder="ex : Muséum d'Histoire Naturelle du Havre"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'JSON 1 (source A)', val: json1Text, set: setJson1Text },
                { label: 'JSON 2 (source B)', val: json2Text, set: setJson2Text },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                  <textarea
                    value={val}
                    onChange={e => set(e.target.value)}
                    rows={16}
                    spellCheck={false}
                    placeholder='{"block_id":"...","sections":[...]}'
                    className="w-full font-mono text-xs border border-gray-300 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              ))}
            </div>

            {parseError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <XCircleIcon className="w-4 h-4" /> {parseError}
              </p>
            )}

            <button
              onClick={handleMerge}
              disabled={!json1Text.trim() || !json2Text.trim()}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
            >
              Étape 1 — Fusionner les JSON
            </button>
          </div>

          {/* ── STEP 1 : Merged result ── */}
          {step >= 1 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Étape 1 — Résultat de la fusion</h2>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span className="text-red-600 font-medium">{diffFields.length} champ(s) différents</span>
                  <span className="text-gray-400">{identFields.length} identiques</span>
                </div>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {mergedFields.map(f => (
                  <div key={f.key} className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm ${f.identical ? 'bg-gray-50' : 'bg-amber-50 border border-amber-100'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600">{f.field_id}</code>
                        <span className="text-xs text-gray-400">{f.section_id}</span>
                        {f.identical && <span className="text-xs text-green-600">identique</span>}
                        {!f.isText && !f.identical && <span className="text-xs text-gray-400 italic">non textuel</span>}
                      </div>
                      {!f.identical && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          <span className="text-xs text-gray-500">A:</span> <CandidateBadge val={f.val1} />
                          <span className="text-xs text-gray-500">B:</span> <CandidateBadge val={f.val2} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {step === 1 && (
                <button
                  onClick={handleValidate}
                  disabled={processing || diffFields.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  {processing && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                  Valider — Étape 2 : Vérification Perplexity ({diffFields.length} champs)
                </button>
              )}
            </div>
          )}

          {/* ── STEP 2 : Perplexity validation ── */}
          {step >= 2 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Étape 2 — Résultats Perplexity Sonar</h2>
                <div className="flex gap-3 text-xs font-medium">
                  <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded-full">{validatedCount} validés</span>
                  <span className="text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">{uncertainCount} incertains</span>
                  <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded-full">{rejectedCount} rejetés</span>
                </div>
              </div>

              <div className="space-y-3">
                {mergedFields.filter(f => !f.identical && f.isText).map(f => {
                  const v = validations[f.key];
                  if (!v) return null;
                  return (
                    <div key={f.key} className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{f.field_id}</code>
                        {v.loading && <ArrowPathIcon className="w-4 h-4 animate-spin text-blue-500" />}
                        {!v.loading && !v.error && (
                          <span className="text-xs text-gray-400">
                            {v.validated.length}V / {v.uncertain.length}? / {v.rejected.length}✗
                          </span>
                        )}
                        {v.error && <span className="text-xs text-red-500">{v.error}</span>}
                      </div>

                      {!v.loading && !v.error && (
                        <div className="space-y-2">
                          {v.validated.map((el, i) => (
                            <div key={i} className="bg-green-50 border border-green-100 rounded-lg p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2 flex-1">
                                  <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                  <p className="text-sm text-gray-800">{el.element}</p>
                                </div>
                                <ConfidenceBar value={el.confidence} />
                              </div>
                              <ExpandableRow label={`Sources (${el.sources.length}) · ${el.short_reason}`}>
                                <div className="space-y-1">
                                  {el.sources.map((s, j) => (
                                    <a key={j} href={s.url} target="_blank" rel="noopener noreferrer"
                                       className="text-xs text-blue-600 hover:underline block truncate"
                                    >{s.type} — {s.url}</a>
                                  ))}
                                </div>
                              </ExpandableRow>
                            </div>
                          ))}

                          {v.uncertain.map((el, i) => (
                            <div key={i} className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                              <div className="flex items-start gap-2">
                                <ExclamationTriangleIcon className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-sm text-gray-800">{el.element}</p>
                                  <p className="text-xs text-yellow-700 mt-0.5">{el.reason}</p>
                                </div>
                              </div>
                            </div>
                          ))}

                          {v.rejected.map((el, i) => (
                            <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3">
                              <div className="flex items-start gap-2">
                                <XCircleIcon className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-sm text-gray-800 line-through opacity-60">{el.element}</p>
                                  <p className="text-xs text-red-700 mt-0.5">{el.reason}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {step === 2 && (
                <button
                  onClick={handleRewrite}
                  disabled={processing || validatedCount === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  {processing && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                  Valider — Étape 3 : Réécriture OpenAI ({validatedCount} éléments)
                </button>
              )}
            </div>
          )}

          {/* ── STEP 3 : OpenAI rewrite ── */}
          {step >= 3 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">Étape 3 — Réécriture OpenAI</h2>

              <div className="space-y-3">
                {Object.entries(rewrites).map(([key, rw]) => {
                  const fieldId = key.split('.').pop() ?? key;
                  return (
                    <div key={key} className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{fieldId}</code>
                        {rw.loading && <ArrowPathIcon className="w-4 h-4 animate-spin text-blue-500" />}
                        {rw.error && <span className="text-xs text-red-500">{rw.error}</span>}
                      </div>
                      {!rw.loading && rw.rewritten.length > 0 && (
                        <ul className="space-y-1">
                          {rw.rewritten.map((el, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircleIcon className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                              <span className="text-sm text-gray-800">{el}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              {step === 3 && (
                <button
                  onClick={handleReconstruct}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Valider — Étape 4 : Reconstruire le JSON final
                </button>
              )}
            </div>
          )}

          {/* ── STEP 4 : Final JSON ── */}
          {step >= 4 && finalJson && (
            <div className="bg-white rounded-xl border border-green-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <CheckCircleIcon className="w-5 h-5 text-green-600" />
                  Étape 4 — JSON final reconstruit
                </h2>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                  {copied ? 'Copié !' : 'Copier'}
                </button>
              </div>
              <pre className="text-xs font-mono bg-gray-50 rounded-lg p-4 overflow-auto max-h-96 border border-gray-100">
                {JSON.stringify(finalJson, null, 2)}
              </pre>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
