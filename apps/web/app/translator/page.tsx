'use client';

import { useState, useRef } from 'react';
import { 
  ArrowUpTrayIcon, 
  ArrowDownTrayIcon, 
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  LanguageIcon
} from '@heroicons/react/24/outline';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface TranslationStats {
  totalFields: number;
  translatedFields: number;
  errors: number;
  retries: number;
}

export default function TranslatorPage() {
  const [jsonInput, setJsonInput] = useState<any>(null);
  const [jsonOutput, setJsonOutput] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'failed'>('idle');
  const [stats, setStats] = useState<TranslationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setJsonInput(json);
        setError(null);
        console.log('✅ JSON chargé:', Object.keys(json).length, 'clés racine');
      } catch (err) {
        setError('❌ Fichier JSON invalide');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  const handleTranslate = async () => {
    if (!jsonInput) {
      setError('Veuillez d\'abord charger un fichier JSON');
      return;
    }

    setStatus('uploading');
    setError(null);

    try {
      console.log('🚀 Lancement traduction...');
      
      const res = await fetch(`${API_URL}/api/v1/translator/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jsonData: jsonInput }),
      });

      const data = await res.json();

      if (res.ok) {
        setJobId(data.jobId);
        setStatus('processing');
        console.log('✅ Job créé:', data.jobId);

        // Démarrer le polling
        startPolling(data.jobId);
      } else {
        throw new Error(data.error || 'Erreur serveur');
      }
    } catch (err: any) {
      setError(err.message);
      setStatus('failed');
      console.error('❌ Erreur:', err);
    }
  };

  const startPolling = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/translator/status/${jobId}`, {
          credentials: 'include',
        });

        const data = await res.json();

        if (res.ok) {
          if (data.status === 'completed') {
            clearInterval(interval);
            setPollingInterval(null);
            await fetchResult(jobId);
          } else if (data.status === 'failed') {
            clearInterval(interval);
            setPollingInterval(null);
            setStatus('failed');
            setError(data.error || 'Traduction échouée');
          }

          if (data.stats) {
            setStats(data.stats);
          }
        }
      } catch (err) {
        console.error('❌ Erreur polling:', err);
      }
    }, 2000); // Toutes les 2 secondes

    setPollingInterval(interval);
  };

  const fetchResult = async (jobId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/translator/result/${jobId}`, {
        credentials: 'include',
      });

      const data = await res.json();

      if (res.ok) {
        setJsonOutput(data.translatedJson);
        setStats(data.stats);
        setStatus('completed');
        console.log('✅ Traduction récupérée');
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(err.message);
      setStatus('failed');
    }
  };

  const handleDownload = () => {
    if (!jsonOutput) return;

    const blob = new Blob([JSON.stringify(jsonOutput, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    setJsonInput(null);
    setJsonOutput(null);
    setJobId(null);
    setStatus('idle');
    setStats(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl mb-4">
            <LanguageIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Traducteur JSON FR → EN
          </h1>
          <p className="text-gray-600">
            Traduit automatiquement tous les champs "value" via IA (ChatGPT 4o-mini)
          </p>
        </div>

        {/* Upload Section */}
        {status === 'idle' && !jsonInput && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <label className="block">
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-all cursor-pointer">
                <ArrowUpTrayIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                  Glissez votre fichier JSON ici
                </p>
                <p className="text-sm text-gray-500">ou cliquez pour parcourir</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </label>
          </div>
        )}

        {/* JSON Loaded */}
        {jsonInput && status === 'idle' && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">JSON chargé</h2>
                <p className="text-sm text-gray-600">
                  Prêt pour la traduction FR → EN
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Changer de fichier
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6 max-h-64 overflow-auto">
              <pre className="text-xs text-gray-700">
                {JSON.stringify(jsonInput, null, 2).substring(0, 1000)}...
              </pre>
            </div>

            <button
              onClick={handleTranslate}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all font-semibold text-lg"
            >
              <LanguageIcon className="w-6 h-6" />
              Traduire en anglais
            </button>
          </div>
        )}

        {/* Processing */}
        {(status === 'uploading' || status === 'processing') && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-purple-200 border-t-purple-600 mb-6"></div>
              
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {status === 'uploading' ? 'Envoi en cours...' : 'Traduction en cours...'}
              </h2>
              
              {stats && (
                <div className="mt-6 bg-blue-50 rounded-xl p-6">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Champs totaux</p>
                      <p className="text-2xl font-bold text-blue-600">{stats.totalFields}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Traduits</p>
                      <p className="text-2xl font-bold text-green-600">{stats.translatedFields}</p>
                    </div>
                  </div>
                  
                  {stats.totalFields > 0 && (
                    <div className="mt-4">
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all"
                          style={{ width: `${(stats.translatedFields / stats.totalFields) * 100}%` }}
                        />
                      </div>
                      <p className="text-sm text-gray-600 mt-2 text-center">
                        {Math.round((stats.translatedFields / stats.totalFields) * 100)}% complété
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed */}
        {status === 'completed' && jsonOutput && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircleIcon className="w-12 h-12 text-green-500" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Traduction terminée !</h2>
                <p className="text-gray-600">JSON traduit en anglais avec succès</p>
              </div>
            </div>

            {stats && (
              <div className="grid grid-cols-4 gap-4 mb-6 p-4 bg-green-50 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-gray-600 mb-1">Champs traduits</p>
                  <p className="text-xl font-bold text-green-600">{stats.translatedFields}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600 mb-1">Erreurs</p>
                  <p className="text-xl font-bold text-red-600">{stats.errors}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600 mb-1">Retries</p>
                  <p className="text-xl font-bold text-yellow-600">{stats.retries}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600 mb-1">Taux succès</p>
                  <p className="text-xl font-bold text-blue-600">
                    {stats.totalFields > 0 
                      ? Math.round((stats.translatedFields / stats.totalFields) * 100) 
                      : 0}%
                  </p>
                </div>
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-4 mb-6 max-h-96 overflow-auto">
              <pre className="text-xs text-gray-700">
                {JSON.stringify(jsonOutput, null, 2)}
              </pre>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all font-semibold"
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
                Télécharger le JSON traduit
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-100 transition-all font-semibold"
              >
                Nouvelle traduction
              </button>
            </div>
          </div>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <XCircleIcon className="w-12 h-12 text-red-500" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Erreur</h2>
                <p className="text-gray-600">La traduction a échoué</p>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            <button
              onClick={handleReset}
              className="w-full px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all font-semibold"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <ClockIcon className="w-5 h-5" />
            Informations
          </h3>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• Seuls les champs "value" sont traduits</li>
            <li>• La structure JSON reste intacte</li>
            <li>• Traduction par ChatGPT 4o-mini (rapide et économique)</li>
            <li>• Batches de 10 champs pour optimiser</li>
            <li>• 3 tentatives maximum par batch</li>
            <li>• Durée estimée: ~60 champs = 30-60 secondes</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
