/**
 * Charter, principle 1: never say you did what you did not do. A fixed spoken line cannot know what
 * happened, so it may not claim work, autonomy or a later summary: no mechanism stands behind such a
 * promise today (the evening summary is a later step of the autonomy plan). Only a real agent turn,
 * or an activity that actually ran, may speak of what was done.
 */
import { describe, expect, it } from 'vitest';
import { VOICE_INTERACTIONS, VOICE_INTERACTION_PREWARM_PHRASES } from '../../src/sensory/voice-interactions.js';
import { DEFAULT_TTS_PREWARM_PHRASES, fastCompanionReply } from '../../src/sensory/voice-loop.js';

const UNBACKED_CLAIM =
  /j[’']ai (?:continué|bien travaillé|amélioré|travaillé)|je te ferai un résumé|garde un résumé|résumé de ce que j|(?:je )?continue (?:en autonomie|ici|calmement)|pendant ton absence/i;

describe('Lisa never claims work she did not do', () => {
  it('no fixed voice reply claims unbacked work or promises a summary', () => {
    const spoken = VOICE_INTERACTIONS.filter((interaction) => !interaction.requiresAgent);
    for (const interaction of spoken) {
      expect(interaction.reply, interaction.id).not.toMatch(UNBACKED_CLAIM);
    }
    for (const phrase of VOICE_INTERACTION_PREWARM_PHRASES) expect(phrase).not.toMatch(UNBACKED_CLAIM);
  });

  it('no pre-warmed TTS phrase claims unbacked work', () => {
    for (const phrase of DEFAULT_TTS_PREWARM_PHRASES) expect(phrase).not.toMatch(UNBACKED_CLAIM);
  });

  it('the day question and a departure get honest answers', () => {
    for (const heard of [
      'comment s est passée ta journée',
      'Lisa comment s est passée ta journée',
      'Lisa je pars chez des amis',
      'Lisa je pars au travail',
      'Lisa je suis rentré',
      'à tout à l’heure Lisa',
    ]) {
      const reply = fastCompanionReply(heard);
      expect(reply, heard).toBeTruthy();
      expect(reply, heard).not.toMatch(UNBACKED_CLAIM);
    }
  });
});
