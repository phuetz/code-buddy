/** Investigate TopMenuBar: Fichier -> Paramètres dropdown interaction. */
import { CoworkPilot } from './pilot-core.mjs';
const p = new CoworkPilot({ log: () => {} });
const dom = () =>
  p.evaluate(() => ({
    fichierBtns: Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').trim() === 'Fichier').length,
    parametres: Array.from(document.querySelectorAll('*'))
      .filter((e) => (e.textContent || '').trim() === 'Paramètres' && e.children.length === 0)
      .map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), vis: r.width > 0 && r.height > 0 }; }),
    showSettings: window.useAppStore?.getState?.().showSettings,
    settingsPanel: !!document.querySelector('[data-testid="settings-panel"]'),
  }));
try {
  await p.launch();
  console.log('LAUNCH:', JSON.stringify(await dom()));
  await p.click('text=Fichier');
  await p.page.waitForTimeout(500);
  console.log('AFTER_FICHIER:', JSON.stringify(await dom()));
  let clickErr = null;
  try { await p.click('text=Paramètres'); } catch (e) { clickErr = e.message.split('\n')[0]; }
  console.log('CLICK_PARAMETRES_ERR:', clickErr);
  await p.page.waitForTimeout(800);
  console.log('AFTER_PARAMETRES:', JSON.stringify(await dom()));
} catch (e) {
  console.error('FAIL', e?.message || e);
} finally {
  await p.close();
}
