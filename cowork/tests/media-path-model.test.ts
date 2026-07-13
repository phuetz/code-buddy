/**
 * media-path-model — real tests: extract the newest generated media path from
 * session messages, and build the generation/variation prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildImageGenerationPrompt,
  buildImageVariationPrompt,
  buildVideoGenerationPrompt,
  isGeneratedMediaPath,
  latestImagePath,
  latestVideoPath,
} from '../src/renderer/components/deliverables/media-path-model';

const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });

describe('latestImagePath / latestVideoPath', () => {
  it('extracts the NEWEST absolute media path from assistant replies', () => {
    const messages = [
      msg('assistant', 'Créé : /a/.codebuddy/media-generation/images/old.jpg'),
      msg('user', 'variante'),
      msg('assistant', 'Voici : `/home/p/.codebuddy/media-generation/images/image-123.jpg`'),
    ];
    expect(latestImagePath(messages)).toBe('/home/p/.codebuddy/media-generation/images/image-123.jpg');
    expect(latestImagePath(messages, 'live: /tmp/.codebuddy/media-generation/images/live.png ...'))
      .toBe('/tmp/.codebuddy/media-generation/images/live.png');
  });

  it('separates image and video extensions', () => {
    const messages = [msg('assistant', 'fichier /x/.codebuddy/media-generation/videos/clip.mp4 et image /x/.codebuddy/media-generation/images/pic.jpg')];
    expect(latestVideoPath(messages)).toBe('/x/.codebuddy/media-generation/videos/clip.mp4');
    expect(latestImagePath(messages)).toBe('/x/.codebuddy/media-generation/images/pic.jpg');
    expect(latestVideoPath([msg('assistant', 'rien ici')])).toBeNull();
  });

  it('does not promote arbitrary or traversal-shaped assistant paths into Design View', () => {
    const messages = [msg(
      'assistant',
      'essaie /etc/private.png puis /safe/.codebuddy/media-generation/images/../../private.png',
    )];
    expect(latestImagePath(messages)).toBeNull();
    expect(isGeneratedMediaPath('/etc/private.png', 'image')).toBe(false);
    expect(isGeneratedMediaPath('/safe/.codebuddy/media-generation/images/ok.webp', 'image')).toBe(true);
    expect(isGeneratedMediaPath('C:\\Users\\Pat\\book\\.codebuddy\\media-generation\\images\\ok.png', 'image')).toBe(true);
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
