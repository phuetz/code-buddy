type LegacyElectronFile = File & { path?: string };

type DropEntry = {
  isDirectory?: boolean;
  isFile?: boolean;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => DropEntry | null;
};

export type DroppedFilePathResolver = (file: File) => string;
export type DirectoryPathChecker = (filePath: string) => Promise<boolean>;

export function getLegacyDroppedFilePath(file: File): string {
  return 'path' in file && typeof (file as LegacyElectronFile).path === 'string'
    ? (file as LegacyElectronFile).path || ''
    : '';
}

export function getElectronDroppedFilePath(file: File): string {
  if (typeof window !== 'undefined' && window.electronAPI?.getPathForFile) {
    return window.electronAPI.getPathForFile(file) || getLegacyDroppedFilePath(file);
  }

  return getLegacyDroppedFilePath(file);
}

export async function resolveDroppedDirectoryPath(
  files: File[],
  items: ArrayLike<DataTransferItem> | null | undefined,
  resolvePath: DroppedFilePathResolver = getElectronDroppedFilePath,
  isDirectoryPath?: DirectoryPathChecker
): Promise<string | null> {
  const droppedItems = Array.from(items || []);

  for (let index = 0; index < droppedItems.length; index += 1) {
    const item = droppedItems[index] as DataTransferItemWithEntry;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (!entry?.isDirectory) {
      continue;
    }

    const itemFile = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    const folderPath = itemFile ? resolvePath(itemFile) : resolvePath(files[index]);
    if (folderPath) {
      return folderPath;
    }
  }

  if (isDirectoryPath) {
    for (const file of files) {
      const filePath = resolvePath(file);
      if (filePath && (await isDirectoryPath(filePath))) {
        return filePath;
      }
    }

    return null;
  }

  for (const file of files) {
    const filePath = resolvePath(file);
    if (!file.type && filePath && file.size === 0 && !file.name.includes('.')) {
      return filePath;
    }
  }

  return null;
}
