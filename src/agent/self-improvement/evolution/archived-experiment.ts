/** Execute a reviewed, archived fiche against the reversible lessons benchmark. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { getCodeBuddyHome } from '../../../utils/codebuddy-home.js';
import { getCollectiveKnowledgeGraph, type CollectiveKnowledgeGraph } from '../../../memory/collective-knowledge-graph.js';
import { createLessonMutatorPort } from '../index.js';
import { validateProposal, type LessonMutatorPort, type GateResult } from '../empirical-gate.js';
import { parseExperimentFiche } from './experiment-fiche.js';
import { hasTriedExperimentLesson } from './experiment-lessons.js';

const experimentInputSchema = z.object({
  lesson: z.object({
    category: z.enum(['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT']),
    content: z.string().trim().min(1),
    context: z.string().optional(),
  }).strict(),
  scenarios: z.array(z.object({
    id: z.string().trim().min(1),
    query: z.string().trim().min(1),
    expectIncludes: z.array(z.string().trim().min(1)).min(1),
    description: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
  }).strict()).min(1),
  targetScenarioId: z.string().trim().min(1),
}).strict();

export interface ArchivedExperimentOptions {
  archiveRoot?: string;
  graph?: CollectiveKnowledgeGraph;
  port?: LessonMutatorPort;
  workDir?: string;
  revision?: string;
  machine?: string;
  now?: () => Date;
}

/** The file name is an opaque id, never a user-supplied path. */
export function runArchivedFicheExperiment(
  proposalId: string,
  input: unknown,
  options: ArchivedExperimentOptions = {},
): GateResult {
  if (!/^proposal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(proposalId)) {
    throw new Error('Invalid archived proposal id');
  }
  const trial = experimentInputSchema.parse(input);
  if (!trial.scenarios.some((scenario) => scenario.id === trial.targetScenarioId) ||
    new Set(trial.scenarios.map((scenario) => scenario.id)).size !== trial.scenarios.length) {
    throw new Error('Experiment scenarios need distinct ids and the target scenario');
  }
  const root = options.archiveRoot ?? path.join(getCodeBuddyHome(), 'self-improvement', 'evolution', 'proposals');
  const archive = JSON.parse(readFileSync(path.join(root, `${proposalId}.json`), 'utf8')) as { id?: unknown; fiche?: unknown };
  if (archive.id !== proposalId) throw new Error('Archived proposal id mismatch');
  const fiche = parseExperimentFiche(archive.fiche);
  if (fiche.hypothesis.metric !== 'covered_scenarios' || fiche.hypothesis.direction !== 'increase') {
    throw new Error('This runner supports only increased covered_scenarios');
  }
  const graph = options.graph ?? getCollectiveKnowledgeGraph();
  if (hasTriedExperimentLesson(graph, fiche)) throw new Error('ALREADY_TRIED: article, feature and method have a lesson');
  const workDir = options.workDir ?? process.cwd();
  const revision = options.revision ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: workDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const provenance = {
    at: (options.now ?? (() => new Date()))().toISOString(),
    revision,
    machine: options.machine ?? os.hostname(),
    model: 'offline-capability-benchmark',
    conditions: `${trial.scenarios.length} curated scenarios; ${fiche.comparison.equalBudget.runsPerArm} runs per arm; ${fiche.comparison.currentMethod} versus ${fiche.comparison.proposedMethod}`,
  };
  return validateProposal({
    id: proposalId, kind: 'lesson', targetScenarioId: trial.targetScenarioId,
    lesson: trial.lesson,
  }, trial.scenarios, options.port ?? createLessonMutatorPort(workDir), {
    keepOnAccept: false, experiment: { fiche, graph, provenance },
  });
}
