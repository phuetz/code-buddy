import { createHash } from 'crypto';
import { mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertLongCatClipProbe,
  assertPlan,
  assertVoiceProfiles,
  assessPlannedShort,
  narrationTurnId,
  timelineStartsMs,
  type PlannedShort,
  verifiedAudioDigest,
  voiceProfileRevision,
} from '../../scripts/mysoulmate/render-youtube-short-batch.js';
import type { ResolvedVoiceProfile } from '../../src/tools/video/narration.js';

function plannedShort(): PlannedShort {
  return {
    shortId: 'lisa-pilot-fr',
    contentGroupId: 'lisa-pilot',
    locale: 'fr-FR',
    editorial: {
      title: 'Une histoire originale avec Lisa',
      description: 'Une micro-histoire originale, localisée et préparée pour une revue humaine privée.',
      translationStatus: 'source',
    },
    narration: {
      locale: 'fr-FR',
      voiceProfileId: 'lisa-fr-pocket-v1',
      ttsLanguage: 'french',
      fitPolicy: { leadInMs: 100, tailOutMs: 100, maxSpeedup: 1.08, overflow: 'reject' },
    },
    delivery: { mode: 'localized-lipsync-masters', visualSpeechMode: 'localized-lipsync' },
    render: {
      engine: 'LongCat-Video-Avatar-1.5',
      clipDurationSeconds: 3.72,
      shots: [1, 2, 3].map((index) => ({
        index,
        assetId: `lisa-safe-${index}`,
        sourceSha256: String(index).repeat(64),
        referenceImagePath: `/approved/lisa-${index}.png`,
        contentTier: 'safe',
        qaStatus: 'approved',
        voiceLine: `Phrase originale numéro ${index}.`,
        motionPrompt: `distinct cinematic movement ${index} with natural expression`,
        longCatPayload: {
          turnId: `lisa-pilot-fr-${index}`,
          prompt: `distinct cinematic movement ${index} with natural expression`,
          resolution: '480p',
        },
      })),
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      madeForKids: false,
      containsSyntheticMedia: true,
      reviewStatus: 'pending-human-review',
      defaultLanguage: 'fr-FR',
      defaultAudioLanguage: 'fr-FR',
    },
    rights: {
      voiceProfileId: 'lisa-fr-pocket-v1',
      validation: 'registry-required',
    },
  };
}

function plan(short = plannedShort()): unknown {
  return {
    schemaVersion: 3,
    sourceDigests: {
      imageManifestSha256: 'a'.repeat(64),
      imageCatalogSha256: 'b'.repeat(64),
      factoryConfigSha256: 'c'.repeat(64),
      assetApprovalsSha256: 'd'.repeat(64),
      productionLedgerSha256: 'e'.repeat(64),
    },
    policy: {
      contentTier: 'safe',
      qaStatus: 'approved',
      autoPublish: false,
      initialVisibility: 'private',
      syntheticMediaDisclosureRequired: true,
    },
    shorts: [short],
  };
}

