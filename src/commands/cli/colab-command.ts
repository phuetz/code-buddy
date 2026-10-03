import { Command, Option } from 'commander';
import { ColabRunner, ColabInterruptedError } from '../../compute/colab-runner.js';
import { scrubSecrets } from '../../security/secret-scrubber.js';

async function runWithJobSignals<T>(action: () => Promise<T>): Promise<T> {
  // src/index.ts installs global shutdown handlers which may process.exit before
  // allocation/VM cleanup settles. The dedicated run command owns these signals
  // until runner finally completes, then restores the bootstrap's exact handlers.
  const saved = (['SIGINT', 'SIGTERM'] as const).map(signal => ({
    signal, listeners: process.rawListeners(signal) as Array<(...args: unknown[]) => void>,
  }));
  for (const { signal, listeners } of saved) for (const listener of listeners) process.off(signal, listener);
  try { return await action(); }
  finally {
    for (const { signal, listeners } of saved) for (const listener of listeners) {
      if (!process.rawListeners(signal).includes(listener)) process.on(signal, listener);
    }
  }
}

export function registerColabCommands(program: Command, runner = new ColabRunner()): void {
  const colab = program.command('colab').description('Ephemeral Colab GPU jobs (opt-in; spends compute units)');
  const report = async (action: () => Promise<unknown>) => {
    try { console.log(JSON.stringify(await action(), null, 2)); }
    catch (error) {
      console.error(scrubSecrets(String(error)));
      if (error instanceof ColabInterruptedError) process.exitCode = error.signal === 'SIGINT' ? 130 : 143;
      else if (!process.exitCode) process.exitCode = 1;
    }
  };
  colab.command('run <script.py>').description('Upload explicit project files, execute, download outputs, then destroy the VM')
    .addOption(new Option('--gpu <type>', 'GPU type; H100 falls back to A100').choices(['L4', 'A100', 'H100']).default('L4'))
    .option('--in <files...>', 'Explicit project input files')
    .option('--out <directory>', 'New project output directory')
    .option('--dependency <packages...>', 'PyPI package names or name==version')
    .option('--timeout <seconds>', 'Work deadline (1–3600 seconds); allocation may settle for 120s, cleanup is separate', Number, 600)
    .action(async (script: string, opts) => report(() => runWithJobSignals(() => runner.run({ script, gpu: opts.gpu, inputs: opts.in,
      outputDir: opts.out, dependencies: opts.dependency, timeoutSeconds: opts.timeout }))));
  colab.command('status').description('Today’s charged/measured units, reservations and backend sessions')
    .action(async () => report(() => runner.status()));
  colab.command('stop <session>').description('Close an explicitly named cb- session; verify its removal')
    .action(async (session: string) => report(async () => { await runner.stop(session); return { closed: session }; }));
}
