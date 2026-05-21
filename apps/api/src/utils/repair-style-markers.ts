/**
 * Répare les marqueurs ** cassés par le LLM ou la traduction.
 *
 * 1) Ouverture décalée : « vous t**o choose** » → « vous **to choose** »
 *    (lettre minuscule collée avant **, segment interne commence par une voyelle,
 *    au moins 3 caractères — évite « x**bold** »).
 *
 * 2) Fermeture trop tôt avant « and » : « **Teide a**nd » → « **Teide** and »
 */

const INNER_STARTS_WITH_VOWEL = /^[aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿæœ]/i;

/** Lettre « orpheline » juste avant ** (début de mot mal placé). */
function repairStrandedBoldOpen(text: string): string {
  const re = /(^|[\s\n\r"'“”«»().,;:!?\-—–])([a-z\u00E0-\u024F])\*\*([^*\r\n]+?)\*\*/gmu;
  return text.replace(re, (full, sep, letter, inner) => {
    if (typeof inner !== 'string' || inner.length < 3) return full;
    if (!INNER_STARTS_WITH_VOWEL.test(inner)) return full;
    return `${sep}**${letter}${inner}**`;
  });
}

/** « a**nd » rattaché au gras alors que « and » doit être hors marqueurs. */
function repairSplitWordAndAfterBold(text: string): string {
  return text.replace(/\*\*([^*]+?)\s+a\*\*(nd)\b/gi, '**$1** and');
}

/**
 * Le `**` de fermeture coupe un mot : « **Mudejar st**yle » → « **Mudejar style** »
 * Aussi : « **paths lined with gr**eenery » → « **paths lined with greenery** »
 * Règle : si des lettres minuscules suivent immédiatement `**` de fermeture (sans espace),
 * elles font partie du même mot → les réintégrer dans le bloc gras.
 */
function repairSplitWordClosingBold(text: string): string {
  return text.replace(/\*\*([^*\r\n]+?)\*\*([a-z\u00C0-\u024F]+)/g, '**$1$2**');
}

export function repairStrandedBoldMarkers(text: string): string {
  if (!text || !text.includes('**')) return text;
  let out = text;
  for (let i = 0; i < 12; i++) {
    const step = repairSplitWordClosingBold(
      repairSplitWordAndAfterBold(repairStrandedBoldOpen(out))
    );
    if (step === out) break;
    out = step;
  }
  return out;
}
