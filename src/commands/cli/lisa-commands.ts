import type { Command } from 'commander';
import {
  LISA_ACTIONS,
  readLisaJournal,
  readLisaRules,
  setLisaRule,
  updateLisaRules,
  type LisaAction,
  type LisaColumn,
  type LisaRegime,
} from '../../companion/lisa-policy.js';

const cli = {
  stdout: (text: string): void => {
    process.stdout.write(text + '\n');
  },
};

export function registerLisaCommands(program: Command): void {
  const lisa = program
    .command('lisa')
    .description('Journal et règles des actions de Lisa (opt-in)');
  lisa
    .command('journal')
    .option('--since <date>', 'Depuis une date ISO')
    .option('--json', 'JSONL')
    .action((options: { since?: string; json?: boolean }) => {
      const entries = readLisaJournal(options.since);
      if (!entries.length && !options.json) cli.stdout('Aucune activité Lisa.');
      for (const e of entries)
        cli.stdout(
          options.json
            ? JSON.stringify(e)
            : `${e.quand} | ${e.trigger} | ${e.operation} / ${e.tool ?? e.action} | ${e.regime} | ${e.regle} / ${e.decision} | ${e.resultat} | ${e.id}`
        );
    });
  lisa
    .command('regime <regime>')
    .description('lecture (défaut) ou action')
    .action((regime: string) => {
      if (regime !== 'lecture' && regime !== 'action')
        throw new Error('Régime attendu : lecture ou action');
      updateLisaRules((r) => ({ ...r, regime: regime as LisaRegime }));
      cli.stdout(`Régime Lisa : ${regime}`);
    });
  const rules = lisa.command('regles').description('Autorisé / demander / interdit');
  rules.command('list').action(() => {
    const r = readLisaRules();
    cli.stdout(`Régime : ${r.regime}\nAUTORISÉ | DEMANDER | INTERDIT`);
    const ask = [
      ...r.demander,
      ...LISA_ACTIONS.filter((a) => ![...r.autorise, ...r.demander, ...r.interdit].includes(a)),
    ];
    for (let i = 0; i < Math.max(r.autorise.length, ask.length, r.interdit.length); i++) {
      cli.stdout(`${r.autorise[i] ?? ''} | ${ask[i] ?? ''} | ${r.interdit[i] ?? ''}`);
    }
  });
  for (const [command, column] of [
    ['autoriser', 'autorise'],
    ['demander', 'demander'],
    ['interdire', 'interdit'],
  ] as const) {
    rules
      .command(`${command} <action>`)
      .description(`Actions : ${LISA_ACTIONS.join(', ')}`)
      .action((action: string) => {
        setLisaRule(action as LisaAction, column as LisaColumn);
        cli.stdout(`${action} : ${column}`);
      });
  }
}
