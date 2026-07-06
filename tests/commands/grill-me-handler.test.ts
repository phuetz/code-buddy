import { describe, expect, it } from 'vitest';
import { handleGrillMe } from '../../src/commands/handlers/grill-me-handler.js';

describe('handleGrillMe', () => {
  it('passes a non-empty prompt to the AI', async () => {
    const result = await handleGrillMe([]);

    expect(result.handled).toBe(true);
    expect(result.passToAI).toBe(true);
    expect(result.prompt).toBeTruthy();
    expect(result.prompt?.length).toBeGreaterThan(0);
  });

  it('includes recent git inspection instructions', async () => {
    const result = await handleGrillMe([]);

    expect(result.prompt).toContain('git log -5');
    expect(result.prompt).toContain('git diff HEAD~1');
    expect(result.prompt).toContain('fichiers modifiés');
  });

  it('switches to brutal ROAST instructions with --yolo', async () => {
    const regular = await handleGrillMe([]);
    const yolo = await handleGrillMe(['--yolo']);

    expect(yolo.prompt).not.toBe(regular.prompt);
    expect(yolo.prompt).toContain('ROAST');
    expect(yolo.prompt).toContain('brutal');
  });

  it('targets remaining args instead of only recent work', async () => {
    const result = await handleGrillMe(['--yolo', 'src/foo.ts']);

    expect(result.prompt).toContain('Sujet ciblé');
    expect(result.prompt).toContain('src/foo.ts');
    expect(result.prompt).not.toContain('Sujet par défaut');
  });
});
