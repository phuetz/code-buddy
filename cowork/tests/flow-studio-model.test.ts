import { describe, expect, it } from 'vitest';
import {
  buildFlowPrompt,
  createFlowScene,
  extendFlowScene,
  ingredientNameFromPath,
  insertIngredientReference,
  removeIngredientReference,
  sourceVideoClips,
  type FlowIngredient,
} from '../src/renderer/components/videostudio/flow-studio-model';

const lina: FlowIngredient = {
  id: 'lina',
  name: 'Lina',
  kind: 'character',
  path: '/tmp/lina.png',
  url: 'file:///tmp/lina.png',
};

describe('Flow Studio model', () => {
  it('creates stable @ references without duplicating them', () => {
    expect(insertIngredientReference('Traverse la rue', lina)).toBe('Traverse la rue @Lina ');
    expect(insertIngredientReference('Traverse avec @Lina', lina)).toBe('Traverse avec @Lina');
    expect(removeIngredientReference('Traverse avec @Lina dans la rue', lina)).toBe('Traverse avec dans la rue');
  });

  it('compiles visual continuity, frames, camera and audio into the provider prompt', () => {
    const prompt = buildFlowPrompt({
      prompt: '@Lina traverse la rue',
      ingredients: [lina],
      camera: 'dolly-back',
      startFrame: lina,
      audioEnabled: true,
      voiceEnabled: true,
    });
    expect(prompt).toContain('Références visuelles cohérentes : @Lina');
    expect(prompt).toContain('image de départ @Lina');
    expect(prompt).toContain('travelling arrière lent');
    expect(prompt).toContain('voix cohérente');
    expect(prompt).toContain('Préserver strictement l’identité');
  });

  it('extends a scene with continuity while retaining its last visual reference', () => {
    const scene = { ...createFlowScene(1), prompt: 'Plan pluie', url: 'file:///tmp/shot.png', mediaType: 'image' as const };
    const extension = extendFlowScene(scene, 2);
    expect(extension.prompt).toContain('Continuation fluide');
    expect(extension.url).toBe(scene.url);
    expect(extension.status).toBe('draft');
    expect(extension.parentSceneId).toBe(scene.id);
  });

  it('turns imported filenames into reference-safe display names', () => {
    expect(ingredientNameFromPath('/tmp/rue pluie_final.png')).toBe('RuePluieFinal');
  });

  it('does not reassemble a previous final master into the next final master', () => {
    expect(sourceVideoClips([
      { ...createFlowScene(1), mediaType: 'video', path: '/tmp/clip-1.mp4', status: 'done' },
      {
        ...createFlowScene(2),
        mediaType: 'video',
        path: '/tmp/final.mp4',
        youtubeMetadataPath: '/tmp/final.mp4.youtube.json',
        status: 'done',
      },
    ])).toEqual(['/tmp/clip-1.mp4']);
  });
});
