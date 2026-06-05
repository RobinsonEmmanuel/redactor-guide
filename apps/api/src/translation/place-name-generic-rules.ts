/**
 * Règles de localisation des mots génériques dans les toponymes POI.
 * Une règle par langue cible — le nom propre vernaculaire est conservé.
 *
 * Principe Region Lovers (destinations hispanophones → guide EN) :
 *   « Church of Nuestra Señora de la Concepción »
 *   jamais « Iglesia Nuestra Señora… » en anglais.
 */

/** Mots génériques FR/ES/PT à ne jamais laisser tels quels dans la langue cible (sauf si cible = vernaculaire). */
export const VERNACULAR_GENERIC_PREFIXES = [
  'iglesia', 'ermita', 'catedral', 'basílica', 'basilica', 'capilla',
  'église', 'eglise', 'cathédrale', 'cathedrale', 'chapelle',
  'igreja', 'sé', 'se ', 'capela',
  'museo', 'musée', 'museu',
  'palacio', 'palais', 'palácio',
  'torre', 'tour', 'tower',
  'castillo', 'château', 'castelo',
  'playa', 'plage', 'praia',
  'mercado', 'marché', 'mercado',
  'jardín', 'jardin', 'jardim',
  'piscinas naturales', 'piscines naturelles',
  'sendero', 'sentier', 'trilho',
];

export interface GenericToponymRuleSet {
  /** Formule obligatoire quand générique + nom propre */
  pattern: string;
  /** Mots génériques interdits dans la sortie (langue cible) */
  forbidden_in_output: string[];
  /** Exemples avant → après */
  examples: string[];
  /** Note sur l'usage du nom OSM cible */
  osm_usage: string;
}

const EN_RULES: GenericToponymRuleSet = {
  pattern: '[English generic] + "of" + [vernacular proper name unchanged]',
  forbidden_in_output: [
    'Iglesia', 'Ermita', 'Catedral', 'Basílica', 'Capilla',
    'Église', 'Eglise', 'Cathédrale', 'Cathedrale',
    'Museo', 'Palacio', 'Torre de la', 'Castillo',
    'Playa', 'Mercado', 'Jardín', 'Piscinas naturales', 'Sendero',
  ],
  examples: [
    'Église Nuestra Señora de la Concepción → Church of Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Church of San Francisco',
    'Cathédrale de La Laguna → Cathedral of La Laguna (or La Laguna Cathedral if shorter)',
    'Piscines naturelles Charco Los Chochos → Charco Los Chochos Natural Pools',
    'Tour de la Concepción → Tower of the Conception (keep La Orotava qualifier in parentheses if present)',
    'Double Église San Francisco (Puerto de la Cruz) → Church of San Francisco (Puerto de la Cruz)',
  ],
  osm_usage:
    'If OSM name:en starts with a Spanish/French generic (Iglesia, Catedral…), REPLACE the generic with the English equivalent and use "of" — do NOT copy Iglesia into English output.',
};

const DE_RULES: GenericToponymRuleSet = {
  pattern: '[Deutsches Genericum] + "von" / "der" + [Eigenname unverändert]',
  forbidden_in_output: ['Iglesia', 'Église', 'Church of', 'Playa'],
  examples: [
    'Église Nuestra Señora de la Concepción → Kirche Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Kirche von San Francisco',
    'Piscines naturelles Charco Los Chochos → Charco Los Chochos Naturpools',
  ],
  osm_usage:
    'OSM name:de verwenden wenn vorhanden; spanische/französische Generika (Iglesia, Église) immer ins Deutsche übersetzen.',
};

const IT_RULES: GenericToponymRuleSet = {
  pattern: '[generico italiano] + "di" / "del" + [nome proprio invariato]',
  forbidden_in_output: ['Iglesia', 'Église', 'Church of', 'Kirche'],
  examples: [
    'Église Nuestra Señora de la Concepción → Chiesa di Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Chiesa di San Francisco',
  ],
  osm_usage:
    'Usare name:it OSM se disponibile; tradurre sempre i generici FR/ES in italiano (Chiesa, Cattedrale…).',
};

