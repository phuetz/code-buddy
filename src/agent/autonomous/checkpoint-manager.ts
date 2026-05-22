import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgenticCodingTaskContract } from './agentic-coding-contract.js';
import { AgenticCodingRunOptions, AgenticCodingRunReport, AgenticCodingVerificationResult } from './agentic-coding-runner.js';
import { redactSecrets } from '../../security/data-redaction.js';
import { GitNexusContext, WorldModelInvariants } from '../../tools/gitnexus-tool.js';

export interface AgenticCodingCheckpoint {
  runId: string;
  options: AgenticCodingRunOptions;
  contract: AgenticCodingTaskContract;
  step: 'initialized' | 'decomposed' | 'proposal_generated' | 'applied' | 'verified';
  subtasks?: AgenticCodingTaskContract[];
  currentSubtaskIndex?: number;
  reports?: AgenticCodingRunReport[];
  timestamp: string;
  verification?: AgenticCodingVerificationResult[];
  gitnexusEvidence?: GitNexusContext;
  worldModelInvariants?: WorldModelInvariants | null;
}

export function getCheckpointPath(runId: string): string {
  const base = process.env.CODEBUDDY_HOME || path.join(os.homedir(), '.codebuddy');
  return path.join(base, 'runs', runId, 'state.json');
}

export async function saveCheckpoint(checkpoint: AgenticCodingCheckpoint): Promise<void> {
  const filePath = getCheckpointPath(checkpoint.runId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(checkpoint, null, 2);
  await fs.writeFile(filePath, redactSecrets(serialized), 'utf8');
}

export async function loadCheckpoint(runId: string): Promise<AgenticCodingCheckpoint | null> {
  const filePath = getCheckpointPath(runId);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data) as AgenticCodingCheckpoint;
  } catch {
    return null;
  }
}

