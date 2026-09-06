import { describe, it, expect } from 'vitest';
import { matchAllDangerousPatterns, matchDangerousPattern } from '../../src/security/dangerous-patterns.js';
import { inspectAuthoredCode } from '../../src/agent/self-improvement/authored-artifact-gate.js';

/**
 * CHASSE-SECU-GROK (2026-09-05) — point 2.
 * Motif `sensitive-credential-path` : quels chemins allégués manquants
 * passent aujourd'hui, lesquels sont déjà couverts, et les faux positifs
 * (`cat README.md`, `ls ~/.config`) restent non bloqués.
 */
function credentialHits(code: string): string[] {
  return matchAllDangerousPatterns(code, 'code')
    .filter((p) => p.name === 'sensitive-credential-path')
    .map((p) => p.name);
}

function readSnippet(p: string): string {
  return `const fs=require('fs'); console.log(fs.readFileSync(${JSON.stringify(p)},'utf8'));`;
}

describe('CHASSE-SECU point 2 — sensitive-credential-path', () => {
  describe('chemins allégués manquants (doivent matcher)', () => {
    it.each([
      ['gh hosts.yml', '/home/x/.config/gh/hosts.yml'],
      ['gcloud ADC', '/home/x/.config/gcloud/application_default_credentials.json'],
      ['Azure CLI', '/home/x/.azure/accessTokens.json'],
      ['Terraform rc', '/home/x/.terraformrc'],
      ['Terraform tfrc', '/home/x/.terraform.d/credentials.tfrc.json'],
      ['npmrc', '/home/x/.npmrc'],
      ['cargo credentials', '/home/x/.cargo/credentials'],
      ['cargo credentials.toml', '/home/x/.cargo/credentials.toml'],
      ['docker config.json', '/home/x/.docker/config.json'],
      ['kube config', '/home/x/.kube/config'],
      ['netrc', '/home/x/.netrc'],
      ['pypirc', '/home/x/.pypirc'],
      ['git-credentials', '/home/x/.git-credentials'],
      ['.env.local', '/srv/app/.env.local'],
      ['.env.production', '/srv/app/.env.production'],
    ] as const)('%s', (_label, filePath) => {
      expect(credentialHits(readSnippet(filePath)).length, filePath).toBeGreaterThan(0);
    });
  });

  it('bloque via inspectAuthoredCode un outil qui lit ~/.config/gh/hosts.yml', () => {
    const r = inspectAuthoredCode(readSnippet('/home/victim/.config/gh/hosts.yml'), 'code');
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/credential|secret path/i);
  });

  it('bloque via inspectAuthoredCode un outil qui lit ~/.npmrc', () => {
    const r = inspectAuthoredCode(readSnippet('/home/victim/.npmrc'), 'code');
    expect(r.ok).toBe(false);
  });

  describe('ne bloque PAS les lectures ordinaires', () => {
    it('cat README.md (bash)', () => {
      expect(matchDangerousPattern('cat README.md', 'bash')).toBeNull();
    });

    it('ls ~/.config (bash)', () => {
      expect(matchDangerousPattern('ls ~/.config', 'bash')).toBeNull();
    });

    it('lecture de README.md (code)', () => {
      expect(credentialHits(readSnippet('README.md'))).toEqual([]);
    });

    it('listage de ~/.config sans fichier d\'identifiants (code)', () => {
      const code = 'const fs=require("fs"); console.log(fs.readdirSync(home+"/.config").length);';
      expect(credentialHits(code)).toEqual([]);
      expect(inspectAuthoredCode(code, 'code').ok).toBe(true);
    });

    it('ne confond pas foo.azure.com avec ~/.azure', () => {
      const code = 'const u="https://foo.azure.com/status"; console.log(u);';
      expect(credentialHits(code)).toEqual([]);
    });
  });
});
