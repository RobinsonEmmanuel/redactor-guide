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
 * Extrait toutes les URLs d'images du HTML en filtrant les blocs réutilisables.
 * Cherche les balises <img> et extrait les attributs src.
 * 
 * @param html - HTML brut de l'article WordPress
 * @returns URLs uniques des images (hors blocs réutilisables)
 */
export function extractImageUrls(html: string): string[] {
  if (!html || typeof html !== 'string') return [];

  // 1. Filtrer les blocs réutilisables WordPress
  let cleanedHtml = html;
  
  // Retirer les blocs réutilisables (wp-block-reusable, wp-block-template-part)
  cleanedHtml = cleanedHtml.replace(
    /<div[^>]*class="[^"]*(?:wp-block-reusable|wp-block-template-part|reusable-block)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ''
  );
  
  // Retirer les blocs Gutenberg spécifiques (navigation, headers, footers)
  cleanedHtml = cleanedHtml.replace(
    /<(?:nav|header|footer)[^>]*class="[^"]*wp-block[^"]*"[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi,
    ''
  );

  // 2. Extraire les URLs des images
  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;

  while ((match = imgRegex.exec(cleanedHtml)) !== null) {
    const url = match[1];
    
    // Filtrer les URLs invalides
    if (!url || !url.startsWith('http')) continue;
    
    // Filtrer les images de petite taille (icônes, logos, etc.)
    // WordPress ajoute souvent les dimensions dans l'URL : -150x150, -300x200, etc.
    const sizeMatch = url.match(/-(\d+)x(\d+)\./);
    if (sizeMatch) {
      const width = parseInt(sizeMatch[1]);
      const height = parseInt(sizeMatch[2]);
      // Ignorer les images < 400px de largeur (probablement des icônes)
      if (width < 400 || height < 300) continue;
    }
    
    urls.push(url);
  }

  // 3. Retourner URLs uniques
  return Array.from(new Set(urls));
}

/**
 * Normalise une URL d'image pour détecter les doublons.
 * Retire les paramètres de dimensions et de qualité.
 * 
 * @example
 * normalizeImageUrl('https://site.com/image-800x600.jpg?quality=80')
 * → 'https://site.com/image.jpg'
 */
export function normalizeImageUrl(url: string): string {
  if (!url) return '';
  
  try {
    const urlObj = new URL(url);
    
    // Retirer les query params (quality, resize, etc.)
    urlObj.search = '';
    
    // Retirer les dimensions du filename : -800x600, -1024x768, etc.
    let pathname = urlObj.pathname;
    pathname = pathname.replace(/-\d+x\d+(\.[^.]+)$/, '$1');
    
    // Retirer les suffixes de taille WordPress : -scaled, -medium, -large
    pathname = pathname.replace(/-(scaled|medium|large|thumbnail)(\.[^.]+)$/, '$2');
    
    urlObj.pathname = pathname;
    
    return urlObj.toString();
  } catch {
    // Si l'URL est invalide, retourner telle quelle
    return url;
  }
}
