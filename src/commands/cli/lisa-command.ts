import type { Command } from 'commander';

export function registerLisaCommand(program: Command, write: (message: string) => void): void {
  const lisa = program.command('lisa').description('Lisa action history and return points');

  lisa.command('annuler <action>')
    .description('Restore one completed Lisa action by action or checkpoint ID')
    .action(async (action: string) => {
      if (process.env.CODEBUDDY_LISA_UNIFIED_CHECKPOINTS !== 'true') {
        write('Lisa return points are disabled.');
        process.exitCode = 1;
        return;
      }
      try {
        const { LisaActionStore } = await import('../../checkpoints/lisa-action-store.js');
        const store = new LisaActionStore();
        const candidate = store.list().findLast(item => item.id === action || item.actionId === action);
        if (!candidate || candidate.state === 'restored') throw new Error('Action checkpoint not found');
        const checkpoint = candidate.state === 'prepared' ? store.complete(candidate.id) : candidate;
        const result = store.restore(checkpoint.id);
        write(`Action ${checkpoint.actionId} restored (${result.restored.length} files). Return point: ${result.safetyCheckpointId}`);
      } catch (error) {
        write(`Restore refused: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  lisa.command('journal')
    .description('Show Lisa’s local action journal and today’s summary')
    .action(async () => {
      if (process.env.CODEBUDDY_LISA_JOURNAL !== 'true') {
        write('Lisa journal is disabled.');
        process.exitCode = 1;
        return;
      }
      try {
        const { readLisaJournal, summarizeLisaDay } = await import('../../companion/lisa-journal.js');
        const entries = readLisaJournal().slice(-20);
        write(summarizeLisaDay());
        for (const entry of entries) {
          write(`${entry.at} ${entry.kind} ${entry.what}: ${entry.why}${entry.result ? ` — ${entry.result}` : ''}${entry.checkpointId ? ` [retour ${entry.checkpointId}]` : ''}`);
        }
      } catch (error) {
        write(`Journal unavailable: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  lisa.command('suivi-rejeter <id>')
    .description('Reject a proposed conversational follow-up')
    .action(async (id: string) => {
      if (process.env.CODEBUDDY_LISA_PULSE !== 'true') {
        write('Lisa follow-ups are disabled.');
        process.exitCode = 1;
        return;
      }
      const { rejectEventFollowUp } = await import('../../companion/event-followups.js');
      const rejected = rejectEventFollowUp(id);
      write(rejected ? `Follow-up ${id} rejected.` : `Follow-up ${id} not found or already retired.`);
      if (!rejected) process.exitCode = 1;
    });
}
