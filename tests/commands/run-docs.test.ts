import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('buddy run documentation', () => {
  const commandsDoc = readFileSync(path.join(process.cwd(), 'docs/commands.md'), 'utf8');

  it('documents tail as requiring a run id, matching the CLI', () => {
    expect(commandsDoc).toMatch(/buddy run tail <run-id>/);
    expect(commandsDoc).not.toMatch(/buddy run tail \[--follow\]/);
  });

  it('documents replay as re-executing recorded tool events', () => {
    expect(commandsDoc).toMatch(/buddy run replay <run-id>/);
    expect(commandsDoc).toMatch(/re-execute|rejoue|tool events|view_file/i);
  });

  it('does not claim runs live in the project .codebuddy/runs when they default to the home store', () => {
    expect(commandsDoc).toMatch(/~\/\.codebuddy\/runs|CODEBUDDY_RUNS_DIR/);
  });
});
