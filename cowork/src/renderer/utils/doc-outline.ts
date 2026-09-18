/**
 * Pure helpers for long-form AI document outlines.
 *
 * @module renderer/utils/doc-outline
 */

export interface DocSection {
  id: string;
  title: string;
  summary: string;
  estimatedWords?: number;
}

function cleanTopic(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Document sans titre';
  return cleaned.length > 72 ? `${cleaned.slice(0, 69).trim()}...` : cleaned;
}

export function draftDocOutline(prompt: string): DocSection[] {
  const topic = cleanTopic(prompt);
  return [
    {
      id: 'executive-summary',
      title: 'Résumé exécutif',
      summary: `Synthèse courte de **${topic}**, avec décisions attendues et valeur métier.`,
      estimatedWords: 250,
    },
    {
      id: 'context',
      title: 'Contexte et objectifs',
      summary: 'Cadre du problème, audience, contraintes, critères de réussite.',
      estimatedWords: 450,
    },
    {
      id: 'analysis',
      title: 'Analyse',
      summary: 'Constats détaillés, données utiles, alternatives et arbitrages.',
      estimatedWords: 900,
    },
    {
      id: 'recommendations',
      title: 'Recommandations',
      summary: 'Actions proposées, priorités, dépendances, risques et garde-fous.',
      estimatedWords: 650,
    },
    {
      id: 'appendix',
      title: 'Annexes',
      summary: 'Sources, hypothèses, détails techniques et éléments de traçabilité.',
      estimatedWords: 350,
    },
  ];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateReadingTime(sections: DocSection[]): number {
  const words = sections.reduce((total, section) => total + (section.estimatedWords ?? countWords(section.summary)), 0);
  if (words <= 0) return 0;
  return Math.ceil(words / 220);
}

/** Flatten a DocComposer outline into Markdown for office export. */
export function docSectionsToMarkdown(title: string, sections: DocSection[]): string {
  const heading = title.trim() || 'Sans titre';
  const parts = [`# ${heading}`, ''];
  for (const section of sections) {
    parts.push('---', '', `## ${section.title.trim() || 'Sans titre'}`, '', section.summary.trim(), '');
  }
  return parts.join('\n').trim() + '\n';
}
