import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC session start error handling', () => {
  it('contains the session start failure inside the hook after showing a global notice', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('id: `notice-session-start-${Date.now()}`');
    expect(source).toContain(
      "message: e instanceof Error ? e.message : i18n.t('chat.startFailed')"
    );
    expect(source).not.toContain('throw e;');
  });

  it('does not synthesize browser-mode sessions, answers, or working directories', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('Cowork desktop bridge unavailable');
    expect(source).toContain('return null;');
    expect(source).toContain('success: false');
    expect(source).not.toContain('Mock response to:');
    expect(source).not.toContain('mock-session-');
    expect(source).not.toContain('mock-step-');
    expect(source).not.toContain("'/mock/folder/path'");
    expect(source).not.toContain("'/mock/working/dir'");
  });
});
