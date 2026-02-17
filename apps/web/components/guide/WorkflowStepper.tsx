'use client';

import { CheckCircleIcon, ClockIcon, LockClosedIcon } from '@heroicons/react/24/solid';

interface Step {
  id: number;
  label: string;
  shortLabel: string;
  icon: string;
  tabId: 'config' | 'articles' | 'lieux-et-clusters' | 'chemin-de-fer' | 'export';
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
    shortLabel: 'Config',
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
    label: '4. Chemin de fer',
    shortLabel: 'CdF',
    icon: '🛤️',
    tabId: 'chemin-de-fer',
    description: 'Génération du sommaire et construction des pages'
  },
  {
    id: 5,
    label: '5. Export',
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

  const getStepStyles = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          container: 'bg-green-50 border-green-300',
          icon: 'bg-green-500 text-white',
          text: 'text-green-700',
          badge: <CheckCircleIcon className="w-4 h-4 text-green-600" />,
        };
      case 'current':
        return {
          container: 'bg-blue-50 border-blue-400 shadow-md',
          icon: 'bg-blue-500 text-white animate-pulse',
          text: 'text-blue-700 font-semibold',
          badge: <ClockIcon className="w-4 h-4 text-blue-600" />,
        };
      case 'locked':
        return {
          container: 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed',
          icon: 'bg-gray-300 text-gray-500',
          text: 'text-gray-400',
          badge: <LockClosedIcon className="w-4 h-4 text-gray-400" />,
        };
      default: // upcoming
        return {
          container: 'bg-white border-gray-300 hover:border-blue-300 cursor-pointer',
          icon: 'bg-gray-200 text-gray-600',
          text: 'text-gray-600',
          badge: <ClockIcon className="w-4 h-4 text-gray-400" />,
        };
    }
  };

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Workflow de production</h2>
        <div className="text-xs text-gray-500">
          Étape {currentStep} / {WORKFLOW_STEPS.length}
        </div>
      </div>

      {/* Stepper horizontal */}
      <div className="flex items-start gap-2 overflow-x-auto pb-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const status = getStepStatus(step.id);
          const styles = getStepStyles(status);
          const isClickable = status !== 'locked';

          return (
            <div key={step.id} className="flex items-start gap-2">
              {/* Étape */}
              <div
                onClick={() => isClickable && onStepClick(step.id, step.tabId)}
                className={`
                  flex-shrink-0 w-32 border-2 rounded-lg p-2 transition-all
                  ${styles.container}
                `}
                title={step.description}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-lg ${styles.icon} w-7 h-7 rounded-full flex items-center justify-center text-sm`}>
                    {step.icon}
                  </span>
                  {styles.badge}
                </div>

                {/* Label */}
                <div className={`text-xs ${styles.text} line-clamp-2 leading-tight`}>
                  {step.label}
                </div>
              </div>

              {/* Connecteur */}
              {index < WORKFLOW_STEPS.length - 1 && (
                <div className="flex items-center h-12 pt-3">
                  <div className={`w-4 h-0.5 ${
                    completedSteps.has(step.id) ? 'bg-green-400' : 'bg-gray-300'
                  }`} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Barre de progression globale */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-green-400 to-blue-500 h-full transition-all duration-500"
            style={{ width: `${(completedSteps.size / WORKFLOW_STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium text-gray-600">
          {completedSteps.size}/{WORKFLOW_STEPS.length} complétées
        </span>
      </div>
    </div>
  );
}
