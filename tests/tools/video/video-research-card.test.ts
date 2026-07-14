import { describe, expect, it } from 'vitest';

import {
  buildVideoExperimentBacklog,
  buildVideoResearchCard,
  buildVideoResearchCardPreview,
} from '../../../src/tools/video/video-research-card.js';

describe('buildVideoResearchCard', () => {
  it('maps technology and verification signals across the complete transcript', () => {
    const card = buildVideoResearchCard({
      source: 'https://youtu.be/research123?si=tracking',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      question: 'Quelles pistes sont utiles pour Code Buddy ?',
      segments: [
        { t_start: 0, t_end: 8, said: 'Introduction générale de la vidéo.' },
        {
          t_start: 120,
          t_end: 128,
          said: 'Le modèle PanoWorld conserve une mémoire spatiale cohérente.',
        },
        { t_start: 300, t_end: 309, said: 'Le projet est open source et disponible sur GitHub.' },
        { t_start: 600, t_end: 610, said: 'Le benchmark annonce 92,4 % sur un seul GPU.' },
        {
          t_start: 900,
          t_end: 910,
          said: 'Un robot exécute ensuite les commandes vocales en temps réel.',
        },
      ],
    });

    expect(card).toContain('# Fiche de recherche vidéo');
    expect(card).toContain('Quelles pistes sont utiles pour Code Buddy ?');
    expect(card).toContain('PanoWorld');
    expect(card).toContain('GitHub');
    expect(card).toContain('92,4 %');
    expect(card).toContain('15:00');
    expect(card).toContain('ils ne constituent pas une validation');
  });

  it('deduplicates explicit links and includes an optional cloud synopsis', () => {
    const card = buildVideoResearchCard({
      source: 'https://example.com/video.mp4',
      method: 'direct-url',
      transcriptPath: '/tmp/transcript.txt',
      cloudAnswer: 'Synthèse horodatée du contenu visuel.',
      segments: [
        { t_start: 0, t_end: 5, said: 'Code sur https://github.com/example/repo.' },
        { t_start: 6, t_end: 10, said: 'Voir encore https://github.com/example/repo.' },
      ],
    });

    const linksSection =
      card
        .split('## Liens mentionnés dans le transcript')[1]
        ?.split('## Backlog d’expériences')[0] ?? '';
    expect(linksSection.match(/https:\/\/github\.com\/example\/repo/g)).toHaveLength(1);
    expect(card).toContain('Synthèse cloud disponible (non vérifiée)');
    expect(card).toContain('Synthèse horodatée du contenu visuel.');
  });

  it('remains useful for a silent or non-technical transcript', () => {
    const card = buildVideoResearchCard({
      source: '/videos/silent.mp4',
      method: 'local-file',
      transcriptPath: '/tmp/silent.txt',
      segments: [],
    });

    expect(card).toContain('0 segments');
    expect(card).toContain('Aucun passage détecté automatiquement');
    expect(card).toContain('Analyse générale de la vidéo partagée.');
  });

  it('renders a bounded preview selected from the complete transcript', () => {
    const preview = buildVideoResearchCardPreview({
      source: 'https://youtu.be/research123',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      segments: [
        { t_start: 0, t_end: 10, said: 'Introduction sans information particulière.' },
        {
          t_start: 1_200,
          t_end: 1_210,
          said: 'PanoWorld est un world model open source annoncé sur GitHub.',
        },
        { t_start: 1_500, t_end: 1_510, said: 'Le benchmark revendique une amélioration de 42 %.' },
      ],
    });

    expect(preview).toContain('Aperçu de recherche (transcript complet)');
    expect(preview).toContain('PanoWorld');
    expect(preview).toContain('25:00');
    expect(preview).toContain('non vérifiés');
  });

  it('omits the preview when no research signal is detected', () => {
    const preview = buildVideoResearchCardPreview({
      source: '/tmp/silent.mp4',
      method: 'local-file',
      transcriptPath: '/tmp/transcript.txt',
      segments: [{ t_start: 0, t_end: 2, said: 'Bonjour tout le monde.' }],
    });

    expect(preview).toBe('');
  });

  it('turns discoveries into bounded, explicitly unverified experiments', () => {
    const backlog = buildVideoExperimentBacklog({
      source: 'https://youtu.be/lab',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      segments: [
        {
          t_start: 420,
          t_end: 430,
          said: 'Le modèle PanoWorld produit des panoramas 3D cohérents sur un GPU.',
        },
        {
          t_start: 700,
          t_end: 710,
          said: 'Un avatar FashionChameleon change de vêtement par diffusion.',
        },
        {
          t_start: 900,
          t_end: 910,
          said: 'Le robot humanoïde exécute des commandes vocales en temps réel.',
        },
      ],
    });

    expect(backlog.candidates).toHaveLength(3);
    expect(backlog.candidates.map((candidate) => candidate.category)).toEqual([
      'world-model-3d',
      'avatar-fashion',
      'robotics',
    ]);
    expect(backlog.candidates[0]).toMatchObject({
      title: 'PanoWorld',
      verificationStatus: 'unverified',
      evidence: { t_start: 420 },
    });
    expect(backlog.candidates[2]?.minimumExperiment).toContain('simulation');
  });

  it('keeps later capability families despite a dense early topic', () => {
    const genomics = Array.from({ length: 30 }, (_, index) => ({
      t_start: index * 40,
      t_end: index * 40 + 8,
      said: `Le modèle génomique ADN ${index} utilise une architecture transformer open source sur GPU.`,
    }));
    const backlog = buildVideoExperimentBacklog({
      source: 'https://youtu.be/diverse',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      segments: [
        ...genomics,
        {
          t_start: 2_000,
          t_end: 2_008,
          said: 'PanoWorld est un world model 3D spatial open source.',
        },
        {
          t_start: 2_060,
          t_end: 2_068,
          said: 'FashionChameleon anime un avatar et change ses vêtements.',
        },
        {
          t_start: 2_120,
          t_end: 2_128,
          said: 'Un workflow n8n orchestre les agents avec une API.',
        },
      ],
    });

    expect(backlog.candidates).toHaveLength(24);
    expect(new Set(backlog.candidates.map((candidate) => candidate.category))).toEqual(
      new Set(['genomics', 'world-model-3d', 'avatar-fashion', 'workflow-automation'])
    );
  });

  it('repairs caption-damaged project names and attaches primary-source hints', () => {
    const backlog = buildVideoExperimentBacklog({
      source: 'https://youtu.be/caption-errors',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      segments: [
        {
          t_start: 540,
          t_end: 552,
          said: 'Le Reactive JWM sépare les actions du joueur et la stratégie du PNJ dans ce modèle monde.',
        },
        {
          t_start: 615,
          t_end: 630,
          said: 'Long 4 vidéo Avatar 1.5 anime une photo avec une piste audio et Whisper large.',
        },
        {
          t_start: 705,
          t_end: 720,
          said: 'Fashion caméléon change les vêtements de cet avatar pendant la génération vidéo.',
        },
      ],
    });

    expect(backlog.candidates.map((candidate) => candidate.title)).toEqual([
      'ReactiveGWM',
      'LongCat-Video-Avatar-1.5',
      'FashionChameleon',
    ]);
    expect(backlog.candidates[0]).toMatchObject({
      category: 'game-world',
      links: expect.arrayContaining(['https://github.com/INV-WZQ/ReactiveGWM']),
    });
    expect(backlog.candidates[1]?.links).toContain(
      'https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5'
    );
    expect(backlog.candidates[2]?.links).toContain(
      'https://github.com/QuanjianSong/FashionChameleon'
    );
  });
});
