/**
 * DocStudioPanel — the Genspark-style document generator: agent session under
 * the ```doc contract → DocPreview live → .docx export via the real skill.
 * Thin wrapper over the shared DeliverableStudioPanel.
 */
import { FileText } from 'lucide-react';
import { DocPreview } from './DocPreview.js';
import { DocDesignEditor } from './DesignViewEditors.js';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildDocExportPrompt,
  buildDocGenerationPrompt,
  latestDocBlock,
  stripDocBlocks,
  type ParsedDoc,
} from './doc-block-model.js';

export function DocStudioPanel() {
  const config: DeliverableStudioConfig<ParsedDoc> = {
    sessionTitlePrefix: 'Doc — ',
    placeholder:
      'Sujet du document — ex. « note de cadrage : ouvrir Code Buddy aux bêta-testeurs ». Ctrl/⌘+Entrée pour générer.',
    generateLabel: 'Générer le document',
    exportLabel: 'Exporter en .docx',
    exportTooltip: "L'agent écrit le fichier .docx avec le skill docx (dossier de travail)",
    icon: FileText,
    buildGenerationPrompt: buildDocGenerationPrompt,
    buildExportPrompt: buildDocExportPrompt,
    latest: latestDocBlock,
    strip: stripDocBlocks,
    describe: (doc) => `${doc.title} — ${doc.blocks.length} blocs`,
    renderPreview: (doc) => <DocPreview blocks={doc?.blocks ?? []} />,
    renderDesign: (doc, onChange) => <DocDesignEditor value={doc} onChange={onChange} />,
    testId: 'doc-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
