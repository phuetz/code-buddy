/**
 * Pure folder-mode ground-truth selection for `buddy vision-train`.
 *
 * An explicit empty object is valid ground truth for an empty scene. A missing
 * filename, however, must never be interpreted as an empty scene: doing so
 * turns every real detection into a false positive and corrupts the benchmark.
 */
import type { SceneSpec } from './curriculum.js';
import type { VisionTrainLabels } from './coco-to-labels.js';

export interface LabeledFolderSelection {
  specs: SceneSpec[];
  missingFiles: string[];
}

export function selectLabeledFolderScenes(
  files: readonly string[],
  labelMap: VisionTrainLabels,
): LabeledFolderSelection {
  const specs: SceneSpec[] = [];
  const missingFiles: string[] = [];

  for (const file of files) {
    const counts = labelMap[file];
    if (counts === undefined) {
      missingFiles.push(file);
      continue;
    }

    specs.push({
      id: file,
      prompt: '',
      expect: { counts: { ...counts } },
      tags: [],
    });
  }

  return { specs, missingFiles };
}

export function formatMissingGroundTruthWarning(count: number): string {
  const imageSuffix = count === 1 ? '' : 's';
  const labelSuffix = count === 1 ? '' : 's';
  return `${count} image${imageSuffix} ignored — no ground-truth label${labelSuffix}.`;
}
