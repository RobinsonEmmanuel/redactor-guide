/**
 * Configuration de l'application
 */

export const API_URL = 
  process.env.NEXT_PUBLIC_API_URL || 
  'http://localhost:3000';

export const config = {
  apiUrl: API_URL,
} as const;
