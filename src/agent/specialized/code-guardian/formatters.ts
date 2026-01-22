/**
 * Code Guardian Formatters
 *
 * Output formatting functions for the Code Guardian agent.
 */

import type {
  IssueSeverity,
  FileAnalysis,
  CodeAnalysis,
  CodeIssue,
  RefactorSuggestion,
  PatchPlan,
  PatchDiff,
} from '../../../services/analysis/types.js';

// ============================================================================
// Helpers
// ============================================================================

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getSeverityIcon(severity: IssueSeverity): string {
  const icons: Record<IssueSeverity, string> = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    critical: '🚨',
  };
  return icons[severity];
}

export function groupIssuesBySeverity(issues: CodeIssue[]): Record<string, CodeIssue[]> {
  return issues.reduce((acc, issue) => {
    if (!acc[issue.severity]) acc[issue.severity] = [];
    acc[issue.severity].push(issue);
    return acc;
  }, {} as Record<string, CodeIssue[]>);
}

// ============================================================================
// File Analysis Formatter
// ============================================================================

export function formatFileAnalysis(analysis: FileAnalysis): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║  📊 ANALYSE DE CODE - CodeBuddynette Code Guardian               ║',
    '╠══════════════════════════════════════════════════════════════╣',
    '',
    `📁 Fichier: ${analysis.path}`,
    `📝 Langage: ${analysis.language}`,
    `📏 Lignes: ${analysis.lines} | Taille: ${formatSize(analysis.size)}`,
    `🔄 Complexité estimée: ${analysis.complexity}`,
    '',
    '── Résumé ──────────────────────────────────────────────────────',
    analysis.summary,
    '',
  ];

  if (analysis.dependencies.length > 0) {
    lines.push('── Dépendances ─────────────────────────────────────────────────');
    const internal = analysis.dependencies.filter(d => !d.isExternal);
    const external = analysis.dependencies.filter(d => d.isExternal);
    if (internal.length > 0) {
      lines.push(`  Internes (${internal.length}):`);
      internal.slice(0, 10).forEach(d => lines.push(`    → ${d.path}`));
      if (internal.length > 10) lines.push(`    ... et ${internal.length - 10} autres`);
    }
    if (external.length > 0) {
      lines.push(`  Externes (${external.length}):`);
      external.slice(0, 10).forEach(d => lines.push(`    📦 ${d.path}`));
      if (external.length > 10) lines.push(`    ... et ${external.length - 10} autres`);
    }
    lines.push('');
  }

  if (analysis.exports.length > 0) {
    lines.push('── Exports ─────────────────────────────────────────────────────');
    lines.push(`  ${analysis.exports.join(', ')}`);
    lines.push('');
  }

  if (analysis.issues.length > 0) {
    lines.push('── Problèmes détectés ──────────────────────────────────────────');
    const grouped = groupIssuesBySeverity(analysis.issues);
    for (const [severity, issues] of Object.entries(grouped)) {
      const icon = getSeverityIcon(severity as IssueSeverity);
      lines.push(`${icon} ${severity.toUpperCase()} (${issues.length}):`);
      issues.slice(0, 5).forEach(issue => {
        lines.push(`    L${issue.line || '?'}: ${issue.message}`);
        if (issue.suggestion) {
          lines.push(`       💡 ${issue.suggestion}`);
        }
      });
      if (issues.length > 5) {
        lines.push(`    ... et ${issues.length - 5} autres`);
      }
    }
  } else {
    lines.push('✅ Aucun problème détecté');
  }

  lines.push('');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================================
// Code Analysis Formatter
// ============================================================================

export function formatCodeAnalysis(analysis: CodeAnalysis): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════════╗',
    '║  🛡️ ANALYSE DE PROJET - CodeBuddynette Code Guardian                 ║',
    '╠══════════════════════════════════════════════════════════════════╣',
    '',
    `📁 Répertoire: ${analysis.rootDir}`,
    `📅 Date: ${analysis.timestamp.toISOString()}`,
    `🔧 Mode: ${analysis.mode}`,
    '',
    `📊 Statistiques:`,
    `   Fichiers analysés: ${analysis.totalFiles}`,
    `   Lignes totales: ${analysis.totalLines.toLocaleString()}`,
    '',
  ];

  // Problèmes par sévérité
  const severityOrder: IssueSeverity[] = ['critical', 'error', 'warning', 'info'];
  const hasIssues = Object.values(analysis.issuesBySeverity).some(v => v > 0);

  if (hasIssues) {
    lines.push('── Problèmes par sévérité ──────────────────────────────────────');
    for (const severity of severityOrder) {
      const count = analysis.issuesBySeverity[severity] || 0;
      if (count > 0) {
        lines.push(`   ${getSeverityIcon(severity)} ${severity}: ${count}`);
      }
    }
    lines.push('');
  }

  // Architecture
  lines.push('── Architecture ────────────────────────────────────────────────');
  lines.push(analysis.architectureSummary);
  lines.push('');

  // Recommandations
  if (analysis.recommendations.length > 0) {
    lines.push('── Recommandations ─────────────────────────────────────────────');
    analysis.recommendations.forEach(r => lines.push(`   ${r}`));
    lines.push('');
  }

  // Top fichiers problématiques
  const problematicFiles = [...analysis.files]
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 5)
    .filter(f => f.issues.length > 0);

  if (problematicFiles.length > 0) {
    lines.push('── Top fichiers à revoir ───────────────────────────────────────');
    problematicFiles.forEach(f => {
      lines.push(`   📄 ${f.relativePath} (${f.issues.length} problèmes)`);
    });
    lines.push('');
  }

  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================================
