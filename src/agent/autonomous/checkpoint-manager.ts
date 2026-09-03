import * as path from 'node:path';
import * as os from 'node:os';
import { AgenticCodingTaskContract } from './agentic-coding-contract.js';
// Type-only import: breaks the agentic-coding-runner ↔ checkpoint-manager cycle
// (madge runs with skipTypeImports, so `import type` edges are not counted).
import type { AgenticCodingRunOptions, AgenticCodingRunReport, AgenticCodingVerificationResult } from './agentic-coding-runner.js';
import { CodeExplorerContext, WorldModelInvariants } from '../../tools/code-explorer-tool.js';
import { readJsonAtomic, writeJsonAtomic } from '../../utils/atomic-write.js';

export interface AgenticCodingCheckpoint {
  runId: string;
  options: AgenticCodingRunOptions;
  contract: AgenticCodingTaskContract;
  step: 'initialized' | 'decomposed' | 'proposal_generated' | 'applied' | 'verified' | 'blocked';
  blockedReasons?: string[];
  subtasks?: AgenticCodingTaskContract[];
  currentSubtaskIndex?: number;
  reports?: AgenticCodingRunReport[];
  timestamp: string;
  verification?: AgenticCodingVerificationResult[];
  codeexplorerEvidence?: CodeExplorerContext;
  worldModelInvariants?: WorldModelInvariants | null;
}

export function getCheckpointPath(runId: string): string {
  const base = process.env.CODEBUDDY_HOME || path.join(os.homedir(), '.codebuddy');
  return path.join(base, 'runs', runId, 'state.json');
}

export async function saveCheckpoint(checkpoint: AgenticCodingCheckpoint): Promise<void> {
  const filePath = getCheckpointPath(checkpoint.runId);
  await writeJsonAtomic(filePath, checkpoint);
}

export async function loadCheckpoint(runId: string): Promise<AgenticCodingCheckpoint | null> {
  const filePath = getCheckpointPath(runId);
  try {
    return await readJsonAtomic<AgenticCodingCheckpoint | null>(filePath, null);
  } catch {
    return null;
  }
}
