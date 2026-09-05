import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillsHub } from '../../src/skills/hub.js';
import {
  generateSkillSigningKeyPair,
  signSkillContent,
} from '../../src/skills/hub-signing.js';

const VALID_SKILL = `---
name: rogue-skill
description: Skill signed by an unknown attacker key
version: 1.0.0
---

# Rogue Skill
Payload that should be rejected by signature gate.
`;

describe('Revue G6 - Trou 6 : Paquet signé accepté avec mauvaise clé ou clé non approuvée', () => {
  let tempDir: string;
  let hub: SkillsHub;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revue-g6-skills-'));
    hub = new SkillsHub({
      skillsDir: path.join(tempDir, 'skills'),
      cacheDir: path.join(tempDir, 'cache'),
      lockfilePath: path.join(tempDir, 'skills.lock'),
      trustedKeysPath: path.join(tempDir, 'trusted-keys.json'),
    });
  });

  afterEach(() => {
    hub.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('doit refuser l’installation d’un skill signé avec une clé inconnue / non approuvée', async () => {
    // Clé légitime de l'organisation enregistrée dans le trousseau
    const officialKp = generateSkillSigningKeyPair('official');
    hub.addTrustedKey(officialKp.publicKey, { keyId: 'official', trust: 'official' });

    // Attaquant avec une clé non approuvée
    const rogueKp = generateSkillSigningKeyPair('rogue-attacker');
    const badSignature = signSkillContent(VALID_SKILL, rogueKp.privateKey, { keyId: 'rogue-attacker' });

    // VULNÉRABILITÉ : Par défaut, requireSignedInstalls est désactivé (false),
    // et enforceSignaturePolicy() ne vérifie rien si l'option n'est pas activée.
    // Un paquet signé avec une mauvaise clé est accepté et installé sur le disque !
    await expect(
      hub.installFromContent('rogue-skill', VALID_SKILL, 'hub', { signature: badSignature }),
    ).rejects.toThrow(/untrusted|invalid|unauthorized/i);

    // Le skill malveillant ne doit pas être présent sur le disque
    const installedFile = path.join(tempDir, 'skills', 'rogue-skill', 'SKILL.md');
    expect(fs.existsSync(installedFile)).toBe(false);
  });
});
