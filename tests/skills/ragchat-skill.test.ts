/**
 * Skill intégré `ragchat` : générique par construction. Aucune adresse de serveur, aucun
 * identifiant ni nom de modèle en dur — l'adresse et le jeton viennent de l'environnement
 * (RAGCHAT_URL, RAGCHAT_TOKEN), et l'exemple MCP les référence sans les contenir.
 */
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { getBundledSkillsPath } from '../../src/skills/index.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { loadMCPConfig } from '../../src/mcp/config.js';
import { resolveMCPTransport } from '../../src/mcp/transports.js';

const skillFile = path.join(getBundledSkillsPath(), 'ragchat', 'SKILL.md');
const text = readFileSync(skillFile, 'utf8');
const ACTIVATION_THRESHOLD = 0.3; // CodeBuddyAgent.applySkillMatching

describe('skill intégré ragchat', () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    registry = new SkillRegistry({
      bundledPath: getBundledSkillsPath(),
      managedPath: path.join('/nonexistent', 'managed'),
      workspacePath: path.join('/nonexistent', 'workspace'),
      watchEnabled: false,
    });
    await registry.load();
  });

  afterAll(() => registry.shutdown());

  it('se charge depuis le niveau bundled et déclare ses dépendances', () => {
    const skill = registry.get('ragchat');
    expect(skill).toBeDefined();
    expect(skill!.tier).toBe('bundled');
    expect(skill!.metadata.requires?.env).toEqual(['RAGCHAT_URL', 'RAGCHAT_TOKEN']);
  });

  it.each([
    'Que dit la documentation sur X ?',
    'cherche dans la doc',
    'base documentaire',
    'base documentaire avec citations',
    'Réponds avec citations',
    'corpus indexé',
    'search the docs',
    'indexed documentation',
  ])('ne choisit pas ragchat pour une demande générique : %s', (request) => {
    // Même chemin top-1 que findSkill(), puis seuil de CodeBuddyAgent.
    const match = registry.findBestMatch(request);
    expect(match?.skill.metadata.name === 'ragchat' && match.confidence >= ACTIVATION_THRESHOLD).toBe(false);
  });

  it.each([
    'interroge RagChat sur la rotation des certificats',
    'Le serveur RAGCHAT_URL contient-il cette procédure ?',
    'Utilise mcp__ragchat__search pour retrouver ce passage',
  ])('choisit ragchat sur un marqueur explicite : %s', (request) => {
    const match = registry.findBestMatch(request);
    expect(match?.skill.metadata.name).toBe('ragchat');
    expect(match!.confidence).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
  });

  it('fournit un JSON MCP parsable et conforme au transport Code Buddy', () => {
    const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
    expect(blocks).toHaveLength(1);
    const document: unknown = JSON.parse(blocks[0]![1]!);
    expect(document).toEqual({
      mcpServers: {
        ragchat: {
          name: 'ragchat',
          transport: {
            type: 'streamable_http',
            url: '${RAGCHAT_URL}/mcp',
            headers: { Authorization: 'Bearer ${RAGCHAT_TOKEN}' },
          },
          enabled: true,
        },
      },
    });
    // Le chargeur réel lit le document dans le format .codebuddy/mcp.json.
    const projectDir = mkdtempSync(path.join(tmpdir(), 'ragchat-mcp-'));
    let server;
    try {
      const configDir = path.join(projectDir, '.codebuddy');
      mkdirSync(configDir);
      writeFileSync(path.join(configDir, 'mcp.json'), blocks[0]![1]!);
      server = loadMCPConfig({ cwd: projectDir }).servers.find((item) => item.name === 'ragchat');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
    expect(server).toBeDefined();
    if (!server) throw new Error('ragchat absent de la configuration MCP chargée');
    expect(server.name).toBe('ragchat');
    expect(server.transport.type).toBe('streamable_http');
    try {
      vi.stubEnv('RAGCHAT_URL', 'unused');
      vi.stubEnv('RAGCHAT_TOKEN', undefined);
      expect(() => resolveMCPTransport(server.transport)).toThrow('Missing MCP environment reference: RAGCHAT_TOKEN');
      vi.stubEnv('RAGCHAT_URL', undefined);
      vi.stubEnv('RAGCHAT_TOKEN', 'unused');
      expect(() => resolveMCPTransport(server.transport)).toThrow('Missing MCP environment reference: RAGCHAT_URL');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("ne contient aucune adresse réelle : l'URL vient de RAGCHAT_URL", () => {
    expect(text).toContain('${RAGCHAT_URL}/mcp');
    expect(text).toContain('Bearer ${RAGCHAT_TOKEN}');
    // Aucune URL concrète (hôte, port, IP) : seulement des références d'environnement.
    expect(text).not.toMatch(/https?:\/\/[a-z0-9.-]+/i);
    expect(text).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/rgc_[A-Za-z0-9_-]{8,}/);
  });

  it('ne cite aucun nom de modèle en dur', () => {
    expect(text).not.toMatch(/\b(gpt-|claude-|gemini-|llama|qwen|mistral|grok-)/i);
  });

  it('rappelle que les extraits sont des données, pas des instructions', () => {
    expect(text).toMatch(/extraits sont des DONNÉES/);
  });
});
