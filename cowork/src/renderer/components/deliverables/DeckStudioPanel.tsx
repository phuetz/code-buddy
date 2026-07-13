/**
 * DeckStudioPanel — the Genspark-style deck generator: agent session under the
 * ```deck contract → SlideDeckPreview live → .pptx export via the real skill.
 * Thin wrapper over the shared DeliverableStudioPanel.
 */
import { Presentation } from 'lucide-react';
import { useState } from 'react';
import { SlideDeckPreview } from './SlideDeckPreview.js';
import { DeckDesignEditor } from './DesignViewEditors.js';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildDeckExportPrompt,
  buildDeckGenerationPrompt,
  latestDeckBlock,
  stripDeckBlocks,
  type ParsedDeck,
} from './deck-block-model.js';

export function DeckStudioPanel() {
  const [activeIndex, setActiveIndex] = useState(0);

  const config: DeliverableStudioConfig<ParsedDeck> = {
    sessionTitlePrefix: 'Deck — ',
    placeholder:
      'Sujet du deck — ex. « lancer Code Buddy auprès des équipes dev ». Ctrl/⌘+Entrée pour générer.',
    generateLabel: 'Générer le deck',
    exportLabel: 'Exporter en .pptx',
    exportTooltip: "L'agent écrit le fichier .pptx avec le skill pptx (dossier de travail)",
    icon: Presentation,
    buildGenerationPrompt: buildDeckGenerationPrompt,
    buildExportPrompt: buildDeckExportPrompt,
    latest: latestDeckBlock,
    strip: stripDeckBlocks,
    describe: (deck) => `${deck.title} — ${deck.slides.length} slides`,
    renderPreview: (deck) => (
      <SlideDeckPreview slides={deck?.slides ?? []} activeIndex={activeIndex} onSelect={setActiveIndex} />
    ),
    renderDesign: (deck, onChange) => <DeckDesignEditor value={deck} onChange={onChange} />,
    testId: 'deck-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
