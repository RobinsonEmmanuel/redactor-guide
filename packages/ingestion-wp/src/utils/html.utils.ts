/**
 * Nettoie le HTML brut pour ne garder que le texte.
 * Supprime toutes les balises (bloc et inline).
 */
export function stripHtmlToText(html: string): string {
  if (!html || typeof html !== 'string') return '';

  return (
    html
      // Supprimer les balises HTML
      .replace(/<[^>]+>/g, ' ')
      // Décoder les entités HTML courantes
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&eacute;/g, 'é')
      .replace(/&egrave;/g, 'è')
      .replace(/&agrave;/g, 'à')
      .replace(/&ccedil;/g, 'ç')
      .replace(/&hellip;/g, '…')
      // Réduire les espaces multiples et sauts de ligne
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extrait toutes les URLs d'images du HTML.
 * Cherche les balises <img> et extrait les attributs src.
 */
export function extractImageUrls(html: string): string[] {
  if (!html || typeof html !== 'string') return [];

  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && url.startsWith('http')) {
      urls.push(url);
    }
  }

  // Retourner URLs uniques
  return Array.from(new Set(urls));
}
