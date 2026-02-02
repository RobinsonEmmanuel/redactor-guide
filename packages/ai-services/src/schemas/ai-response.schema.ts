import { z } from 'zod';

/**
 * Schema pour les réponses IA génériques
 */
export const AiResponseSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  tokensUsed: z.number().optional(),
  finishReason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AiResponse = z.infer<typeof AiResponseSchema>;

/**
 * Schema pour les réponses de traduction
 */
export const TranslationResponseSchema = z.object({
  originalText: z.string(),
  translatedText: z.string(),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  method: z.enum(['ai', 'deepl', 'manual']),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;

/**
 * Schema pour les requêtes de traduction
 */
export const TranslationRequestSchema = z.object({
  text: z.string().min(1),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  context: z.string().optional(),
});

export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
