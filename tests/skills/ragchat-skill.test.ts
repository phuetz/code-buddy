/**
 * Skill intégré `ragchat` : générique par construction. Aucune adresse de serveur, aucun
 * identifiant ni nom de modèle en dur — l'adresse et le jeton viennent de l'environnement
 * (RAGCHAT_URL, RAGCHAT_TOKEN), et l'exemple MCP les référence sans les contenir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { getBundledSkillsPath } from '../../src/skills/index.js';
import { SkillRegistry } from '../../src/skills/registry.js';

const skillFile = path.join(getBundledSkillsPath(), 'ragchat', 'SKILL.md');
const text = readFileSync(skillFile, 'utf8');

describe('skill intégré ragchat', () => {
  it('se charge depuis le niveau bundled', async () => {
    const registry = new SkillRegistry({
      bundledPath: getBundledSkillsPath(),
      managedPath: path.join('/nonexistent', 'managed'),
      workspacePath: path.join('/nonexistent', 'workspace'),
      watchEnabled: false,
    });
    await registry.load();
    const skill = registry.get('ragchat');
    expect(skill).toBeDefined();
    expect(skill!.tier).toBe('bundled');
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
