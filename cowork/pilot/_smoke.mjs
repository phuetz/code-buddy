import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';

const pilot = new CoworkPilot({ log: (l) => console.log(l) });
try {
  await pilot.launch();
  console.log('[smoke] launched + ready');
  const saved = await pilot.configureProvider(CHATGPT_PROFILE);
  console.log('[smoke] configureProvider:', JSON.stringify(saved));
  const r = await pilot.chat(
    'Calcule 17 multiplie par 23. Reponds par UNE seule ligne commencant exactement par CBPILOT suivi du resultat.',
    { marker: /CBPILOT/, timeoutMs: 120000 }
  );
  console.log('[smoke] chat reply:', JSON.stringify(r));
  const shot = await pilot.screenshot('/tmp/cowork-pilot-smoke.png', { fullPage: true });
  console.log('[smoke] screenshot bytes:', shot.bytes);
  const state = await pilot.getState();
  console.log('[smoke] state:', JSON.stringify(state).slice(0, 400));
  console.log('[smoke] PASS');
} catch (e) {
  console.error('[smoke] FAIL', e?.stack || e);
  process.exitCode = 1;
} finally {
  await pilot.close();
}
