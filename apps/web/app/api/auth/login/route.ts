import { NextRequest, NextResponse } from 'next/server';

const API_URL = 'https://api-prod.regionlovers.ai';
const API_KEY = process.env.API_REGION_LOVERS;

export async function POST(request: NextRequest) {
  console.log('🔵 [API ROUTE] /api/auth/login - Requête reçue');
  
  try {
    const body = await request.json();
    const { email, password } = body;
    console.log('🔵 [API ROUTE] Email:', email);

    if (!email || !password) {
      console.error('❌ [API ROUTE] Email ou password manquant');
      return NextResponse.json(
        { error: 'Email et mot de passe requis' },
        { status: 400 }
      );
    }

    if (!API_KEY) {
      console.error('❌ [API ROUTE] API_REGION_LOVERS not configured');
      return NextResponse.json(
        { error: 'Configuration serveur manquante' },
        { status: 500 }
      );
    }

    console.log('🔵 [API ROUTE] Appel à Region Lovers API:', API_URL);
    
    // Appeler l'API Region Lovers avec la clé API
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    console.log('🔵 [API ROUTE] Réponse Region Lovers, status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [API ROUTE] Erreur Region Lovers:', errorText);
      return NextResponse.json(
        { error: errorText || 'Échec de la connexion' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ [API ROUTE] Login réussi, token reçu');
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ [API ROUTE] Exception:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la connexion' },
      { status: 500 }
    );
  }
}
