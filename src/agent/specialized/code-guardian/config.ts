/**
 * Code Guardian Configuration
 *
 * Configuration and constants for the Code Guardian agent.
 */

import type { SpecializedAgentConfig } from '../types.js';
import type { CodeGuardianMode } from '../../../services/analysis/types.js';

export const CODE_GUARDIAN_CONFIG: SpecializedAgentConfig = {
  id: 'code-guardian',
  name: 'CodeBuddynette - Code Guardian',
  description: 'Agent spécialisé dans l\'analyse de code, revue d\'architecture et amélioration progressive',
  capabilities: ['code-analyze', 'code-review', 'code-refactor', 'code-security'],
  fileExtensions: [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'pyw',
    'java', 'kt', 'scala',
    'go',
    'rs',
    'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
    'cs',
    'rb',
    'php',
    'swift',
    'vue', 'svelte',
    'json', 'yaml', 'yml', 'toml',
    'md', 'mdx',
    'sql',
    'sh', 'bash', 'zsh',
  ],
  maxFileSize: 10 * 1024 * 1024, // 10MB per file
  requiredTools: [],
  options: {
    defaultMode: 'ANALYZE_ONLY' as CodeGuardianMode,
  },
};

/**
 * Help text for each supported action.
 */
export const ACTION_HELP: Record<string, string> = {
  'analyze': 'Analyse complète d\'un fichier ou répertoire selon le mode actuel',
  'analyze-file': 'Analyse détaillée d\'un fichier spécifique',
  'analyze-directory': 'Analyse récursive d\'un répertoire',
  'suggest-refactor': 'Propose des suggestions de refactoring',
  'create-patch-plan': 'Crée un plan structuré de modifications',
  'create-patch-diff': 'Génère des diffs prêts à appliquer',
  'find-issues': 'Recherche les problèmes potentiels dans le code',
  'check-security': 'Vérifie les problèmes de sécurité',
  'map-dependencies': 'Cartographie les dépendances entre fichiers',
  'explain-code': 'Explique le fonctionnement du code',
  'review-architecture': 'Revue de l\'architecture du projet',
};

/**
 * List of supported actions.
 */
export const SUPPORTED_ACTIONS = [
  'analyze',
  'analyze-file',
  'analyze-directory',
  'suggest-refactor',
  'create-patch-plan',
  'create-patch-diff',
  'find-issues',
  'check-security',
  'map-dependencies',
  'explain-code',
  'review-architecture',
];
