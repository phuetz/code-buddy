/**
 * REAL goal-loop run ($0 ChatGPT subscription) proving the full emission chain:
 *   engine adapter emitGoalSnapshot → runner goal_status → useIPC → store → GoalBanner.
 *
 * Launches Cowork on the rebuilt embedded core, configures ChatGPT (gpt-5.5),
 * establishes a session, sets a 1-turn goal, triggers a turn, and watches the
 * goal banner appear with structured progress.
 */
import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';

const OUT = '/home/patrice/code-buddy/docs/qa/code-buddy-studio';
const GOAL = 'Reply with exactly the single word DONE and nothing else, then stop.';
const pilot = new CoworkPilot({ log: (m) => console.log(m) });

async function readGoalState(sid) {
  return pilot.evaluate((s) => {
    const st = window.useAppStore?.getState?.();
    return {
      goal: st?.goalStatesBySession?.[s] ?? null,
      bannerInDom: !!document.querySelector('[data-testid="goal-banner"]'),
      runner: document.querySelector('[data-testid="runner-badge"]') ? 'present' : 'absent',
    };
  }, sid);
}

try {
  await pilot.launch();
  await pilot.dismissOnboarding();
  await pilot.configureProvider(CHATGPT_PROFILE);

  // 1) Establish a real session with the configured model.
  console.log('[goal-run] establishing session via a first chat…');
  await pilot.chat('Say hi in one short sentence.', { timeoutMs: 120000 }).catch((e) => {
    console.log('[goal-run] first chat settle note:', e?.message || e);
  });

  const sessionId = await pilot.evaluate(() => window.useAppStore?.getState?.()?.activeSessionId);
  console.log('[goal-run] activeSessionId =', sessionId);
  if (!sessionId) throw new Error('no active session established');

  // 2) Set a 1-turn goal via the SAME bridge the GUI uses.
  const setRes = await pilot.ipcNamespaced('command', 'execute', ['goal', [GOAL], sessionId]);
  console.log('[goal-run] /goal set result:', JSON.stringify(setRes)?.slice(0, 300));

  // 3) Trigger a turn (fire-and-forget) so the engine adapter runs the goal loop.
  const input = (await pilot.page.getByTestId('welcome-prompt-input').count())
    ? pilot.page.getByTestId('welcome-prompt-input')
    : pilot.page.getByTestId('chat-prompt-input');
  await input.fill('Proceed with the goal.');
  await input.press('Enter');

  // 4) Poll for the banner (initial emitGoalSnapshot fires at turn start).
  const deadline = Date.now() + 120000;
  let seen = null;
  let bannerSeen = false;
  while (Date.now() < deadline) {
    const s = await readGoalState(sessionId);
    if (s.goal) seen = s.goal;
    if (s.bannerInDom) bannerSeen = true;
    if (s.goal) {
      console.log('[goal-run] goal.status in store:', JSON.stringify(s.goal), 'bannerInDom=', s.bannerInDom);
    }
    if (bannerSeen && seen) break;
    await pilot.page.waitForTimeout(1000);
  }

  if (bannerSeen) {
    await pilot.screenshot(`${OUT}/goal-banner-real-run.png`);
    console.log('[goal-run] RESULT: PASS — banner rendered from a real goal turn. snapshot:', JSON.stringify(seen));
  } else {
    console.log('[goal-run] RESULT: banner NOT observed. last store snapshot:', JSON.stringify(seen));
    process.exitCode = 2;
  }
} catch (e) {
  console.error('[goal-run] FAIL', e?.stack || e);
  process.exitCode = 1;
} finally {
  await pilot.close();
}
