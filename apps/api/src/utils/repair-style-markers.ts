/**
 * Répare les marqueurs ** cassés par le LLM ou la traduction.
 *
 * 1) Ouverture décalée : « vous t**o choose** » → « vous **to choose** »
 *    (lettre minuscule collée avant **, segment interne commence par une voyelle,
 *    au moins 3 caractères — évite « x**bold** »).
 *
 * 2) Fermeture trop tôt avant « and » : « **Teide a**nd » → « **Teide** and »
 *
 * 3) Accolade orpheline après gras : « **organiser**} » → « {**organiser**} »
 *    Le LLM a décalé le { hors du bloc → on le remet juste avant **.
 *
 * 4) Gras débordant hors du bloc orange : « {mot **autre** } » → pas de cas connu,
 *    mais la règle 3 couvre le cas fréquent **...**}.
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

/**
 * Répare « **texte**} » → « {**texte**} » :
 * le LLM a omis le { d'ouverture mais gardé le } de fermeture.
 * On détecte **...**} précédé d'un séparateur (espace / début / ponctuation)
 * et on ajoute le { manquant juste avant **.
 */
function repairOrphanClosingBrace(text: string): string {
  // Pattern : (séparateur)\*\*[contenu]\*\*}
  // → (séparateur){**[contenu]**}
  return text.replace(
    /(^|[\s\n\r"'""«»().,;:!?\-—–àáâãäåèéêëìíîïòóôõöùúûü])\*\*([^*\r\n]+?)\*\*\}/gmu,
    (_full, sep, inner) => `${sep}{**${inner}**}`,
  );
}

export function repairStrandedBoldMarkers(text: string): string {
  if (!text || !text.includes('**')) return text;
  let out = text;
  // Règle 3 : accolade orpheline après gras — appliquée en premier
  out = repairOrphanClosingBrace(out);
  for (let i = 0; i < 12; i++) {
    const step = repairSplitWordClosingBold(
      repairSplitWordAndAfterBold(repairStrandedBoldOpen(out))
    );
    if (step === out) break;
    out = step;
  }
  return out;
}

/**
 * Normalise ET équilibre les marqueurs gras `**` — à appeler à l'export.
 *
 * Au-delà des réparations positionnelles de repairStrandedBoldMarkers, garantit
 * que chaque champ ne contient que des paires `**…**` équilibrées :
 *   - séquences de 3+ astérisques  → `**`
 *   - étoile simple accolée à une paire (étoile manquante) :
 *       `*mot**`  → `**mot**`   (ajout de l'étoile ouvrante)
 *       `**mot*`  → `**mot**`   (ajout de l'étoile fermante)
 *   - si le nombre de `**` reste impair, on retire le `**` orphelin (suppression),
 *     ce qui évite tout débordement de gras côté InDesign.
 *
 * Conservateur : une étoile isolée SANS paire voisine (note « 4* », « *voir bas »)
 * n'est jamais touchée — elle n'est pas un marqueur de gras.
 */
export function normalizeBoldMarkers(text: string): string {
  if (!text || !text.includes('*')) return text;

  let out = repairStrandedBoldMarkers(text);

  // 3+ astérisques consécutifs → **
  out = out.replace(/\*{3,}/g, '**');

  // étoile simple ouvrante manquante : *mot** → **mot**
  out = out.replace(/(^|[^*])\*([^\s*][^*\r\n]*?)\*\*/g, '$1**$2**');
  // étoile simple fermante manquante : **mot* → **mot**
  out = out.replace(/\*\*([^*\r\n]*?[^\s*])\*(?!\*)/g, '**$1**');

  // ré-collapse si une réparation a produit ***
  out = out.replace(/\*{3,}/g, '**');

  // nombre de ** impair → retirer le dernier orphelin
  const pairs = out.match(/\*\*/g);
  if (pairs && pairs.length % 2 !== 0) {
    const lastIdx = out.lastIndexOf('**');
    out = out.slice(0, lastIdx) + out.slice(lastIdx + 2);
  }

  return out;
}
