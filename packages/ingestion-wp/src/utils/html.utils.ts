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
