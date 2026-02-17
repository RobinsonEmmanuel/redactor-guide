'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Sidebar from '@/components/Sidebar';
import WorkflowStepper from '@/components/guide/WorkflowStepper';
import ArticlesTab from '@/components/guide/ArticlesTab';
import LieuxEtClustersTab from '@/components/guide/LieuxEtClustersTab';
import LieuxEtInspirationsTab from '@/components/guide/LieuxEtInspirationsTab';
import CheminDeFerTab from '@/components/guide/CheminDeFerTab';

export default function GuideDetailPage() {
  const router = useRouter();
  const params = useParams();
  const guideId = params.id as string;

  const [guide, setGuide] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'articles' | 'lieux-et-clusters' | 'lieux-et-inspirations' | 'chemin-de-fer'>('articles');
  const [articlesCount, setArticlesCount] = useState<number>(0);
  const [hasCheckedArticles, setHasCheckedArticles] = useState(false);
  const [currentWorkflowStep, setCurrentWorkflowStep] = useState<number>(2); // Commence à étape 2 (Articles)
  const [poisSelected, setPoisSelected] = useState(false); // Étape 3: POIs sélectionnés
  const [matchingGenerated, setMatchingGenerated] = useState(false); // Étape 3: Matching fait
  const [inspirationsGenerated, setInspirationsGenerated] = useState(false); // Étape 4: Inspirations générées
  const [sommaireGenerated, setSommaireGenerated] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    loadGuide();
    checkArticles();
    checkPoisStatus();
    checkMatchingStatus();
    checkInspirationsStatus();
    checkSommaireStatus();
  }, [guideId]);

  const loadGuide = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setGuide(data);
      }
    } catch (err) {
      console.error('Erreur chargement guide:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkArticles = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setArticlesCount(data.articles?.length || 0);
        setHasCheckedArticles(true);
      }
    } catch (err) {
      console.error('Erreur vérification articles:', err);
      setHasCheckedArticles(true);
    }
  };

  const checkPoisStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/pois`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPoisSelected(data.pois && data.pois.length > 0);
      }
    } catch (err) {
      setPoisSelected(false);
    }
  };

  const checkMatchingStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/matching`, {
        credentials: 'include',
      });
      if (res.ok) {
        setMatchingGenerated(true);
      }
    } catch (err) {
      // Pas de matching généré
      setMatchingGenerated(false);
    }
  };

  const checkInspirationsStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/inspirations`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setInspirationsGenerated(data.inspirations && data.inspirations.length > 0);
      }
    } catch (err) {
      setInspirationsGenerated(false);
    }
  };

  const checkSommaireStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/sommaire-proposal`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSommaireGenerated(data.proposal && (data.proposal.pois?.length > 0 || data.proposal.sections?.length > 0));
      }
    } catch (err) {
      setSommaireGenerated(false);
    }
  };

  // Calculer les étapes complétées
  const getCompletedSteps = (): Set<number> => {
    const completed = new Set<number>();
    
    // Étape 1: Paramétrage (toujours complété si guide existe)
    if (guide) completed.add(1);
    
    // Étape 2: Articles WordPress
    if (articlesCount > 0) completed.add(2);
    
    // Étape 3: Lieux et Clusters (POIs identifiés + matching généré)
    if (poisSelected && matchingGenerated) completed.add(3);
    
    // Étape 4: Lieux et Inspirations (inspirations générées)
    if (inspirationsGenerated) completed.add(4);
    
    // Étape 5: Chemin de fer (si pages créées ou sommaire généré ou au moins une page avec contenu)
    const hasGeneratedContent = guide?.chemin_de_fer?.pages?.some((p: any) => p.statut_editorial === 'generee_ia');
    if (sommaireGenerated || guide?.chemin_de_fer?.pages?.length > 0 || hasGeneratedContent) {
      completed.add(5);
    }
    
    return completed;
  };

  // Gérer le clic sur une étape du workflow
  const handleWorkflowStepClick = (stepId: number, tabId: string) => {
    const completedSteps = getCompletedSteps();
    
    // Vérifier si l'étape précédente est complétée
    const canAccess = stepId === 1 || completedSteps.has(stepId - 1);
    if (!canAccess) return;
    
    setCurrentWorkflowStep(stepId);
    
    // Mapper stepId vers l'onglet correspondant
    if (tabId === 'articles') setActiveTab('articles');
    if (tabId === 'lieux-et-clusters') setActiveTab('lieux-et-clusters');
    if (tabId === 'lieux-et-inspirations') setActiveTab('lieux-et-inspirations');
    if (tabId === 'chemin-de-fer') setActiveTab('chemin-de-fer');
    // Note: 'config' et 'export' n'ont pas encore d'onglet dédié
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Guide introuvable</div>
      </div>
    );
  }

  const canAccessLieuxEtClusters = articlesCount > 0;
  const canAccessLieuxEtInspirations = articlesCount > 0 && poisSelected;
  const canAccessCheminDeFer = articlesCount > 0;

  // Callback pour rafraîchir les statuts après actions
  const handleArticlesImported = () => {
    checkArticles();
    setCurrentWorkflowStep(3); // Passer à l'étape "Lieux"
  };

  const handlePoisUpdated = () => {
    checkPoisStatus();
  };

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto flex flex-col">
        {/* Header compact */}
        <div className="border-b border-gray-200 bg-white px-6 py-2 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/guides')}
              className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            
            <div className="border-l border-gray-300 pl-3">
              <div className="flex items-center gap-2 text-sm">
                <h1 className="font-bold text-gray-900">{guide.name}</h1>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">Version {guide.year}</span>
                <span className="text-gray-400">•</span>
                <span className="capitalize text-gray-600">{guide.status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Workflow Stepper */}
        <WorkflowStepper
          currentStep={currentWorkflowStep}
          completedSteps={getCompletedSteps()}
          onStepClick={handleWorkflowStepClick}
        />

        {/* Tab Content - prend tout l'espace restant */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'articles' && (
            <div className="h-full p-6">
              <ArticlesTab guideId={guideId} guide={guide} apiUrl={apiUrl} onArticlesImported={handleArticlesImported} />
            </div>
          )}

          {activeTab === 'lieux-et-clusters' && canAccessLieuxEtClusters && (
            <LieuxEtClustersTab guideId={guideId} apiUrl={apiUrl} guide={guide} />
          )}
          {activeTab === 'lieux-et-clusters' && !canAccessLieuxEtClusters && (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center max-w-md">
                <div className="text-yellow-800 font-medium mb-2">
                  📝 Récupération des articles WordPress requise
                </div>
                <p className="text-yellow-700 text-sm mb-4">
                  Pour identifier les lieux et les affecter aux clusters, vous devez d'abord récupérer les articles WordPress de ce guide.
                </p>
                <button
                  onClick={() => setActiveTab('articles')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Aller aux articles WordPress
                </button>
              </div>
            </div>
          )}

          {activeTab === 'lieux-et-inspirations' && canAccessLieuxEtInspirations && (
            <LieuxEtInspirationsTab guideId={guideId} apiUrl={apiUrl} />
          )}
          {activeTab === 'lieux-et-inspirations' && !canAccessLieuxEtInspirations && (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center max-w-md">
                <div className="text-yellow-800 font-medium mb-2">
                  📍 Lieux requis
                </div>
                <p className="text-yellow-700 text-sm mb-4">
                  Pour affecter les lieux aux inspirations, vous devez d'abord identifier les lieux à l'étape précédente.
                </p>
                <button
                  onClick={() => setActiveTab('lieux-et-clusters')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Aller aux lieux et clusters
                </button>
              </div>
            </div>
          )}

          {activeTab === 'chemin-de-fer' && canAccessCheminDeFer && (
            <CheminDeFerTab guideId={guideId} cheminDeFer={guide.chemin_de_fer} apiUrl={apiUrl} />
          )}
          {activeTab === 'chemin-de-fer' && !canAccessCheminDeFer && (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center max-w-md">
                <div className="text-yellow-800 font-medium mb-2">
                  📝 Récupération des articles WordPress requise
                </div>
                <p className="text-yellow-700 text-sm mb-4">
                  Pour créer le chemin de fer, vous devez d'abord récupérer les articles WordPress de ce guide.
                </p>
                <button
                  onClick={() => setActiveTab('articles')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Aller aux articles WordPress
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
