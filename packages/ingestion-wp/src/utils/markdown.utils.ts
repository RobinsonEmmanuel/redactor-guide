import TurndownService from 'turndown';

/**
 * Convertit du HTML en Markdown
 * Garde la structure sémantique importante (titres, listes, emphases, liens)
 * Supprime les balises non-sémantiques (div, span, etc.)
 */
export function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',  // # pour H1, ## pour H2, etc.
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
  });

  // Règles personnalisées pour nettoyer le HTML WordPress
  
  // Supprimer les classes et IDs (node = any car pas de DOM dans Node.js)
  turndownService.addRule('cleanAttributes', {
    filter: (node: any) => {
      if (node.removeAttribute) {
        node.removeAttribute('class');
        node.removeAttribute('id');
        node.removeAttribute('style');
      }
      return false;
    },
    replacement: () => '',
  });

  // Convertir et nettoyer les espaces excessifs
  let markdown = turndownService.turndown(html);
  
  // Nettoyer les lignes vides multiples
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  
  // Nettoyer les espaces en fin de ligne
  markdown = markdown.replace(/ +$/gm, '');
  
  return markdown.trim();
}

/**
 * Extrait un aperçu du contenu Markdown (premiers caractères sans la structure)
 */
export function markdownToPlainText(markdown: string, maxLength: number = 300): string {
  // Supprimer les titres
  let text = markdown.replace(/^#{1,6}\s+/gm, '');
  
  // Supprimer les emphases
  text = text.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1');
  
  // Supprimer les liens mais garder le texte
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Supprimer les listes
  text = text.replace(/^[-*+]\s+/gm, '');
  
  // Supprimer les lignes vides multiples
  text = text.replace(/\n{2,}/g, ' ');
  
  // Limiter la longueur
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  
  return text.trim();
}
