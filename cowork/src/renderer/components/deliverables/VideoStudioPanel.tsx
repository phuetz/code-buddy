/**
 * VideoStudioPanel — the Genspark-style video generator: agent session →
 * video_generate (xAI/fal backend) → the produced file plays inline.
 * Thin wrapper over the shared DeliverableStudioPanel.
 */
import { Clapperboard } from 'lucide-react';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildVideoGenerationPrompt,
  buildVideoVariationPrompt,
  latestVideoPath,
} from './media-path-model.js';

export function VideoStudioPanel() {
  const config: DeliverableStudioConfig<string> = {
    sessionTitlePrefix: 'Vidéo — ',
    placeholder:
      'Décris la vidéo — ex. « un chiot shar-pei qui court au ralenti dans une prairie ». Ctrl/⌘+Entrée pour générer.',
    generateLabel: 'Générer la vidéo',
    exportLabel: 'Variante',
    exportTooltip: "L'agent génère une variante du même sujet",
    icon: Clapperboard,
    buildGenerationPrompt: buildVideoGenerationPrompt,
    buildExportPrompt: () => buildVideoVariationPrompt(),
    latest: latestVideoPath,
    strip: (text) => text,
    describe: (path) => path.split('/').pop() ?? path,
    renderPreview: (path) =>
      path ? (
        <video
          src={`file://${path}`}
          controls
          autoPlay
          loop
          muted
          className="mx-auto max-h-full max-w-full rounded-lg border border-border"
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
          La vidéo générée se jouera ici.
        </div>
      ),
    testId: 'video-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
