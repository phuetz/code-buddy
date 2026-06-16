/** Dogfood: drive a Test Runner bundle via the pilot and report its result. */
import { CoworkPilot } from './pilot-core.mjs';

const bundleId = process.argv[2] || 'code-buddy-cowork-functional-coverage-bundle';
const pilot = new CoworkPilot({ log: (l) => console.error(l) });
try {
  await pilot.launch();
  console.log('[demo] running bundle:', bundleId);
  const res = await pilot.runTestBundle(bundleId, { timeoutMs: 560_000 });
  console.log('[demo] RESULT:', JSON.stringify(res));
} catch (e) {
  console.error('[demo] FAIL', e?.stack || e);
  process.exitCode = 1;
} finally {
  await pilot.close();
}
