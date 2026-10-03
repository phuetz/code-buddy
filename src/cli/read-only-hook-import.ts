/** Detect the report command before the full CLI (and its logger) is initialized. */
export function isReadOnlyHookImport(argv: readonly string[] = process.argv): boolean {
  const args = argv.slice(2);
  const index = args.indexOf('hooks');
  return index >= 0 && args[index + 1] === 'import'
    && !args.some((arg) => arg === '--apply' || arg.startsWith('--apply=') || arg === '-a');
}
