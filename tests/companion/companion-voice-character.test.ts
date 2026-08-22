import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import {
  buildCompanionVoiceCharacterBlock,
  buildProgressiveIntimacyGuidance,
  isCompanionGirlfriendVoice,
  LISA_XAI_FEW_SHOT_EXEMPLARS,
  LISA_XAI_VOICE_SPINE,
  shouldBorrowLisaVoiceLayer,
  shouldInjectLisaFewShot,
} from '../../src/companion/companion-voice-character.js';
import type { RelationshipState } from '../../src/companion/relationship-state.js';
import {
  getActivePersonaVoice,
  getPersonaManager,
  resetPersonaManager,
} from '../../src/personas/persona-manager.js';

describe('companion-voice-character', () => {
  it('detects Lisa-shaped voice layers', () => {
    expect(isCompanionGirlfriendVoice({ personaId: 'lisa' })).toBe(true);
    expect(isCompanionGirlfriendVoice({ robotName: 'Lisa' })).toBe(true);
    expect(
      isCompanionGirlfriendVoice({
        spokenPrompt: 'Tu es Lisa, la petite amie numérique de Patrice',
      }),
    ).toBe(true);
    expect(isCompanionGirlfriendVoice({ personaId: 'debugger' })).toBe(false);
  });

  it('builds progressive intimacy from rapport sessions (not a scoreboard)', () => {
    const nouveau: RelationshipState = {
      firstSeenAt: 1,
      lastPresentAt: 1,
      celebratedMilestones: [],
      sessions: 0,
    };
    const complice: RelationshipState = {
      firstSeenAt: 1,
      lastPresentAt: 1,
      celebratedMilestones: [],
      sessions: 25,
    };
    expect(buildProgressiveIntimacyGuidance(nouveau)).toMatch(/nouveau/i);
    expect(buildProgressiveIntimacyGuidance(complice)).toMatch(/complice/i);
    expect(buildProgressiveIntimacyGuidance(null)).toBe('');
  });

  it('injects xAI spine + intimacy for Lisa personas only', () => {
    const block = buildCompanionVoiceCharacterBlock({
      personaId: 'lisa',
      includeFewShot: false,
      relationshipState: {
        firstSeenAt: 1,
        lastPresentAt: 1,
        celebratedMilestones: [],
        sessions: 8,
        mood: 70,
      },
    });
    expect(block).toContain(LISA_XAI_VOICE_SPINE.slice(0, 40));
    expect(block).toMatch(/companion_character|Ani|Mika|petite amie/i);
    expect(block).toMatch(/familier|companion_intimacy/i);

    expect(
      buildCompanionVoiceCharacterBlock({
        personaId: 'debugger',
        spokenPrompt: undefined,
        includeIntimacy: false,
      }),
    ).toBe('');
  });

  it('injects few-shot exemplars on cadence (anti-dilution)', () => {
    expect(shouldInjectLisaFewShot(0, 4)).toBe(true);
    expect(shouldInjectLisaFewShot(1, 4)).toBe(false);
    expect(shouldInjectLisaFewShot(4, 4)).toBe(true);
    expect(shouldInjectLisaFewShot(0, 0)).toBe(false);

    const withShot = buildCompanionVoiceCharacterBlock({
      personaId: 'lisa',
      turnIndex: 0,
      includeIntimacy: false,
      relationshipState: null,
    });
    expect(withShot).toContain(LISA_XAI_FEW_SHOT_EXEMPLARS.slice(0, 30));
    expect(withShot).toMatch(/companion_examples|photo de toi|test est rouge/i);

    const without = buildCompanionVoiceCharacterBlock({
      personaId: 'lisa',
      turnIndex: 1,
      includeIntimacy: false,
      relationshipState: null,
    });
    expect(without).not.toContain('companion_examples');
  });

  it('shouldBorrowLisaVoiceLayer only when spoken is missing and robot is Lisa', () => {
    expect(
      shouldBorrowLisaVoiceLayer({
        activePersonaId: 'debugger',
        hasSpokenPrompt: false,
        robotName: 'Lisa',
      }),
    ).toBe(true);
    expect(
      shouldBorrowLisaVoiceLayer({
        activePersonaId: 'debugger',
        hasSpokenPrompt: true,
        robotName: 'Lisa',
      }),
    ).toBe(false);
    expect(
      shouldBorrowLisaVoiceLayer({
        activePersonaId: 'debugger',
        hasSpokenPrompt: false,
        robotName: 'Buddy',
      }),
    ).toBe(false);
  });
});

describe('persona voice borrow for robot Lisa', () => {
  let dir: string;
  let n = 0;
  const prevRobot = process.env.CODEBUDDY_ROBOT_NAME;
  const prevFb = process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK;

  async function waitInit(pm: ReturnType<typeof getPersonaManager>): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (pm.getActivePersona()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `cb-persona-borrow-${process.pid}-${n++}`, 'personas');
    await mkdir(dir, { recursive: true });
    resetPersonaManager();
    delete process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK;
  });

  afterEach(async () => {
    resetPersonaManager();
    if (prevRobot === undefined) delete process.env.CODEBUDDY_ROBOT_NAME;
    else process.env.CODEBUDDY_ROBOT_NAME = prevRobot;
    if (prevFb === undefined) delete process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK;
    else process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK = prevFb;
    await rm(path.dirname(dir), { recursive: true, force: true });
  });

  it('borrows Lisa spokenPrompt when active is debugger but robot is Lisa', async () => {
    process.env.CODEBUDDY_ROBOT_NAME = 'Lisa';
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    expect(pm.setActivePersona('debugger')).toBe(true);
    const v = getActivePersonaVoice();
    expect(v.personaId).toBe('debugger');
    expect(v.spokenPrompt).toContain('petite amie numérique');
    expect(v.robotName).toBe('Lisa');
  });

  it('does not borrow Lisa voice when robot is not Lisa', async () => {
    process.env.CODEBUDDY_ROBOT_NAME = 'Buddy';
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    expect(pm.setActivePersona('debugger')).toBe(true);
    const v = getActivePersonaVoice();
    expect(v.spokenPrompt).toBeUndefined();
  });
});
