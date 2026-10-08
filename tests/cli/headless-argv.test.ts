import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { detachHeadlessSwitchFromFollowingOption } from '../../src/cli/headless-argv.js';

const FLEET_ARGV = [
  'node',
  'buddy',
  '-p',
  '-m',
  'deepseek/deepseek-v4.1-flash',
  '--permission-mode',
  'dontAsk',
  '--max-tool-rounds',
  '8',
  'Lis calc.js, exécute node calc.js, puis conclus.',
];

function parseFleet(argv: readonly string[]): {
  prompt?: string;
  model?: string;
  headless?: boolean;
  message: string[];
} {
  const program = new Command();
  program.exitOverride();
  program.enablePositionalOptions();
  program.argument('[message...]', 'message');
  program.option('-m, --model <model>', 'model');
  program.option('-p, --prompt <prompt>', 'prompt');
  program.option('--print <prompt>', 'print');
  program.option('--headless', 'headless');
  program.option('--permission-mode <mode>', 'permission');
  program.option('--max-tool-rounds <rounds>', 'rounds');
  let seen: { prompt?: string; model?: string; headless?: boolean; message: string[] } = {
    message: [],
  };
  program.action((message: string[], options: { prompt?: string; model?: string; headless?: boolean }) => {
    seen = {
      message,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.headless ? { headless: true } : {}),
    };
  });
  program.parse(argv);
  return seen;
}

describe('detachHeadlessSwitchFromFollowingOption', () => {
  it('laisse buddy -p "prompt" -m modèle inchangé', () => {
    const argv = ['node', 'buddy', '-p', 'Bonjour', '-m', 'deepseek/deepseek-v4.1-flash'];
    expect(detachHeadlessSwitchFromFollowingOption(argv)).toEqual(argv);
    const parsed = parseFleet(argv);
    expect(parsed.prompt).toBe('Bonjour');
    expect(parsed.model).toBe('deepseek/deepseek-v4.1-flash');
    expect(parsed.headless).toBeUndefined();
  });

  it('ne laisse plus -p avaler -m : le modèle et le prompt positionnel restent distincts', () => {
    const swallowed = parseFleet(FLEET_ARGV);
    expect(swallowed.prompt).toBe('-m');
    expect(swallowed.model).toBeUndefined();
    expect(swallowed.message[0]).toBe('deepseek/deepseek-v4.1-flash');

    const repaired = detachHeadlessSwitchFromFollowingOption(FLEET_ARGV);
    expect(repaired).toEqual([
      'node',
      'buddy',
      '--headless',
      '-m',
      'deepseek/deepseek-v4.1-flash',
      '--permission-mode',
      'dontAsk',
      '--max-tool-rounds',
      '8',
      'Lis calc.js, exécute node calc.js, puis conclus.',
    ]);
    const parsed = parseFleet(repaired);
    expect(parsed.prompt).toBeUndefined();
    expect(parsed.headless).toBe(true);
    expect(parsed.model).toBe('deepseek/deepseek-v4.1-flash');
    expect(parsed.message).toEqual(['Lis calc.js, exécute node calc.js, puis conclus.']);
  });

  it('respecte -- comme fin des options', () => {
    const argv = ['node', 'buddy', '-p', '--', '-m reste du texte'];
    expect(detachHeadlessSwitchFromFollowingOption(argv)).toEqual([
      'node',
      'buddy',
      '--headless',
      '--',
      '-m reste du texte',
    ]);
  });
});
