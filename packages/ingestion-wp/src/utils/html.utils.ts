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
 * Supprime toutes les <img> provenant de blocs site-wide non liés au contenu éditorial :
 * - Blocs newsletter    : conteneur "newsletter-radius" ou div "newsletter-image"
 * - Blocs auteur/équipe : conteneur "box_auteur_voyage", figure "img_auteur_voyage" / "img_provisoire"
 * - Blocs planning      : colonne "planif-radius" (photos hôtels hors-sujet)
 *
 * Algorithme : pour chaque classe identifiante, trouve TOUTES les balises ouvrantes
 * correspondantes et supprime l'ensemble des <img> dans les 6000 chars suivants.
 */
function stripSiteWideBlockImages(html: string): string {
  let result = html;

  // Convention de nommage des blocs site-wide : suffixe "-radius" sur le conteneur,
  // "-image" sur le div parent immédiat de l'image (newsletter-image, ebook-image, …).
  const EXCLUDED_CLASSES = [
    'newsletter-radius',   // CTA newsletter
    'newsletter-image',    // div image newsletter
    'ebook-radius',        // CTA ebook / waitlist
    'ebook-image',         // div image ebook
    'box_auteur_voyage',   // conteneur bio auteur
    'img_auteur_voyage',   // figure image auteur
    'img_provisoire',      // figure image provisoire
    'planif-radius',       // colonne planning / hôtels hors-sujet
  ];

  // Fenêtre de scan après la balise ouvrante.
  // Les gros conteneurs (newsletter, auteur, ebooks) peuvent faire 4000+ chars.
  // Les colonnes planif-radius sont courtes (~400 chars) : fenêtre réduite pour
  // éviter de déborder sur les photos légitimes qui suivent immédiatement.
  const WINDOW: Record<string, number> = {
    'planif-radius': 600,
  };
  const DEFAULT_WINDOW = 6000;

  for (const cls of EXCLUDED_CLASSES) {
    const window = WINDOW[cls] ?? DEFAULT_WINDOW;
    const openTagRe = new RegExp(`<[a-z]+[^>]*class="[^"]*${cls}[^"]*"[^>]*>`, 'gi');
    let m: RegExpExecArray | null;
    const matches: RegExpExecArray[] = [];
    while ((m = openTagRe.exec(result)) !== null) matches.push(m);

    // Parcourir à rebours pour ne pas décaler les index lors des remplacements
    for (let i = matches.length - 1; i >= 0; i--) {
      const start = matches[i].index + matches[i][0].length;
      const end   = Math.min(start + window, result.length);
      const inner = result.slice(start, end).replace(/<img[^>]*>/gi, '');
      result = result.slice(0, start) + inner + result.slice(end);
    }
  }

  return result;
}

/**
 * Extrait toutes les URLs d'images du HTML en filtrant les blocs hors-sujet.
 * Cherche les balises <img> et extrait les attributs src.
 *
 * Blocs exclus :
 * - Blocs réutilisables Gutenberg (<!-- wp:block {"ref":X} /-->)
 * - Blocs newsletter, auteur, planning (via classes CSS)
 * - Blocs de navigation / structure (nav, header, footer)
 *
 * @param html - HTML brut de l'article WordPress (content.rendered)
 * @returns URLs uniques des images (hors blocs génériques)
 */
export function extractImageUrls(html: string): string[] {
  if (!html || typeof html !== 'string') return [];

  // 1. Supprimer les images des blocs réutilisables Gutenberg (synced patterns)
  let cleanedHtml = stripReusableBlockImages(html);

  // 2. Supprimer les images des blocs site-wide (newsletter, auteur, planning)
  cleanedHtml = stripSiteWideBlockImages(cleanedHtml);

  // 3. Retirer les blocs réutilisables identifiés par classe CSS (fallback anciens thèmes)
  cleanedHtml = cleanedHtml.replace(
    /<div[^>]*class="[^"]*(?:wp-block-reusable|wp-block-template-part|reusable-block)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ''
  );

  // 4. Retirer les blocs de navigation / structure (nav, header, footer)
  cleanedHtml = cleanedHtml.replace(
    /<(?:nav|header|footer)[^>]*class="[^"]*wp-block[^"]*"[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi,
    ''
  );

  // 5. Extraire les URLs des images restantes
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

  // 6. Retourner URLs uniques
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