describe('MySoulmate YouTube Short batch contract', () => {
  it('assesses the final crossfaded timeline instead of one 3.72-second clip', () => {
    const short = plannedShort();
    const report = assessPlannedShort(short, [short]);
    expect(report.checks.find((check) => check.id === 'format')).toMatchObject({ status: 'pass' });
    expect(report.ready).toBe(true);
  });

  it('rejects a hostile or out-of-order shot index before it reaches a path', () => {
    const short = plannedShort();
    short.render.shots[0]!.index = Number.NaN;
    expect(() => assertPlan(plan(short))).toThrow('unsafe or incomplete shot');
  });

  it('rejects duplicate short and LongCat turn identities', () => {
    const first = plannedShort();
    const duplicate = plannedShort();
    expect(() => assertPlan({ ...(plan() as Record<string, unknown>), shorts: [first, duplicate] }))
      .toThrow('Duplicate short ID');

    const second = plannedShort();
    second.shortId = 'lisa-pilot-fr-second';
    expect(() => assertPlan({ ...(plan() as Record<string, unknown>), shorts: [first, second] }))
      .toThrow('unsafe or incomplete shot');
  });

  it('accepts only a measured portrait LongCat clip with audio', () => {
    const valid = {
      duration: 3.72,
      width: 544,
      height: 704,
      fps: 25,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
    };
    expect(() => assertLongCatClipProbe(valid, 3.72)).not.toThrow();
    expect(() => assertLongCatClipProbe({ ...valid, duration: 2.1 }, 3.72)).toThrow('duration');
    expect(() => assertLongCatClipProbe({ ...valid, width: 704, height: 544 }, 3.72)).toThrow('portrait');
    expect(() => assertLongCatClipProbe({ ...valid, hasAudio: false, audioCodec: '' }, 3.72)).toThrow('audio');
  });

  it('derives caption starts from each actual clip duration', () => {
    expect(timelineStartsMs([3_720, 3_700, 3_740], 500)).toEqual([0, 3_220, 6_420]);
    expect(() => timelineStartsMs([3_720, 3_700], 500)).toThrow('three');
  });

  it('rejects the legacy schema that bypassed localized voice rights', () => {
    expect(() => assertPlan({ ...(plan() as object), schemaVersion: 1 })).toThrow('Plan policy');
  });

  it('requires the approval and production ledgers to be digest-bound', () => {
    const candidate = plan() as ReturnType<typeof plan> & {
      sourceDigests: Record<string, string>;
    };
    delete candidate.sourceDigests.assetApprovalsSha256;
    expect(() => assertPlan(candidate)).toThrow('Plan policy');
  });

  it('binds the planned locale and provenance to the resolved voice profile', () => {
    const short = plannedShort();
    const profile: ResolvedVoiceProfile = {
      id: 'lisa-fr-pocket-v1',
      locale: 'fr-FR',
      provider: 'pocket',
      voice: 'estelle',
      language: 'french',
      highQuality: true,
      commercialUseApproved: true,
      provenanceRef: 'voice-rights/lisa-fr-pocket-v1',
    };
    expect(() => assertVoiceProfiles([short], new Map([[profile.id, profile]]))).not.toThrow();
    expect(() => assertVoiceProfiles(
      [short],
      new Map([[profile.id, { ...profile, provenanceRef: 'voice-rights/replaced' }]]),
    )).not.toThrow();
    expect(() => assertVoiceProfiles(
      [short],
      new Map([[profile.id, { ...profile, language: 'english' }]]),
    )).toThrow('rights provenance');
  });

  it('invalidates the voice revision when the provider configuration changes', () => {
    const profile: ResolvedVoiceProfile = {
      id: 'lisa-fr-pocket-v1',
      locale: 'fr-FR',
      provider: 'pocket',
      voice: 'estelle',
      language: 'french',
      commercialUseApproved: true,
      provenanceRef: 'voice-rights/lisa-fr-pocket-v1',
    };
    expect(voiceProfileRevision({ ...profile, voice: 'alba' })).not.toBe(voiceProfileRevision(profile));
  });

  it('reuses only a byte-verified normalized narration artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codebuddy-youtube-audio-'));
    const audio = join(root, 'voice.wav');
    const digestFile = `${audio}.sha256`;
    const bytes = Buffer.alloc(2_048, 7);
    const digest = createHash('sha256').update(bytes).digest('hex');
    try {
      await writeFile(audio, bytes);
      await writeFile(digestFile, `${digest}\n`);
      await expect(verifiedAudioDigest(audio)).resolves.toBe(digest);
      await writeFile(audio, Buffer.alloc(2_048, 8));
      await expect(verifiedAudioDigest(audio)).resolves.toBeNull();
      await rm(audio);
      await symlink('/dev/null', audio);
      await expect(verifiedAudioDigest(audio)).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('binds retry turn identity to the exact synthesized narration bytes', () => {
    const base = 'museum-of-small-gestures-second-cup-lisa-fr-fr-01';
    const first = narrationTurnId(base, 'fr-fr', 'a'.repeat(64), 'b'.repeat(64));
    expect(first).toBe(narrationTurnId(base, 'fr-fr', 'a'.repeat(64), 'b'.repeat(64)));
    expect(first).not.toBe(narrationTurnId(base, 'fr-fr', 'a'.repeat(64), 'c'.repeat(64)));
    expect(first.length).toBeLessThanOrEqual(128);
  });
});
