import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const launchScript = fs.readFileSync(path.join(process.cwd(), 'launch-cowork.sh'), 'utf8');

describe('Linux Cowork launcher documentation', () => {
  it('documents an isolated Xvfb launch without a fixed display address', () => {
    expect(launchScript).toContain('xvfb-run -a ./launch-cowork.sh');
    expect(launchScript).not.toMatch(/--display\s+:\d/);
    expect(launchScript).not.toContain("usage() { sed -n '3,20p'");
  });
});
