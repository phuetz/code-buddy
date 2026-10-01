/**
 * SheetStudioPanel — the Genspark-style sheet generator: agent session under
 * the ```sheet contract → SheetPreview live → .xlsx export via the real skill.
 * Thin wrapper over the shared DeliverableStudioPanel.
 */
import { Table2 } from 'lucide-react';
import { SheetPreview } from './SheetPreview.js';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildSheetExportPrompt,
  buildSheetGenerationPrompt,
  latestSheetBlock,
  stripSheetBlocks,
  type ParsedSheet,
} from './sheet-block-model.js';

export function SheetStudioPanel() {
  const config: DeliverableStudioConfig<ParsedSheet> = {
    sessionTitlePrefix: 'Feuille — ',
    placeholder:
      'Sujet de la feuille — ex. « budget mensuel par catégorie ». Ctrl/⌘+Entrée pour générer.',
    generateLabel: 'Générer la feuille',
    exportLabel: 'Exporter en .xlsx',
    exportTooltip: "L'agent écrit le fichier .xlsx avec le skill xlsx (dossier de travail)",
    icon: Table2,
    buildGenerationPrompt: buildSheetGenerationPrompt,
    buildExportPrompt: buildSheetExportPrompt,
    latest: latestSheetBlock,
    strip: stripSheetBlocks,
    describe: (sheet) => `${sheet.title} — ${sheet.columns.length} colonnes × ${sheet.rows.length} lignes`,
    renderPreview: (sheet) => (
      <SheetPreview columns={sheet?.columns ?? []} rows={sheet?.rows ?? []} caption={sheet?.title} />
    ),
    testId: 'sheet-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
