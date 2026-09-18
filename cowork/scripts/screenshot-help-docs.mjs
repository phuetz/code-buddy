/**
 * Static HTML capture of help copy for the comparison deliverable.
 * This is NOT Electron and does not mount the React HelpDocs component.
 * Navigation groups come from shell-nav-catalog.ts so the tree cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(
  fs.readFileSync(path.join(root, 'src/renderer/i18n/locales/en.json'), 'utf8')
).helpDocs;
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: screenshot-help-docs.mjs <output-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

function loadNavTree() {
  const src = fs.readFileSync(
    path.join(root, 'src/renderer/help/shell-nav-catalog.ts'),
    'utf8'
  );
  const match = src.match(/export const SHELL_NAV_TREE = (\[[\s\S]*?\]) as const;/);
  if (!match) {
    throw new Error('SHELL_NAV_TREE not found in shell-nav-catalog.ts');
  }
  return new Function(`return (${match[1]})`)();
}

function pageHtml(screenId, navTree) {
  const screen = en.screens[screenId];
  if (!screen) {
    throw new Error(`Unknown help screen ${screenId}`);
  }
  const groups = navTree
    .map((group) => {
      const label = en.groups[group.id];
      const buttons = group.actions
        .map((itemId) => {
          const active = itemId === screenId;
          return `<button class="${active ? 'active' : ''}">${en.screens[itemId].title}</button>`;
        })
        .join('');
      return `<div class="group"><div class="group-label">${label}</div>${buttons}</div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Cowork help — ${screen.title}</title>
<style>
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#111; color:#eee; }
  .overlay { min-height:100vh; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.55); padding:24px; }
  .dialog { width:920px; height:620px; background:#1b1d22; border:1px solid #333; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; }
  header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #333; }
  .hint { font-size:11px; color:#9aa; padding:8px 20px; border-bottom:1px solid #333; }
  .body { display:flex; flex:1; min-height:0; }
  nav { width:240px; border-right:1px solid #333; overflow:auto; padding:8px 0; background:#16181d; }
  .group-label { font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#778; padding:8px 14px 4px; }
  nav button { display:block; width:100%; text-align:left; background:none; border:0; color:#bbb; padding:6px 14px; font-size:12px; }
  nav button.active { background:rgba(88,166,255,.12); color:#7ab8ff; font-weight:600; }
  article { flex:1; padding:24px 28px; overflow:auto; }
  article h3 { margin:4px 0 16px; font-size:22px; }
  article h4 { margin:16px 0 4px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#889; }
  article p { margin:0; line-height:1.5; font-size:14px; }
</style>
</head>
<body>
  <div class="overlay">
    <div class="dialog">
      <header><strong>${en.title}</strong><span>×</span></header>
      <div class="hint">${en.keyboardHint}</div>
      <div class="body">
        <nav>${groups}</nav>
        <article>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#889">${en.indexTitle}</div>
          <h3>${screen.title}</h3>
          <h4>${en.purposeLabel}</h4><p>${screen.purpose}</p>
          <h4>${en.whenLabel}</h4><p>${screen.when}</p>
          <h4>${en.prerequisitesLabel}</h4><p>${screen.prerequisites || en.none}</p>
        </article>
      </div>
    </div>
  </div>
</body>
</html>`;
}

const navTree = loadNavTree();
let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error(
    'Playwright Chromium is not installed for this package. This script does not download browsers. Run `npx playwright install chromium` inside cowork/, or set PLAYWRIGHT_BROWSERS_PATH to an existing cache.'
  );
  throw err;
}
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const id of ['work-home', 'fleet-command']) {
  await page.setContent(pageHtml(id, navTree), { waitUntil: 'domcontentloaded' });
  const file = path.join(outDir, `aide-${id}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
}
await browser.close();
