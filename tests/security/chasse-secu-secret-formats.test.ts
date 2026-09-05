import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { scanFileForSecrets } from '../../src/security/secrets-detector.js';
import { SECRET_PATTERNS } from '../../src/security/secret-patterns.js';

/**
 * CHASSE-SECU-GROK (2026-09-05) — point 3.
 * Formats de jetons allégués manquants. Jetons FACTICES de forme valide
 * uniquement. Un motif qui matche le TypeScript sous src/ hors commentaires est refusé.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORK_ROOT = path.join(REPO_ROOT, '_qa', 'grok-secu', 'work', 'secrets');

const HF = `hf_${'A'.repeat(34)}`;
const DOP = `dop_v1_${'a'.repeat(64)}`;
const GLPAT = 'glpat-ABCDEFGHIJKLMNOPQRST';
const XOXB = `xoxb-${'1'.repeat(12)}-${'A'.repeat(24)}`; // assemblé à l'exécution : jamais un jeton littéral dans le dépôt
const SK_LIVE = `sk_live_${'A'.repeat(24)}`;
const SENDGRID = `SG.${'A'.repeat(22)}.${'B'.repeat(43)}`;
const NPM = `npm_${'A'.repeat(36)}`;
const PYPI = `pypi-AgEIcHlwaS5vcmcCJDA${'A'.repeat(40)}`;
const TWILIO_SK = `SK${'a'.repeat(32)}`;
const TWILIO_AC = `AC${'a'.repeat(32)}`;
const VERCEL = `vcp_${'A'.repeat(24)}`;
const SUPABASE = `sb_secret_${'A'.repeat(24)}`;
const AZURE_ACCOUNT = `DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${'A'.repeat(88)}`;
const CF_TOKEN = 'A'.repeat(40);
const MONGO_SRV = 'mongodb+srv://user:pass@cluster.abc.mongodb.net/db';

describe('CHASSE-SECU point 3 — formats de secrets allégués', () => {
  let dir: string;
  beforeEach(() => {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    dir = fs.mkdtempSync(path.join(WORK_ROOT, 'case-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function scanLine(body: string) {
    const p = path.join(dir, 'config.ts');
    fs.writeFileSync(p, `${body}\n`);
    return scanFileForSecrets(p);
  }

  it.each([
    ['Hugging Face hf_', `const token = "${HF}";`, 'huggingface_token'],
    ['DigitalOcean dop_v1_', `const token = "${DOP}";`, 'digitalocean_token'],
    ['GitLab glpat-', `const token = "${GLPAT}";`, 'gitlab_token'],
    ['Slack xoxb-', `const token = "${XOXB}";`, 'slack_token'],
    ['Stripe sk_live_', `const token = "${SK_LIVE}";`, 'stripe_key'],
    ['SendGrid SG.', `const token = "${SENDGRID}";`, 'sendgrid_key'],
    ['npm npm_', `const token = "${NPM}";`, 'npm_token'],
    ['PyPI pypi-', `const token = "${PYPI}";`, 'pypi_token'],
    ['Twilio SK', `const token = "${TWILIO_SK}";`, 'twilio_key'],
    ['Twilio AC', `const token = "${TWILIO_AC}";`, 'twilio_key'],
    ['Vercel vcp_', `const token = "${VERCEL}";`, 'vercel_token'],
    ['Supabase sb_secret_', `const token = "${SUPABASE}";`, 'supabase_key'],
    ['Azure AccountKey', `const conn = "${AZURE_ACCOUNT}";`, 'azure_key'],
    ['Cloudflare CF_API_TOKEN', `const CF_API_TOKEN = "${CF_TOKEN}";`, 'cloudflare_token'],
    ['MongoDB SRV', `const url = "${MONGO_SRV}";`, 'connection_string'],
  ] as const)('%s est détecté', (_label, line, type) => {
    const findings = scanLine(line);
    expect(findings.length, JSON.stringify(findings)).toBeGreaterThan(0);
    expect(findings.some((f) => f.type === type), findings.map((f) => f.type).join(',')).toBe(true);
  });

  it('ne signale PAS un identifiant npm_court ni un mot hf_court', () => {
    const findings = scanLine('const npm_package_name = "code-buddy"; const hf_home = "x";');
    expect(findings.filter((f) => f.type === 'npm_token' || f.type === 'huggingface_token')).toEqual([]);
  });

  it('faux positifs : les motifs à préfixe distinctif ne matchent pas src/**/*.ts', () => {
    const prefixTypes = new Set([
      'huggingface_token',
      'digitalocean_token',
      'sendgrid_key',
      'npm_token',
      'pypi_token',
      'twilio_key',
      'vercel_token',
      'supabase_key',
      'azure_key',
      'cloudflare_token',
    ]);
    const patterns = SECRET_PATTERNS.filter((p) => prefixTypes.has(p.type));
    const hits: string[] = [];
    const skip = new Set(['node_modules', 'dist', '.git']);

    function walk(dirPath: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skip.has(entry.name)) continue;
          walk(path.join(dirPath, entry.name));
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const full = path.join(dirPath, entry.name);
        const rel = path.relative(REPO_ROOT, full);
        if (rel === path.join('src', 'security', 'secret-patterns.ts')) continue;
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line === undefined) continue;
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          for (const pat of patterns) {
            pat.pattern.lastIndex = 0;
            if (pat.pattern.test(line)) {
              hits.push(`${rel}:${i + 1}:${pat.type}:${trimmed.slice(0, 80)}`);
            }
          }
        }
      }
    }

    walk(path.join(REPO_ROOT, 'src'));
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