// Refactor Suggestions Formatter
// ============================================================================

export function formatRefactorSuggestions(suggestions: RefactorSuggestion[]): string {
  if (suggestions.length === 0) {
    return '✅ Aucune suggestion de refactoring majeure';
  }

  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║  💡 SUGGESTIONS DE REFACTORING                               ║',
    '╠══════════════════════════════════════════════════════════════╣',
    '',
  ];

  const priorityOrder = ['critical', 'high', 'medium', 'low'];
  const sorted = [...suggestions].sort((a, b) =>
    priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
  );

  for (const suggestion of sorted) {
    const priorityIcon = {
      critical: '🚨',
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    }[suggestion.priority];

    lines.push(`${priorityIcon} ${suggestion.title}`);
    lines.push(`   ${suggestion.description}`);
    lines.push(`   📁 Fichiers: ${suggestion.affectedFiles.join(', ')}`);
    lines.push(`   📈 Impact: ${suggestion.estimatedImpact}`);
    if (suggestion.risks.length > 0) {
      lines.push(`   ⚠️ Risques: ${suggestion.risks.join(', ')}`);
    }
    if (suggestion.pseudoCode) {
      lines.push('   📝 Approche suggérée:');
      suggestion.pseudoCode.split('\n').forEach(l => lines.push(`      ${l}`));
    }
    lines.push('');
  }

  lines.push('╚══════════════════════════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================================
// Patch Plan Formatter
// ============================================================================

export function formatPatchPlan(plan: PatchPlan): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║  📋 PLAN DE MODIFICATIONS                                    ║',
    '╠══════════════════════════════════════════════════════════════╣',
    '',
    `📌 ${plan.title}`,
    `📝 ${plan.description}`,
    `⚠️ Risque estimé: ${plan.estimatedRisk.toUpperCase()}`,
    '',
    '── Étapes ──────────────────────────────────────────────────────',
  ];

  for (const step of plan.steps) {
    const actionIcon = {
      create: '➕',
      modify: '✏️',
      delete: '🗑️',
      rename: '📛',
    }[step.action];
    lines.push(`${step.order}. ${actionIcon} [${step.type}] ${step.file}`);
    lines.push(`   ${step.description}`);
  }

  lines.push('');
  lines.push('── Plan de test ────────────────────────────────────────────────');
  plan.testPlan.forEach((t, i) => lines.push(`${i + 1}. ${t}`));

  lines.push('');
  lines.push('── Rollback ────────────────────────────────────────────────────');
  lines.push(`   ${plan.rollbackPlan}`);

  lines.push('');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================================
// Patch Diffs Formatter
// ============================================================================

export function formatPatchDiffs(diffs: PatchDiff[], plan: PatchPlan): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║  📝 DIFFS PROPOSÉS                                           ║',
    '╠══════════════════════════════════════════════════════════════╣',
    '',
    `⚠️ ATTENTION: Les modifications ci-dessous nécessitent validation humaine`,
    '',
  ];

  for (const diff of diffs) {
    const actionIcon = {
      create: '➕ CREATE',
      modify: '✏️ MODIFY',
      delete: '🗑️ DELETE',
      rename: '📛 RENAME',
    }[diff.action];

    lines.push(`─── ${actionIcon}: ${diff.file} ───────────────────────────────`);
    lines.push(`📖 ${diff.explanation}`);

    if (diff.warnings.length > 0) {
      diff.warnings.forEach(w => lines.push(`⚠️ ${w}`));
    }

    lines.push('');
  }

  lines.push('── Instructions d\'application ──────────────────────────────────');
  lines.push('1. Vérifier chaque diff avant application');
  lines.push('2. Créer un commit de backup ou utiliser git stash');
  lines.push('3. Appliquer les modifications une par une');
  lines.push('4. Exécuter les tests après chaque modification');
  lines.push(`5. En cas de problème: ${plan.rollbackPlan}`);

  lines.push('');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================================
// Issues List Formatter
// ============================================================================

export function formatIssuesList(issues: CodeIssue[]): string {
  if (issues.length === 0) {
    return '✅ Aucun problème trouvé';
  }

  const lines: string[] = [
    `🔍 ${issues.length} problème(s) trouvé(s)`,
    '',
  ];

  // Grouper par fichier
  const byFile = new Map<string, CodeIssue[]>();
  for (const issue of issues) {
    const existing = byFile.get(issue.file) || [];
    existing.push(issue);
    byFile.set(issue.file, existing);
  }

  for (const [file, fileIssues] of byFile) {
    lines.push(`📄 ${file} (${fileIssues.length})`);
    for (const issue of fileIssues) {
      const icon = getSeverityIcon(issue.severity);
      lines.push(`   ${icon} L${issue.line || '?'}: [${issue.type}] ${issue.message}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Dependency Graph Formatter
// ============================================================================

export function formatDependencyGraph(graph: Map<string, string[]>): string {
  const lines: string[] = [
    '🗺️ CARTE DES DÉPENDANCES',
    '',
  ];

  for (const [file, deps] of graph) {
    if (deps.length > 0) {
      lines.push(`📄 ${file}`);
      deps.forEach(d => lines.push(`   → ${d}`));
    }
  }

  if (lines.length === 2) {
    lines.push('Aucune dépendance interne détectée');
  }

  return lines.join('\n');
}
