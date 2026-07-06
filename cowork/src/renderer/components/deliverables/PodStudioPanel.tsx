/**
 * PodStudioPanel — the Genspark-style AI Pod generator: agent session under
 * the ```pod contract → PodcastComposer live → audio export via the real
 * text_to_speech tool (piper local when available). Thin wrapper over the
 * shared DeliverableStudioPanel.
 */
import { Radio } from 'lucide-react';
import { PodcastComposer } from '../PodcastComposer.js';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildPodExportPrompt,
  buildPodGenerationPrompt,
  latestPodBlock,
  stripPodBlocks,
  type ParsedPod,
} from './pod-block-model.js';

export function PodStudioPanel() {
  const config: DeliverableStudioConfig<ParsedPod> = {
    sessionTitlePrefix: 'Pod — ',
    placeholder:
      "Sujet de l'épisode — ex. « la nuit où Code Buddy a appris à fabriquer ses apps ». Ctrl/⌘+Entrée pour générer.",
    generateLabel: "Générer l'épisode",
    exportLabel: 'Synthétiser (audio)',
    exportTooltip: "L'agent synthétise l'épisode avec text_to_speech (piper local si disponible)",
    icon: Radio,
    buildGenerationPrompt: buildPodGenerationPrompt,
    buildExportPrompt: buildPodExportPrompt,
    latest: latestPodBlock,
    strip: stripPodBlocks,
    describe: (pod) => `${pod.title} — ${pod.segments.length} segments`,
    renderPreview: (pod) => <PodcastComposer segments={pod?.segments ?? []} onSynthesize={() => {}} />,
    testId: 'pod-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
