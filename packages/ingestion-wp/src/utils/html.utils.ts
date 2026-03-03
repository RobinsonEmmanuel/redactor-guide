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
 * Supprime les <img> des segments rendus par des blocs réutilisables WordPress.
 *
 * Dans content.rendered, les blocs réutilisables (synced patterns) apparaissent comme :
 *   <!-- wp:block {"ref":665} /-->
 *   <div>...contenu générique rendu depuis le bloc...</div>
 *   <!-- wp:prochain-bloc -->
 *
 * Ces blocs contiennent du contenu site-wide (bandeaux, CTA, cartes de visite…)
 * qui ne doit pas alimenter le pool d'images d'un article ou d'un POI spécifique.
 *
 * Algorithme : on découpe le HTML par ses commentaires Gutenberg (<!-- wp:… -->) ;
 * les segments qui suivent un commentaire de bloc réutilisable auto-fermant
 * (<!-- wp:block {"ref":X} /-->) voient leurs <img> supprimés.
 */
function stripReusableBlockImages(html: string): string {
  const result: string[] = [];
  // Regex pour tout commentaire HTML (y compris les blocs Gutenberg <!-- wp:… -->)
  const COMMENT_RE = /<!--([\s\S]*?)-->/g;
  let lastIdx = 0;
  let skipNextSegment = false;

  let m: RegExpExecArray | null;
  while ((m = COMMENT_RE.exec(html)) !== null) {
    const segment = html.slice(lastIdx, m.index);

    if (skipNextSegment) {
      // Ce segment vient d'un bloc réutilisable : on retire les <img>
      result.push(segment.replace(/<img[^>]+>/gi, ''));
    } else {
      result.push(segment);
    }

    // Conserver le commentaire tel quel
    result.push(m[0]);
    lastIdx = m.index + m[0].length;

    // Décider si le PROCHAIN segment doit être nettoyé :
    // un bloc réutilisable est auto-fermant (se termine par "/ ") et contient "ref"
    const inner = m[1].trim();
    skipNextSegment =
      /^wp:block\b/.test(inner) &&
      /\/\s*$/.test(inner) &&
      /"ref"\s*:/.test(inner);
  }

  // Segment final
  const lastSegment = html.slice(lastIdx);
  result.push(skipNextSegment ? lastSegment.replace(/<img[^>]+>/gi, '') : lastSegment);

  return result.join('');
}

/**
 * Extrait toutes les URLs d'images du HTML en filtrant les blocs réutilisables.
 * Cherche les balises <img> et extrait les attributs src.
 *
 * @param html - HTML brut de l'article WordPress (content.rendered)
 * @returns URLs uniques des images (hors blocs réutilisables)
 */
export function extractImageUrls(html: string): string[] {
  if (!html || typeof html !== 'string') return [];

  // 1. Supprimer les images provenant de blocs réutilisables Gutenberg
  //    (<!-- wp:block {"ref":X} /--> — synced patterns, widgets site-wide)
  let cleanedHtml = stripReusableBlockImages(html);

  // 2. Retirer les blocs réutilisables identifiés par classe CSS (fallback pour anciens thèmes)
  cleanedHtml = cleanedHtml.replace(
    /<div[^>]*class="[^"]*(?:wp-block-reusable|wp-block-template-part|reusable-block)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ''
  );

  // 3. Retirer les blocs Gutenberg de navigation / structure (nav, header, footer)
  cleanedHtml = cleanedHtml.replace(
    /<(?:nav|header|footer)[^>]*class="[^"]*wp-block[^"]*"[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi,
    ''
  );

  // 4. Extraire les URLs des images restantes
  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;

  while ((match = imgRegex.exec(cleanedHtml)) !== null) {
    const url = match[1];

    // Filtrer les URLs invalides
    if (!url || !url.startsWith('http')) continue;

    // Filtrer les images de petite taille (icônes, logos…)
    // WordPress ajoute souvent les dimensions dans l'URL : -150x150, -300x200, etc.
    const sizeMatch = url.match(/-(\d+)x(\d+)\./);
    if (sizeMatch) {
      const width  = parseInt(sizeMatch[1]);
      const height = parseInt(sizeMatch[2]);
      if (width < 400 || height < 300) continue;
    }

    urls.push(url);
  }

  // 5. Retourner URLs uniques
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

