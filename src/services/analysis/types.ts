/**
 * Analysis Types
 * extracted from src/agent/specialized/code-guardian-agent.ts
 */

/** Modes de fonctionnement de l'agent */
export type CodeGuardianMode =
  | 'ANALYZE_ONLY'
  | 'SUGGEST_REFACTOR'
  | 'PATCH_PLAN'
  | 'PATCH_DIFF';

/** Niveau de sévérité des problèmes détectés */
export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Type de problème détecté */
export type IssueType =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'complexity'
  | 'style'
  | 'duplication'
  | 'dead-code'
  | 'dependency'
  | 'architecture'
  | 'documentation';

/** Problème détecté dans le code */
export interface CodeIssue {
  type: IssueType;
  severity: IssueSeverity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
  code?: string;
}

/** Dépendance d'un fichier */
export interface FileDependency {
  path: string;
  type: 'import' | 'export' | 'require' | 'type-import';
  isExternal: boolean;
}

/** Analyse d'un fichier */
export interface FileAnalysis {
  path: string;
  relativePath: string;
  size: number;
  lines: number;
  language: string;
  complexity?: number;
  dependencies: FileDependency[];
  exports: string[];
  issues: CodeIssue[];
  summary: string;
}

/** Analyse complète du projet/module */
export interface CodeAnalysis {
  rootDir: string;
  timestamp: Date;
  mode: CodeGuardianMode;
  files: FileAnalysis[];
  totalFiles: number;
  totalLines: number;
  issuesByType: Record<IssueType, number>;
  issuesBySeverity: Record<IssueSeverity, number>;
  architectureSummary: string;
  recommendations: string[];
  dependencyGraph?: Map<string, string[]>;
}

/** Suggestion de refactoring */
export interface RefactorSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  estimatedImpact: string;
  risks: string[];
  testSuggestions: string[];
  pseudoCode?: string;
}

/** Étape d'un plan de modification */
export interface PatchStep {
  order: number;
  file: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  type: 'bugfix' | 'refactor' | 'feature' | 'doc' | 'test' | 'config';
  description: string;
  dependencies: number[]; // References to other steps
  rollbackStrategy: string;
}

/** Plan de modifications */
export interface PatchPlan {
  id: string;
  title: string;
  description: string;
  steps: PatchStep[];
  totalFiles: number;
  estimatedRisk: 'low' | 'medium' | 'high';
  testPlan: string[];
  rollbackPlan: string;
}

/** Diff d'une modification */
export interface PatchDiff {
  file: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
  hunks: Array<{
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
    context: string;
  }>;
  explanation: string;
  warnings: string[];
}
