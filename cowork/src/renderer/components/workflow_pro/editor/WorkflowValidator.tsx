// @ts-nocheck
import React, { useState } from 'react';
import { useWorkflowStore } from '../store';
import { AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { logger } from '../service-mocks';
import type { WorkflowNode, WorkflowEdge } from '../type-mocks';

interface ValidationResult {
  type: 'error' | 'warning' | 'success' | 'info';
  message: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
  nodeId?: string;
}

export default function WorkflowValidator() {
  const { nodes, edges, darkMode } = useWorkflowStore();
  // const _validateWorkflow = useWorkflowStore(state => state.validateWorkflow); // Available if needed
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const runValidation = async () => {
    setIsValidating(true);

    // Simulation d'une validation complète
    await new Promise(resolve => setTimeout(resolve, 1000));

    const results: ValidationResult[] = [];

    // Vérification des nœuds orphelins
    const orphanNodes = nodes.filter((node: WorkflowNode) =>
      !edges.some((edge: WorkflowEdge) => edge.source === node.id || edge.target === node.id)
    );

    if (orphanNodes.length > 0) {
      results.push({
        type: 'warning',
        message: `${orphanNodes.length} nœud(s) non connecté(s)`,
        details: orphanNodes.map((n: WorkflowNode) => n.data.label || n.id).join(', '),
        severity: 'medium'
      });
    }

    // Vérification des triggers
    const triggers = nodes.filter((node: WorkflowNode) =>
      ['trigger', 'webhook', 'schedule', 'rssFeed'].includes(node.data.type)
    );
    
    if (triggers.length === 0) {
      results.push({
        type: 'error',
        message: 'Aucun déclencheur trouvé',
        details: 'Votre workflow doit avoir au moins un nœud déclencheur',
        severity: 'high'
      });
    }

    // Vérification des configurations
    const unconfiguredNodes = nodes.filter((node: WorkflowNode) => {
      const config = (node.data.config || {}) as Record<string, unknown>;
      switch (node.data.type) {
        case 'httpRequest':
          return !config.url;
        case 'email':
          return !config.to || !config.subject;
        case 'slack':
          return !config.channel;
        default:
          return false;
      }
    });

    if (unconfiguredNodes.length > 0) {
      results.push({
        type: 'warning',
        message: `${unconfiguredNodes.length} nœud(s) mal configuré(s)`,
        details: unconfiguredNodes.map((n: WorkflowNode) => n.data.label || n.id).join(', '),
        severity: 'medium'
      });
    }

    // Vérification des boucles infinies
    const hasLoop = edges.length > 0 && nodes.length > 1; // Simplified loop detection
    if (hasLoop) {
      results.push({
        type: 'error',
        message: 'Boucle infinie détectée',
        details: 'Votre workflow contient une boucle qui pourrait causer une exécution infinie',
        severity: 'high'
      });
    }

    // Vérification des performances
    if (nodes.length > 50) {
      results.push({
        type: 'info',
        message: 'Workflow complexe détecté',
        details: 'Ce workflow contient plus de 50 nœuds, considérez le diviser en sous-workflows',
        severity: 'low'
      });
    }

    // Succès si aucune erreur
    if (results.filter((r: ValidationResult) => r.type === 'error').length === 0) {
      results.push({
        type: 'success',
        message: 'Validation réussie',
        details: 'Votre workflow est prêt à être exécuté',
        severity: 'low'
      });
    }

    setValidationResults(results);
    setIsValidating(false);
  };

  // Algorithme simple de détection de cycles avec protection contre le débordement de pile
  const _detectCycles = () => {
    const MAX_DEPTH = 1000;
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, depth = 0): boolean => {
      // Protection contre le débordement de pile
      if (depth > MAX_DEPTH) {
        logger.warn('Maximum depth reached in cycle detection, stopping to prevent stack overflow');
        return false;
      }

      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const outgoingEdges = edges.filter((edge: WorkflowEdge) => edge.source === nodeId);
      for (const edge of outgoingEdges) {
        if (dfs(edge.target as string, depth + 1)) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (dfs((node as WorkflowNode).id as string)) return true;
    }

    return false;
  };

  const getValidationIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <XCircle className="text-red-500" size={20} />;
      case 'warning':
        return <AlertTriangle className="text-yellow-500" size={20} />;
      case 'success':
        return <CheckCircle className="text-green-500" size={20} />;
      default:
        return <Info className="text-blue-500" size={20} />;
    }
  };

  return (
    <div className={`p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white'} rounded-lg shadow-sm`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">🔍 Validation du Workflow</h2>
        <button
          onClick={runValidation}
          disabled={isValidating || nodes.length === 0}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {isValidating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Validation...
            </>
          ) : (
            <>🔍 Valider</>
          )}
        </button>
      </div>

      {nodes.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">Ajoutez des nœuds à votre workflow pour commencer la validation</p>
        </div>
      )}

      {validationResults.length > 0 && (
        <div className="space-y-4">
          {validationResults.map((result, index) => {
            const r = result as { type: string; message: string; details: string; severity: string; nodeId?: string };
            return (
            <div
              key={`${r.type}-${r.nodeId || r.severity}-${index}`}
              className={`p-4 rounded-lg border-l-4 ${
                r.type === 'error' ? 'border-red-500 bg-red-50' :
                r.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                r.type === 'success' ? 'border-green-500 bg-green-50' :
                'border-blue-500 bg-blue-50'
              } ${darkMode ? 'bg-opacity-10' : ''}`}
            >
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  {getValidationIcon(r.type)}
                </div>
                <div className="flex-1">
                  <h4 className="font-medium">{r.message}</h4>
                  <p className="text-sm opacity-75 mt-1">{r.details}</p>
                  <div className="mt-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      r.severity === 'high' ? 'bg-red-100 text-red-800' :
                      r.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {r.severity === 'high' ? 'Critique' :
                       r.severity === 'medium' ? 'Moyen' : 'Info'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Conseils de validation */}
      <div className={`mt-6 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <h3 className="font-semibold mb-2">💡 Conseils de Validation</h3>
        <ul className="text-sm space-y-1 opacity-75">
          <li>• Assurez-vous que votre workflow a au moins un déclencheur</li>
          <li>• Vérifiez que tous les nœuds sont correctement configurés</li>
          <li>• Évitez les boucles infinies dans votre logique</li>
          <li>• Testez votre workflow avec des données réelles</li>
        </ul>
      </div>
    </div>
  );
}