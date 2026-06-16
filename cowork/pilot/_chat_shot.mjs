/** Capture a clean screenshot of the assistant message bubble via clip rect. */
import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';

const OUT = '/home/patrice/code-buddy/docs/qa/code-buddy-studio/audit-2026-06-15';
const pilot = new CoworkPilot({ log: () => {} });
try {
  await pilot.launch();
  await pilot.configureProvider(CHATGPT_PROFILE);
  const { reply } = await pilot.chat(
    'En une phrase courte, explique ce qu est Cowork. Commence ta reponse par le jeton CBDOC.',
    { marker: 'CBDOC', timeoutMs: 120000 }
  );
  console.log('REPLY:', reply);
  await pilot.page.waitForTimeout(1500); // let streaming/render settle

  const rect = await pilot.evaluate(() => {
    const leaf = Array.from(document.querySelectorAll('*')).find(
      (e) => /^CBDOC/.test((e.textContent || '').trim()) && e.children.length === 0
    );
    if (!leaf) return null;
    let n = leaf;
    while (n && n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.width >= 360 && r.height >= 34 && r.width <= 950) break;
      n = n.parentElement;
    }
    const r = n.getBoundingClientRect();
    const pad = 16;
    return {
      x: Math.max(0, Math.floor(r.left - pad)),
      y: Math.max(0, Math.floor(r.top - pad)),
      width: Math.ceil(r.width + pad * 2),
      height: Math.ceil(r.height + pad * 2),
    };
  });
  console.log('rect:', JSON.stringify(rect));
  if (rect && rect.width > 0 && rect.height > 0) {
    await pilot.page.screenshot({ path: `${OUT}/02b-chat-bubble.png`, clip: rect });
    console.log('BUBBLE SHOT SAVED');
  }
} catch (e) {
  console.error('FAIL', e?.stack || e);
  process.exitCode = 1;
} finally {
  await pilot.close();
}
