/** Blocking-gate defect classification and append-only retry receipts. */

import { constants as fsConstants } from 'fs';
import { open } from 'fs/promises';

const SHA256 = /^[a-f0-9]{64}$/u;

export type NativeFashionGate =
  | 'identity'
  | 'anatomy'
  | 'temporal-stability'
  | 'outfit'
  | 'decor-framing'
  | 'master-properties';

export interface GateResult {
  gate: NativeFashionGate;
  pass: boolean;
  evidence: string;
}

export interface ClassifiedNativeFashionDefect {
  gate: NativeFashionGate;
  causalAdjustment: string;
}

const GATE_ORDER: readonly NativeFashionGate[] = [
  'identity',
  'anatomy',
  'temporal-stability',
  'outfit',
  'decor-framing',
  'master-properties',
];

/** Every retry changes the parameter family most directly linked to its failed gate. */
export const NATIVE_FASHION_CAUSAL_ADJUSTMENTS: Readonly<Record<NativeFashionGate, string>> = {
  identity: 'strengthen identity LoRA and face conditioning',
  anatomy: 'adjust skeleton and pose control, then change the seed',
  'temporal-stability': 'change the seed and temporal engine parameters',
  outfit: 'strengthen outfit conditioning and revise the outfit prompt',
  'decor-framing': 'revise the decor and framing prompt, then change the seed',
  'master-properties': 'correct native generation and encoding parameters',
};

export function classifyDefects(results: readonly GateResult[]): ClassifiedNativeFashionDefect[] {
  const failed = new Set(results.filter((result) => !result.pass).map((result) => result.gate));
  return GATE_ORDER
    .filter((gate) => failed.has(gate))
    .map((gate) => ({ gate, causalAdjustment: NATIVE_FASHION_CAUSAL_ADJUSTMENTS[gate] }));
}

export interface RetryReceipt {
  attempt: number;
  batchId: string;
  sceneId: string;
  candidateSha256: string;
  seed: number;
  adjustedParameters: string[];
  failedGates: NativeFashionGate[];
  verdict: 'rejected' | 'promoted-to-human-review' | 'batch-exhausted';
  at: string;
}

function assertRetryReceipt(receipt: RetryReceipt): void {
  if (!Number.isInteger(receipt.attempt) || receipt.attempt < 1) {
    throw new Error('Retry receipt attempt must be a positive integer');
  }
  if (!receipt.batchId.trim() || !receipt.sceneId.trim()) {
    throw new Error('Retry receipt batchId and sceneId are required');
  }
  if (!SHA256.test(receipt.candidateSha256)) {
    throw new Error('Retry receipt candidateSha256 must be a lowercase SHA-256');
  }
  if (!Number.isSafeInteger(receipt.seed)) throw new Error('Retry receipt seed must be a safe integer');
  if (!receipt.adjustedParameters.every((parameter) => parameter.trim().length > 0)) {
    throw new Error('Retry receipt adjustedParameters must contain non-empty descriptions');
  }
  if (receipt.attempt > 1 && receipt.adjustedParameters.length === 0) {
    throw new Error('A retry must adjust causal parameters; an identical retry is not allowed');
  }
  if (!receipt.failedGates.every((gate) => GATE_ORDER.includes(gate))) {
    throw new Error('Retry receipt contains an unknown failed gate');
  }
  if (receipt.verdict === 'promoted-to-human-review' && receipt.failedGates.length > 0) {
    throw new Error('A candidate with a failed blocking gate cannot be promoted to human review');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(receipt.at) || !Number.isFinite(Date.parse(receipt.at))) {
    throw new Error('Retry receipt at must be an ISO UTC timestamp');
  }
}

export async function appendRetryReceipt(journalPath: string, receipt: RetryReceipt): Promise<void> {
  assertRetryReceipt(receipt);
  const handle = await open(
    journalPath,
    fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Retry journal must be a regular non-symlink file');
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export function assertBatchBounded(receipts: readonly RetryReceipt[], maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer');
  }
  for (const receipt of receipts) {
    assertRetryReceipt(receipt);
    if (receipt.attempt >= maxAttempts && receipt.verdict !== 'batch-exhausted') {
      throw new Error(
        `Attempt ${receipt.attempt} reached batch bound ${maxAttempts}; verdict must be batch-exhausted`,
      );
    }
  }
}
