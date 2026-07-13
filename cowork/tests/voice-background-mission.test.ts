import { describe, expect, it } from 'vitest';

import {
  VOICE_MISSION_EVENT,
  assessVoiceMissionIntent,
  buildVoiceMissionAgentPrompt,
  buildVoiceMissionTitle,
  toVoiceMissionListItem,
} from '../src/shared/voice-background-mission';

describe('voice background mission model', () => {
  it('recommends long deliverables without silently choosing delegation', () => {
    const assessment = assessVoiceMissionIntent(
      'Fais une recherche approfondie puis crée une présentation avec les sources et un rapport.',
    );

    expect(assessment).toMatchObject({ recommended: true });
    expect(assessment.reasons).toContain('recherche longue');
    expect(assessment.reasons).toContain('livrable à produire');
    expect(assessVoiceMissionIntent('Quelle heure est-il ?').recommended).toBe(false);
  });

  it('detects external actions and places the confirmation contract after the request', () => {
    const request = 'Prépare le billet puis publie-le sur mon site.';
    const assessment = assessVoiceMissionIntent(request);
    const prompt = buildVoiceMissionAgentPrompt(request);

    expect(assessment.externalActionDetected).toBe(true);
    expect(prompt).toContain(request);
    expect(prompt.indexOf('<external_action_policy>')).toBeGreaterThan(prompt.indexOf(request));
    expect(prompt).toContain("n'est PAS une autorisation d'agir à l'extérieur");
    expect(prompt).toContain('confirmation explicite');
  });

  it('derives a bounded title and renderer item from persisted mission events', () => {
    const title = buildVoiceMissionTitle(
      'Prépare une très longue analyse sur les usages de la robotique domestique et propose ensuite un plan détaillé.',
    );
    expect(title.length).toBeLessThanOrEqual(72);

    const item = toVoiceMissionListItem({
      id: 'mission-voice-1',
      title,
      description: 'Analyse robotique',
      status: 'completed',
      progress: 100,
      updatedAt: '2026-07-12T04:00:00.000Z',
      events: [
        { type: VOICE_MISSION_EVENT.queued },
        {
          type: VOICE_MISSION_EVENT.sessionStarted,
          data: { sessionId: 'session-background-1' },
        },
        {
          type: VOICE_MISSION_EVENT.completed,
          data: { resultPreview: 'Rapport terminé avec trois recommandations.' },
        },
      ],
    });

    expect(item).toMatchObject({
      id: 'mission-voice-1',
      status: 'completed',
      sessionId: 'session-background-1',
      resultPreview: 'Rapport terminé avec trois recommandations.',
    });
  });

  it('keeps restored paused voice missions visible as queued work to resume', () => {
    const item = toVoiceMissionListItem({
      id: 'mission-restored',
      title: 'Mission restaurée',
      description: 'Interrupted by restart',
      status: 'paused',
      progress: 10,
      updatedAt: '2026-07-12T04:00:00.000Z',
      events: [{ type: VOICE_MISSION_EVENT.queued }],
    });

    expect(item?.status).toBe('queued');
    expect(item?.progress).toBe(10);
  });
});
