/**
 * Client API avec authentification automatique
 */

import { getAccessToken } from './auth';

/**
 * Options de fetch avec authentification
 */
export interface AuthFetchOptions extends RequestInit {
  credentials?: RequestCredentials;
}

/**
 * Wrapper fetch avec token d'authentification automatique
 */
export async function authFetch(url: string, options: AuthFetchOptions = {}): Promise<Response> {
  const token = getAccessToken();
  
  const headers = new Headers(options.headers);
  
  // Ajouter le token dans le header Authorization si disponible
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Toujours inclure credentials pour les cookies (fallback)
  const finalOptions: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials || 'include',
  };
  
  return fetch(url, finalOptions);
}
