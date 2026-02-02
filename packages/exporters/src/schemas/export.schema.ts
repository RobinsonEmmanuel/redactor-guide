import { z } from 'zod';

/**
 * Format d'export
 */
export const ExportFormatEnum = z.enum(['csv', 'json', 'xml']);

export type ExportFormat = z.infer<typeof ExportFormatEnum>;

/**
 * Options d'export CSV
 */
export const CsvExportOptionsSchema = z.object({
  delimiter: z.string().default(','),
  encoding: z.string().default('utf-8'),
  includeHeaders: z.boolean().default(true),
  columns: z.array(z.string()).optional(),
});

export type CsvExportOptions = z.infer<typeof CsvExportOptionsSchema>;

/**
 * Requête d'export
 */
export const ExportRequestSchema = z.object({
  guideId: z.string(),
  format: ExportFormatEnum,
  options: z.record(z.unknown()).optional(),
  outputPath: z.string().optional(),
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;
