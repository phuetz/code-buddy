/**
 * media-attachments-model — extraction of generated-media paths from chat
 * replies: the MEDIA: marker, bare absolute paths, URL rejection, dedup.
 */
import { describe, expect, it } from 'vitest';
import { extractMediaPaths, toFileUrl } from './media-attachments-model.js';

describe('extractMediaPaths', () => {
  it('extracts the MEDIA: marker form the video tool replies with', () => {
    const text = 'Vidéo créée :\nMEDIA:/home/pat/.codebuddy/media-generation/videos/video-123.mp4';
    expect(extractMediaPaths(text)).toEqual([
      { kind: 'video', path: '/home/pat/.codebuddy/media-generation/videos/video-123.mp4' },
    ]);
  });

  it('extracts bare absolute paths and classifies image/video/audio', () => {
    const text = 'Image: /out/a.png — vidéo `/out/b.mp4` — voix (/out/c.wav)';
    expect(extractMediaPaths(text)).toEqual([
      { kind: 'image', path: '/out/a.png' },
      { kind: 'video', path: '/out/b.mp4' },
      { kind: 'audio', path: '/out/c.wav' },
    ]);
  });

  it('ignores URLs and deduplicates repeated mentions', () => {
    const text = 'Voir https://example.com/photo.png et MEDIA:/out/a.png puis encore /out/a.png';
    expect(extractMediaPaths(text)).toEqual([{ kind: 'image', path: '/out/a.png' }]);
  });

  it('returns empty for plain prose', () => {
    expect(extractMediaPaths('Aucun média ici, juste du texte.')).toEqual([]);
  });
});

describe('toFileUrl', () => {
  it('encodes spaces and accents per segment', () => {
    expect(toFileUrl('/home/pat/mes vidéos/clip.mp4')).toBe('file:///home/pat/mes%20vid%C3%A9os/clip.mp4');
  });
});
