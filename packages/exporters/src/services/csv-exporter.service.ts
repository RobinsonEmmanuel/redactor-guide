import { Guide } from '@redactor-guide/core-model';
import { CsvExportOptions, CsvExportOptionsSchema } from '../schemas/export.schema';

/**
 * Interface du service d'export CSV
 */
export interface ICsvExporterService {
  export(guide: Guide, options?: CsvExportOptions): Promise<string>;
}

/**
 * Service d'export CSV (EasyCatalog)
 * 
 * Responsabilités :
 * - Générer des fichiers CSV à partir des guides
 * - Respecter le format EasyCatalog
 * - Valider les options avec Zod
 * 
 * Note : Implémentation de base, à compléter avec la logique d'export réelle
 */
export class CsvExporterService implements ICsvExporterService {
  /**
   * Pas de dépendances externes pour ce service simple
   */
  constructor() {}

  /**
   * Exporter un guide en CSV
   */
  async export(guide: Guide, options?: CsvExportOptions): Promise<string> {
    // Validation des options avec Zod
    const validatedOptions = CsvExportOptionsSchema.parse(options || {});

    // TODO: Implémentation de la génération CSV
    // - Transformer les données du guide
    // - Formater selon EasyCatalog
    // - Gérer les colonnes

    const csv = this.generateCsvContent(guide, validatedOptions);

    return csv;
  }

  /**
   * Générer le contenu CSV
   */
  private generateCsvContent(
    guide: Guide,
    options: CsvExportOptions
  ): string {
    const { delimiter, includeHeaders } = options;

    const lines: string[] = [];

    if (includeHeaders) {
      lines.push(['ID', 'Nom', 'Année', 'Version', 'Langue'].join(delimiter));
    }

    lines.push(
      [
        guide._id || '',
        guide.name,
        guide.year.toString(),
        guide.version,
        guide.language,
      ].join(delimiter)
    );

    return lines.join('\n');
  }
}
