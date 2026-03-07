import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const repoRoot = process.cwd();
const cliCmd = 'node -r dotenv/config ./node_modules/tsx/dist/cli.mjs src/index.ts';
const campaignRoot = path.join(repoRoot, 'apps', 'codebuddy-real-campaign');

function run(command, cwd = repoRoot, allowFail = false) {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const out = `${error.stdout || ''}${error.stderr || ''}`;
    if (allowFail) return out;
    throw new Error(`Command failed: ${command}\n${out}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readGoogleApiKey() {
  const envPath = path.join(repoRoot, '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(/^GOOGLE_API_KEY=(.+)$/m) || raw.match(/^GEMINI_API_KEY=(.+)$/m);
  return match?.[1]?.trim() || '';
}

function extractToolStats(responseText) {
  const stats = { totalCalls: 0, uniqueTools: [] };
  try {
    const firstJsonLine = responseText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    if (!firstJsonLine) return stats;
    const parsed = JSON.parse(firstJsonLine);
    const toolSet = new Set();
    for (const msg of parsed.messages || []) {
      for (const call of msg.tool_calls || []) {
        const name = call?.function?.name;
        if (typeof name === 'string' && name.length > 0) {
          toolSet.add(name);
          stats.totalCalls += 1;
        }
      }
    }
    stats.uniqueTools = [...toolSet].sort();
  } catch {
    // Keep defaults when CLI output is not pure JSON
  }
  return stats;
}

function findAppDir(baseDir) {
  const direct = path.join(baseDir, 'package.json');
  if (fs.existsSync(direct)) return baseDir;

  const children = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(baseDir, d.name));

  for (const child of children) {
    const pkg = path.join(child, 'package.json');
    if (fs.existsSync(pkg)) return child;
  }
  return baseDir;
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function scenarioPrompt(levelName, goal) {
  return [
    `Tu développes une application ${levelName} dans ce dossier vide.`,
    goal,
    'Contraintes:',
    '- Code production minimal mais propre.',
    '- Travaille directement dans le dossier courant (ne crée pas de sous-dossier principal).',
    '- Crée un README clair.',
    '- Crée un smoke-test.mjs qui retourne code 0 si tout fonctionne.',
    '- Lance les commandes nécessaires pour valider le fonctionnement réel.',
    '- Si une commande échoue, corrige et relance.',
    '- Réponds avec un résumé final bref.',
  ].join('\n');
}

const scenarios = [
  {
    id: 'level-1-cli',
    prompt: scenarioPrompt(
      'CLI',
      [
        "Construis une CLI 'task-tracker' en Node.js sans dépendance externe.",
        "Fonctionnalités: add/list/done/remove, stockage JSON local, filtre --status.",
        'Ajoute des tests unitaires natifs (node:test) et une commande npm test.',
      ].join('\n'),
    ),
    validate: (dir) => {
      const appDir = findAppDir(dir);
      run('npm install', appDir);
      run('npm test', appDir);
      run('node smoke-test.mjs', appDir);
      return 'npm test + smoke-test OK';
    },
  },
  {
    id: 'level-2-webapp',
    prompt: scenarioPrompt(
      'web full-stack',
      [
        "Construis une application 'notes-board' avec backend Express + frontend HTML/JS.",
        'Backend: CRUD notes + persistance fichier JSON + validation d input.',
        'Frontend: liste, ajout, suppression, édition simple.',
        'Ajoute test API minimal et smoke-test E2E local.',
      ].join('\n'),
    ),
    validate: (dir) => {
      const appDir = findAppDir(dir);
      run('npm install', appDir);
      run('node smoke-test.mjs', appDir);
      return 'smoke-test E2E OK';
    },
  },
  {
    id: 'level-3-ai-chat',
    prompt: scenarioPrompt(
      'IA avancée',
      [
        "Construis une application 'ai-support-desk' (Express + frontend) connectée à Gemini.",
        'Fonctionnalités: conversation multi-tour, historique court, endpoint /health, endpoint /api/chat.',
        'Ajoute gestion d erreurs API robuste + limite de taille message + fallback message utilisateur.',
        'Ajoute script de test réel qui appelle /api/chat et vérifie une réponse.',
      ].join('\n'),
    ),
    validate: (dir) => {
      const appDir = findAppDir(dir);
      run('npm install', appDir);
      run('node smoke-test.mjs', appDir);
      return 'smoke-test Gemini OK';
    },
  },
];

function main() {
  ensureDir(campaignRoot);
  const apiKey = readGoogleApiKey();
  if (!apiKey) {
    throw new Error('Missing GOOGLE_API_KEY/GEMINI_API_KEY in .env');
  }
  process.env.GOOGLE_API_KEY = apiKey;

  const report = [];
  for (const scenario of scenarios) {
    const dir = path.join(campaignRoot, scenario.id);
    ensureDir(dir);
    const promptPath = path.join(dir, 'prompt.txt');
    writeFile(promptPath, scenario.prompt);

    const cmd = [
      cliCmd,
      `--directory "${dir}"`,
      '--model gemini-2.5-flash',
      '--security-mode full-auto',
      '--auto-approve',
      '--max-tool-rounds 120',
      '--output-format text',
      '--plain',
      `--prompt "${scenario.prompt.replaceAll('"', '\\"')}"`,
    ].join(' ');

    const generationOutput = run(cmd, repoRoot, true);
    const stats = extractToolStats(generationOutput);

    let validation = 'not-run';
    let validationOk = false;
    try {
      validation = scenario.validate(dir);
      validationOk = true;
    } catch (error) {
      validation = error instanceof Error ? error.message : String(error);
    }

    report.push({
      id: scenario.id,
      toolCalls: stats.totalCalls,
      tools: stats.uniqueTools,
      validationOk,
      validation,
    });
  }

  const reportPath = path.join(campaignRoot, 'campaign-report.json');
  writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));

  console.log(`Campaign done. Report: ${reportPath}`);
  for (const row of report) {
    console.log(
      `${row.id}: ${row.validationOk ? 'PASS' : 'FAIL'} | calls=${row.toolCalls} | tools=${row.tools.join(', ') || 'none'}`,
    );
  }
}

main();