const NL_RULES: GenericToponymRuleSet = {
  pattern: '[Nederlands generiek] + "van" + [eigennaam ongewijzigd]',
  forbidden_in_output: ['Iglesia', 'Église', 'Church of'],
  examples: [
    'Église Nuestra Señora de la Concepción → Kerk van Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Kerk van San Francisco',
  ],
  osm_usage:
    'Gebruik OSM name:nl indien beschikbaar; vertaal FR/ES generieken naar het Nederlands.',
};

const DA_RULES: GenericToponymRuleSet = {
  pattern: '[dansk generisk] + "af" + [egennavn uændret]',
  forbidden_in_output: ['Iglesia', 'Église', 'Church of'],
  examples: [
    'Église Nuestra Señora de la Concepción → Kirke af Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Kirke af San Francisco',
  ],
  osm_usage: 'Brug OSM name:da hvis tilgængelig; oversæt FR/ES generika til dansk.',
};

const SV_RULES: GenericToponymRuleSet = {
  pattern: '[svenskt generiskt] + "av" + [egennamn oförändrat]',
  forbidden_in_output: ['Iglesia', 'Église', 'Church of'],
  examples: [
    'Église Nuestra Señora de la Concepción → Kyrka av Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Kyrka av San Francisco',
  ],
  osm_usage: 'Använd OSM name:sv om tillgängligt; översätt FR/ES generiska ord till svenska.',
};

const PT_PT_RULES: GenericToponymRuleSet = {
  pattern: '[genérico português] + "de" + [nome próprio]',
  forbidden_in_output: ['Église', 'Church of', 'Iglesia'],
  examples: [
    'Église Nuestra Señora de la Concepción → Igreja de Nuestra Señora de la Concepción',
    'Iglesia de San Francisco → Igreja de São Francisco (ou manter San Francisco se nome local)',
  ],
  osm_usage: 'Usar name:pt OSM se existir; traduzir genericos FR para português europeu.',
};

/** ES cible sur destination ES : conserver le vernaculaire espagnol. */
const ES_RULES: GenericToponymRuleSet = {
  pattern: '[genérico español] + nombre propio (mantener forma española oficial)',
  forbidden_in_output: ['Église', 'Church of', 'Kirche', 'Eglise'],
  examples: [
    'Église Nuestra Señora de la Concepción → Iglesia de Nuestra Señora de la Concepción',
    'Double Église San Francisco → Iglesia de San Francisco',
  ],
  osm_usage: 'Priorizar name:es o nombre local OSM; traducir solo el genérico francés.',
};

const RULES_BY_TARGET: Record<string, GenericToponymRuleSet> = {
  en:     EN_RULES,
  de:     DE_RULES,
  it:     IT_RULES,
  es:     ES_RULES,
  'pt-pt': PT_PT_RULES,
  nl:     NL_RULES,
  da:     DA_RULES,
  sv:     SV_RULES,
};

/**
 * Règles explicites de localisation des génériques pour une langue cible.
 * Si vernacular === target (ex. es→es), les génériques restent en vernaculaire.
 */
export function buildGenericToponymRules(
  targetLang: string,
  vernacularLang: string
): string {
  if (targetLang === vernacularLang) {
    return `
Vernacular target language (${targetLang}): keep official local generic words (Iglesia, Playa, Mercado…).
Only translate French editorial generics (Église → Iglesia, Piscines naturelles → Piscinas naturales…).
Never mix French generic words in the output.`;
  }

  const rules = RULES_BY_TARGET[targetLang];
  if (!rules) {
    return `
Always translate generic/descriptive words into the target language.
Never leave French (${vernacularLang === 'fr' ? 'or foreign' : ''}) generic words untranslated.
Keep vernacular proper nouns (Spanish/Arabic/Portuguese names) unchanged.`;
  }

  const forbidden = rules.forbidden_in_output.map(w => `"${w}"`).join(', ');
  const examples = rules.examples.map(e => `  • ${e}`).join('\n');

  return `
MANDATORY generic-word rule (apply consistently to EVERY place name — no exceptions):
- Pattern: ${rules.pattern}
- NEVER leave these words in the output: ${forbidden}
- ${rules.osm_usage}
- OSM local names are references for the PROPER NOUN part only — generic words MUST be in the target language

Examples (follow this pattern exactly):
${examples}`;
}
