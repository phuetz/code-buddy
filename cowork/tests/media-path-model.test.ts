/**
 * media-path-model — real tests: extract the newest generated media path from
 * session messages, and build the generation/variation prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildImageGenerationPrompt,
  buildImageVariationPrompt,
  buildVideoGenerationPrompt,
  latestImagePath,
  latestVideoPath,
} from '../src/renderer/components/deliverables/media-path-model';

const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });

describe('latestImagePath / latestVideoPath', () => {
  it('extracts the NEWEST absolute media path from assistant replies', () => {
    const messages = [
      msg('assistant', 'Créé : /a/old.jpg'),
      msg('user', 'variante'),
      msg('assistant', 'Voici : `/home/p/.codebuddy/media-generation/images/image-123.jpg`'),
    ];
    expect(latestImagePath(messages)).toBe('/home/p/.codebuddy/media-generation/images/image-123.jpg');
    expect(latestImagePath(messages, 'live: /tmp/live.png ...')).toBe('/tmp/live.png');
  });

  it('separates image and video extensions', () => {
    const messages = [msg('assistant', 'fichier /x/clip.mp4 et image /x/pic.jpg')];
    expect(latestVideoPath(messages)).toBe('/x/clip.mp4');
    expect(latestImagePath(messages)).toBe('/x/pic.jpg');
    expect(latestVideoPath([msg('assistant', 'rien ici')])).toBeNull();
  });
});

describe('prompts', () => {
  it('image prompt carries the subject and the tool contract', () => {
    const p = buildImageGenerationPrompt('un chaton astronaute');
    expect(p).toContain('un chaton astronaute');
    expect(p).toContain('image_generate');
    expect(p).toContain('chemin absolu');
  });

  it('video prompt targets video_generate; variation stays in-session', () => {
    expect(buildVideoGenerationPrompt('un drone au ralenti')).toContain('video_generate');
    expect(buildImageVariationPrompt()).toContain('VARIANTE');
  });
});
