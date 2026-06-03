import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const parityAuditPath = 'docs/hermes-agent-official-parity-audit-2026-05-30.md';

describe('public Hermes parity documentation', () => {
  it('keeps the published tool parity count aligned with the local manifest', async () => {
    const markdown = await fs.readFile(path.join(repoRoot, parityAuditPath), 'utf8');
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T16:30:00.000Z');
    const expectedCountText = [
      `Current measured tool-level state is ${manifest.summary.exact} exact`,
      `${manifest.summary.nativeEquivalent} native-equivalent`,
      `${manifest.summary.partial} partial`,
      `and ${manifest.summary.gaps} gaps.`,
    ].join(', ');

    expect(markdown).toContain(expectedCountText);
  });
});
