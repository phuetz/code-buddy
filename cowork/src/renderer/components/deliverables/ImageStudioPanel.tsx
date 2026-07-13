/**
 * ImageStudioPanel — the Genspark-style image generator: agent session →
 * image_generate (xAI/OpenAI/ComfyUI backend) → the produced file renders
 * inline. Thin wrapper over the shared DeliverableStudioPanel.
 */
import { Image as ImageIcon } from 'lucide-react';
import { DeliverableStudioPanel, type DeliverableStudioConfig } from './DeliverableStudioPanel.js';
import {
  buildImageGenerationPrompt,
  buildImageVariationPrompt,
  latestImagePath,
} from './media-path-model.js';
import { ImageDesignEditor } from './DesignViewEditors.js';

export function ImageStudioPanel() {
  const config: DeliverableStudioConfig<string> = {
    sessionTitlePrefix: 'Image — ',
    placeholder:
      'Décris l\'image — ex. « un bébé shar-pei qui s\'amuse dans la nature, photo réaliste ». Ctrl/⌘+Entrée pour générer.',
    generateLabel: "Générer l'image",
    exportLabel: 'Variante',
    exportTooltip: "L'agent génère une variante du même sujet",
    icon: ImageIcon,
    buildGenerationPrompt: buildImageGenerationPrompt,
    buildExportPrompt: () => buildImageVariationPrompt(),
    latest: latestImagePath,
    strip: (text) => text,
    describe: (path) => path.split('/').pop() ?? path,
    renderPreview: (path) =>
      path ? (
        <img
          src={`file://${path}`}
          alt="Image générée"
          className="mx-auto max-h-full max-w-full rounded-lg border border-border object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
          L'image générée s'affichera ici.
        </div>
      ),
    renderDesign: (path, onChange) => <ImageDesignEditor value={path} onChange={onChange} />,
    testId: 'image-studio',
  };

  return <DeliverableStudioPanel config={config} />;
}
