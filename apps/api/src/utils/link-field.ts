/**
 * Utilitaires pour les champs lien structurés {label, url}.
 *
 * Ces champs peuvent être stockés dans MongoDB sous deux formes :
 *  - Objet natif : { label: "Tout savoir…", url: "https://…" }
 *  - String JSON  : '{"label":"Tout savoir…","url":"https://…"}'
 *
 * Ces helpers centralisent le parsing/sérialisation pour éviter
 * la duplication dans export.service.ts, guide-translation.service.ts, etc.
 */

export interface LinkField {
  label: string;
  url: string;
}

/**
 * Tente de parser une valeur (objet ou string JSON) en LinkField.
 * Retourne null si la valeur n'est pas un champ lien valide.
 */
export function parseLinkField(value: unknown): LinkField | null {
  if (value === null || value === undefined) return null;

  // Cas 1 : objet natif MongoDB {label, url}
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.label === 'string' && typeof obj.url === 'string') {
      return { label: obj.label, url: obj.url };
    }
    return null;
  }

  // Cas 2 : string JSON
  if (typeof value === 'string' && value.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (typeof parsed.label === 'string' && typeof parsed.url === 'string') {
        return { label: parsed.label, url: parsed.url };
      }
    } catch {
      // JSON invalide → pas un champ lien
    }
  }

  return null;
}

/**
 * Extrait uniquement le label d'un champ lien.
 * Retourne null si la valeur n'est pas un champ lien valide.
 */
export function extractLinkLabel(value: unknown): string | null {
  return parseLinkField(value)?.label ?? null;
}

/**
 * Sérialise un LinkField en string JSON (format de stockage dans content.text).
 */
export function buildLinkField(label: string, url: string): string {
  return JSON.stringify({ label, url });
}

/**
 * Retourne true si la valeur est un champ lien structuré valide.
 */
export function isLinkField(value: unknown): boolean {
  return parseLinkField(value) !== null;
}

/**
 * Transforme une URL d'article en URL normalisée stable pour les hyperliens InDesign.
 * Forme : https://{host}/guide/{lang}/{slug}/
 * Le slug est le dernier segment non vide du chemin de l'URL source.
 *
 * Exemple :
 *   normalizeArticleUrl('https://loirelovers.fr/elephant-machines-ile-nantes-visite/', 'fr')
 *   → 'https://loirelovers.fr/guide/fr/elephant-machines-ile-nantes-visite/'
 *
 * Retourne l'URL d'origine inchangée si elle ne peut pas être parsée ou si le slug est vide.
 */
export function normalizeArticleUrl(rawUrl: string, lang: string): string {
  try {
    const parsed = new URL(rawUrl);
    const slug = parsed.pathname.split('/').filter(Boolean).pop();
    if (!slug) return rawUrl;
    return `${parsed.protocol}//${parsed.host}/guide/${lang}/${slug}/`;
  } catch {
    return rawUrl;
  }
}

/**
 * Retourne true si l'URL pointe vers Google Maps (ne doit pas être normalisée).
 */
export function isGoogleMapsUrl(url: string): boolean {
  return /maps\.google|goo\.gl|google\.com\/maps/i.test(url);
}
