import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fleet-guide.md', () => {
  it('shows network binding and a shared secret in remote fleet examples', () => {
    const content = readFileSync(path.join(process.cwd(), 'docs/fleet-guide.md'), 'utf8');
    expect(content).toMatch(/buddy server --port N --host 0\.0\.0\.0/);
    expect(content).toMatch(/export JWT_SECRET="<shared-secret>"[\s\S]*?buddy server --port 3000 --host 0\.0\.0\.0/);
    expect(content).toMatch(/export JWT_SECRET="<secret>"[\s\S]*?buddy server --port 3001 --host 0\.0\.0\.0/);
    expect(content).toContain('buddy server --host 0.0.0.0');
  });
});
