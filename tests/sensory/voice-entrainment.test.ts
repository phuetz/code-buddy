import { describe, expect, it } from 'vitest';
import {
  applyEmotionalModulation,
  deriveVoiceDeliveryProfile,
  voiceDeliveryGuidance,
  voiceRendererDeliveryInstruction,
} from '../../src/sensory/voice-entrainment.js';

describe('voice entrainment', () => {
  it('moves toward a calm human pace without imitating an extreme', () => {
    const profile = deriveVoiceDeliveryProfile(
      'je voudrais prendre le temps de réfléchir avec toi',
      { audioMs: 8_000 },
    );

    expect(profile).toMatchObject({
      pace: 'slow',
      pauseStyle: 'reflective',
      confidence: 'high',
      humanAudioMs: 8_000,
      humanWpm: 68,
      targetWpm: 105,
    });
  });

  it('follows a lively turn only part-way and keeps a safe acoustic bound', () => {
    const profile = deriveVoiceDeliveryProfile(
      'on avance vite maintenant donne moi les trois points essentiels',
      { audioMs: 3_000 },
    );

    expect(profile.pace).toBe('brisk');
    expect(profile.humanWpm).toBe(200);
    expect(profile.targetWpm).toBe(184);
    expect(profile.targetWpm).toBeLessThan(profile.humanWpm!);
  });

  it('does not invent precise WPM from a short interjection or implausible timing', () => {
    expect(deriveVoiceDeliveryProfile('oui', { audioMs: 400 })).toMatchObject({
      pace: 'balanced',
      responseShape: 'compact',
      confidence: 'low',
      humanWordCount: 1,
    });
    expect(deriveVoiceDeliveryProfile('un deux trois', { audioMs: 100 }).humanWpm).toBeUndefined();
  });

  it('uses turn length for oral shape while explicitly preserving intellectual depth', () => {
    const profile = deriveVoiceDeliveryProfile('Pourquoi la conscience existe-t-elle ?', {
      audioMs: 2_400,
    });
    const guidance = voiceDeliveryGuidance(profile);

    expect(profile.responseShape).toBe('compact');
    expect(guidance).toContain('jamais la qualité du fond');
    expect(guidance).toMatch(/analyse, actualité, preuves, nuances ou argumentation philosophique/);
    expect(guidance).toContain('fournis-les complètement');
  });

  it('provides a persona-neutral instruction for expressive renderers', () => {
    const profile = deriveVoiceDeliveryProfile(
      'je développe cette idée tranquillement pour que nous puissions vraiment la comprendre ensemble',
      { audioMs: 7_000 },
    );
    const instruction = voiceRendererDeliveryInstruction(profile);

    expect(instruction).toContain(`${profile.targetWpm} words per minute`);
    expect(instruction).not.toMatch(/Lisa|Patrice|personality/i);
  });

  it.each([
    ['sadness', 132],
    ['tired', 132],
  ])('slows and softens a %s read', (label, targetWpm) => {
    const profile = deriveVoiceDeliveryProfile('je prends un rythme régulier', {
      emotion: { label, intensity: 1 },
    });

    expect(profile).toMatchObject({
      pace: 'slow',
      pauseStyle: 'reflective',
      targetWpm,
    });
  });

  it('uses a low mood as a reflective fallback for a neutral utterance', () => {
    const profile = deriveVoiceDeliveryProfile('on continue', { mood: 'lasse' });

    expect(profile).toMatchObject({ pace: 'slow', pauseStyle: 'reflective', targetWpm: 132 });
  });

  it.each(['joy', 'radieuse', 'joyeuse'])('makes a %s register brisk and light', (label) => {
    const context = label === 'joy'
      ? { emotion: { label, intensity: 1 } }
      : { mood: label };
    const profile = deriveVoiceDeliveryProfile('on continue', context);

    expect(profile).toMatchObject({ pace: 'brisk', pauseStyle: 'light', targetWpm: 171 });
  });

  it('responds to frustration with calming pauses and only a slight WPM reduction', () => {
    const profile = deriveVoiceDeliveryProfile('ça ne marche toujours pas', {
      emotion: { label: 'frustration', intensity: 1 },
    });

    expect(profile).toMatchObject({ pace: 'slow', pauseStyle: 'reflective', targetWpm: 147 });
  });

  it('keeps emotionally modulated WPM inside the existing acoustic target bounds', () => {
    const low = applyEmotionalModulation(
      { ...deriveVoiceDeliveryProfile('un rythme neutre'), targetWpm: 105 },
      { emotion: { label: 'sadness', intensity: 1 } },
    );
    const high = applyEmotionalModulation(
      { ...deriveVoiceDeliveryProfile('un rythme neutre'), targetWpm: 195 },
      { emotion: { label: 'joy', intensity: 1 } },
    );

    expect(low.targetWpm).toBe(105);
    expect(high.targetWpm).toBe(195);
  });

  it('is byte-identical when neither emotion nor mood is supplied', () => {
    const baseline = deriveVoiceDeliveryProfile('on parle à un rythme régulier', {
      audioMs: 2_400,
    });
    const explicitEmpty = deriveVoiceDeliveryProfile('on parle à un rythme régulier', {
      audioMs: 2_400,
      emotion: undefined,
      mood: undefined,
    });

    expect(JSON.stringify(explicitEmpty)).toBe(JSON.stringify(baseline));
    expect(applyEmotionalModulation(baseline, {})).toBe(baseline);
  });
});
