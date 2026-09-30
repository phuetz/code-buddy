import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qa = path.resolve(process.argv[2] ?? path.join(checkout, '_qa/preuves-p9'));
const root = path.join(qa, 'reprise-1/project');
const raw = path.join(qa, 'reprise-1/raw');
process.chdir(root);
const load = file => import(pathToFileURL(path.join(checkout, 'dist', file)).href);
const { createInteractiveToolAdapters } = await load('tools/registry/interactive-adapters.js');
const { AppServerTool } = await load('tools/app-server-tool.js');
const tools = new Map(createInteractiveToolAdapters().map(t => [t.name, t]));
const server = new AppServerTool();
const url = 'http://127.0.0.1:18870';
const marker = `P9_CONSOLE_${Date.now()}`;
const html = `<!doctype html><html><head><title>P9_BROWSER</title></head><body><label>Name <input aria-label="Name" id="name"></label><button onclick="document.querySelector('#result').textContent='P9_CLICK:'+document.querySelector('#name').value;console.log('${marker}')">Save</button><button onclick="alert('P9_DIALOG')">Dialog</button><div id="result">P9_READY</div><img alt="P9_IMAGE" src="/image.svg"><p style="margin-top:1800px">P9_END</p></body></html>`;
writeFileSync('browser-page-r1.html', html);
writeFileSync('browser-server-r1.mjs', `import http from 'node:http';import {readFileSync} from 'node:fs';http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/image.svg'?'image/svg+xml':'text/html');res.end(req.url==='/image.svg'?'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="blue"/></svg>':readFileSync('browser-page-r1.html'))}).listen(18870,'127.0.0.1');`);
const records = [];
const call = (name, input) => tools.get(name).execute(input);
const evaluate = async expression => (await call('browser', { action: 'evaluate', expression })).data?.result;
const png = file => {
  if (!file || !existsSync(file)) return false;
  const b = readFileSync(file);
  return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.readUInt32BE(16) === 1280 && b.readUInt32BE(20) === 720;
};
async function record(name, input, verify) {
  const result = await call(name, input);
  const observations = await verify(result);
  const row = { name, input, result, observations, passed: result.success === true && Object.values(observations).every(v => v === true), expected: 'Tous les contrôles de contenu ou de changement d’état sont nécessaires.' };
  records.push(row);
  writeFileSync(path.join(raw, 'browser-strict.json'), JSON.stringify(records, null, 2));
  process.stdout.write(`${name} ${row.passed ? 'PASS' : 'FAIL'}\n`);
  return result;
}
let pid;
try {
  const result = await server.start({ command: 'node browser-server-r1.mjs', url, cwd: root, timeoutMs: 5000 });
  pid = result.data?.pid;
  const body = await (await fetch(url)).text();
  records.push({ name: 'app_server', input: { command: 'node browser-server-r1.mjs', url }, result, passed: result.success && body === html, observations: { exactHttpBody: body === html } });
  await record('port_check', { port: 18870, host: '127.0.0.1' }, r => ({ listening: r.data?.listening === true, occupied: r.data?.available === false }));
  await record('http_probe', { url }, r => ({ status200: r.data?.status === 200, actualBodySize: r.data?.size === Buffer.byteLength(html) }));
  await record('web_test', { url, steps: [{ action: 'type', selector: '#name', value: 'P9_WEBTEST' }, { action: 'click', selector: 'button' }], assertions: [{ type: 'text', value: 'P9_CLICK:P9_WEBTEST' }], screenshot: true }, async r => ({ allChecks: r.data?.checks?.length >= 7 && r.data.checks.every(c => c.passed), textFound: r.data?.checks?.some(c => c.name === 'assert text "P9_CLICK:P9_WEBTEST"' && c.detail === 'found'), screenshot1280x720: png(r.data?.screenshotPath), actualDom: await evaluate('document.querySelector("#result").textContent') === 'P9_CLICK:P9_WEBTEST' }));
  await record('browser_vision', { url, include_snapshot: true }, r => ({ screenshot1280x720: png(r.data?.screenshotPath), pageSnapshot: r.data?.snapshot?.includes('Name') && r.data.snapshot.includes('Save') && r.data.snapshot.includes('Dialog'), metadataFromCapture: r.data?.analysis?.source === 'browser_screenshot' }));
  await record('browser_navigate', { url }, async () => ({ actualUrl: await evaluate('location.href') === `${url}/`, actualTitle: await evaluate('document.title') === 'P9_BROWSER' }));
  const snap = await record('browser_snapshot', {}, r => ({ actualElements: r.data?.elementCount === 3 && r.output.includes('textbox') && r.output.includes('Name') && r.output.includes('Save') && r.output.includes('Dialog') }));
  const refs = Object.fromEntries(['Name', 'Save', 'Dialog'].map(name => [name, Number(snap.output.match(new RegExp(`\\[(\\d+)\\] ${name}`))?.[1])]));
  if (Object.values(refs).some(v => !v)) throw new Error('Missing real element references');
  await record('browser_type', { ref: refs.Name, text: 'P9_VALUE', clear: true }, async () => ({ actualInput: await evaluate('document.querySelector("#name").value') === 'P9_VALUE' }));
  await record('browser_click', { ref: refs.Save }, async () => ({ actualClick: await evaluate('document.querySelector("#result").textContent') === 'P9_CLICK:P9_VALUE' }));
  await record('browser_console', {}, r => ({ freshConsoleEntry: r.data?.entries?.some(e => e.type === 'log' && e.text === marker) }));
  await record('browser_get_images', {}, r => ({ decodedImage: r.data?.images?.some(i => i.alt === 'P9_IMAGE' && i.src === `${url}/image.svg` && i.naturalWidth === 30 && i.naturalHeight === 30) }));
  await record('browser_press', { key: 'Tab' }, async () => ({ actualFocus: await evaluate('document.activeElement.textContent') === 'Dialog' }));
  await record('browser_scroll', { direction: 'down', amount: 800 }, async () => ({ actualScroll: await evaluate('window.scrollY') === 800 }));
  await call('browser_click', { ref: refs.Dialog });
  await record('browser_dialog', { action: 'dismiss' }, async r => ({ actualDialog: r.data?.dialog?.message === 'P9_DIALOG', dismissed: (await call('browser_dialog', { action: 'list' })).data?.dialogs?.length === 0 }));
  await call('browser_navigate', { url: `${url}/next` });
  if (await evaluate('location.href') !== `${url}/next`) throw new Error('Back precondition failed');
  await record('browser_back', {}, async () => ({ actualPreviousUrl: await evaluate('location.href') === `${url}/` }));
} finally {
  await call('browser', { action: 'close' });
  if (pid) await server.stop(pid);
}
process.exit(0);
