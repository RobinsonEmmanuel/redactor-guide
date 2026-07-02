'use client';

import { CheckIcon, LockClosedIcon } from '@heroicons/react/24/solid';

interface Step {
  id: number;
  label: string;
  shortLabel: string;
  icon: string;
  tabId: 'config' | 'articles' | 'lieux-et-clusters' | 'lieux-et-inspirations' | 'chemin-de-fer' | 'carte' | 'export';
  description: string;
}

interface WorkflowStepperProps {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (stepId: number, tabId: string) => void;
}

const WORKFLOW_STEPS: Step[] = [
  {
    id: 1,
    label: '1. Paramétrage',
    shortLabel: 'Paramétrage',
    icon: '⚙️',
    tabId: 'config',
    description: 'Configuration du guide et destination'
  },
  {
    id: 2,
    label: '2. Articles WP',
    shortLabel: 'Articles',
    icon: '📄',
    tabId: 'articles',
    description: 'Récupération des articles WordPress'
  },
  {
    id: 3,
    label: '3. Lieux & Clusters',
    shortLabel: 'Lieux',
    icon: '📍',
    tabId: 'lieux-et-clusters',
    description: 'Identification des lieux et affectation par cluster'
  },
  {
    id: 4,
    label: '4. Lieux & Inspirations',
    shortLabel: 'Inspirations',
    icon: '💡',
    tabId: 'lieux-et-inspirations',
    description: 'Affectation des lieux aux inspirations thématiques'
  },
  {
    id: 5,
    label: '5. Chemin de fer',
    shortLabel: 'Chemin de fer',
    icon: '🛤️',
    tabId: 'chemin-de-fer',
    description: 'Génération du sommaire et construction des pages'
  },
  {
    id: 6,
    label: '6. Carte',
    shortLabel: 'Carte',
    icon: '🗺️',
    tabId: 'carte',
    description: 'Association des liens de cartes Mapbox aux pages carte'
  },
  {
    id: 7,
    label: '7. Export',
    shortLabel: 'Export',
    icon: '📦',
    tabId: 'export',
    description: 'CSV pour InDesign/EasyCatalog'
  },
];

export default function WorkflowStepper({ currentStep, completedSteps, onStepClick }: WorkflowStepperProps) {
  const getStepStatus = (stepId: number): 'completed' | 'current' | 'upcoming' | 'locked' => {
    if (completedSteps.has(stepId)) return 'completed';
    if (stepId === currentStep) return 'current';
    if (stepId < currentStep) return 'completed';

    // Vérifier si l'étape précédente est complétée
    const previousStepCompleted = stepId === 1 || completedSteps.has(stepId - 1);
    if (!previousStepCompleted) return 'locked';

    return 'upcoming';
  };

  const circleClasses = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-slate-800 text-white';
      case 'current':
        return 'bg-orange-500 text-white ring-2 ring-orange-200';
      case 'locked':
        return 'bg-gray-100 text-gray-300';
      default: // upcoming
        return 'bg-gray-200 text-gray-500';
    }
  };

  const labelClasses = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-slate-700';
      case 'current':
        return 'text-orange-600 font-semibold';
      case 'locked':
        return 'text-gray-300';
      default: // upcoming
        return 'text-gray-500';
    }
  };

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-start overflow-x-auto">
        {WORKFLOW_STEPS.map((step, index) => {
          const status = getStepStatus(step.id);
          const isClickable = status !== 'locked';

          return (
            <div key={step.id} className="flex items-start flex-shrink-0">
              {/* Étape */}
              <div
                onClick={() => isClickable && onStepClick(step.id, step.tabId)}
                className={`flex flex-col items-center gap-1.5 w-20 ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                title={step.description}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${circleClasses(status)}`}
                >
                  {status === 'completed' ? (
                    <CheckIcon className="w-5 h-5" strokeWidth={2.5} />
                  ) : status === 'locked' ? (
                    <LockClosedIcon className="w-4 h-4" />
                  ) : (
                    step.id
                  )}
                </div>
                <div className={`text-xs text-center leading-tight ${labelClasses(status)}`}>
                  {step.shortLabel}
                </div>
              </div>

              {/* Connecteur */}
              {index < WORKFLOW_STEPS.length - 1 && (
                <div className="flex items-center h-10 mt-5 -mx-1">
                  <div
                    className={`h-0.5 w-6 transition-colors ${
                      completedSteps.has(step.id) ? 'bg-slate-800' : 'bg-gray-200'
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
