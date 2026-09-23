import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { MeetingNotesTool } from '../../../src/tools/meeting-notes-tool';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-meeting-notes-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('meeting_notes tool handles a simple transcript', async () => {
  const transcriptPath = path.join(tmpDir, 'transcript.txt');
  const transcriptContent = "Speaker 1: Welcome to the meeting.\nSpeaker 2: I will fix the database bug today.\nSpeaker 1: Great, that is our only action item.";
  await fs.promises.writeFile(transcriptPath, transcriptContent, 'utf8');

  const tool = new MeetingNotesTool();
  // Simulate active workspace via context
  const context = { cwd: tmpDir };
  const result = await tool.execute({ input_path: transcriptPath }, context as any);
  
  // meeting_notes is deterministic and doesn't use network, should succeed
  expect(result.success).toBe(true);
  expect(String(result.output)).toContain('## Actions');
  const notes = (result.data as { notes: { actionItems: Array<{ task: string }> } }).notes;
  expect(notes.actionItems.length).toBeGreaterThan(0);
  expect(notes.actionItems.map((item) => item.task).join('\n')).toContain('database');
  console.log('[meeting_notes]', String(result.output).slice(0, 500));
});
