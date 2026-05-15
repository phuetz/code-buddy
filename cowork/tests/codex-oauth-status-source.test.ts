import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');
const settingsApiPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsAPI.tsx'
);

describe('Codex OAuth status honesty', () => {
  it('does not report unreadable credentials as a successful status check', () => {
    const source = fs.readFileSync(mainIndexPath, 'utf8');

    expect(source).not.toContain(
      "return { success: true, signedIn: false, error: 'credentials present but unreadable' };"
    );
    expect(source).toContain(
      "return { success: false, signedIn: false, error: 'credentials present but unreadable' };"
    );
  });

  it('clears the ChatGPT badge when the status check fails', () => {
    const source = fs.readFileSync(settingsApiPath, 'utf8');

    expect(source).toContain('} else {\n        setChatgptStatus({ signedIn: false });\n      }');
  });
});
