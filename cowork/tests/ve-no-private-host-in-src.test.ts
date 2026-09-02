import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(process.cwd(), 'src');
const markerHost = ['100', '73', ''].join('.');
const markerName = ['dark', 'star'].join('');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('Cowork source tree private-host guard (VE)', () => {
  it('does not embed the private host marker or machine name in cowork/src', () => {
    const files = walk(srcRoot).filter((file) => !/\.(png|jpe?g|gif|ico|woff2?)$/i.test(file));
    const faults: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      const rel = path.relative(srcRoot, file);
      if (text.includes(markerHost)) faults.push(`${rel} contains host marker`);
      if (text.includes(markerName)) faults.push(`${rel} contains machine marker`);
    }
    expect(faults).toEqual([]);
  });
});
