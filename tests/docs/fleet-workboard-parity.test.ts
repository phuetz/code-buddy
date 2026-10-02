import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('acknowledges OpenClaw Workboard without claiming overall fleet superiority', () => {
  const doc = readFileSync(new URL('../../docs/hermes-openclaw-parity.md', import.meta.url), 'utf8');
  const section = doc.split('## 3. Gaps vs OpenClaw')[1]!.split('## 4.')[0]!;
  expect(section).toContain('Workboard');
  expect(section).not.toMatch(/no shared peer task board|it \*\*exceeds\*\* OpenClaw/);
  expect(section).toMatch(/advisory|optimistic/);
});
