/**
 * Pure helpers for AI Drive item indexing.
 *
 * @module renderer/utils/drive-index
 */

export type DriveItemType = 'deck' | 'sheet' | 'doc' | 'page' | 'image' | 'report' | 'podcast' | 'video';

export interface DriveItem {
  id: string;
  title: string;
  type: DriveItemType;
  tags: string[];
  updatedAt: number;
  owner?: string;
}

export function filterDrive(items: DriveItem[], query: string, tags: string[]): DriveItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  return items.filter((item) => {
    const matchesQuery =
      !normalizedQuery ||
      item.title.toLowerCase().includes(normalizedQuery) ||
      item.type.toLowerCase().includes(normalizedQuery) ||
      item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
    const matchesTags = tagSet.size === 0 || item.tags.some((tag) => tagSet.has(tag.toLowerCase()));
    return matchesQuery && matchesTags;
  });
}

export function groupByType(items: DriveItem[]): Record<DriveItemType, DriveItem[]> {
  const groups: Record<DriveItemType, DriveItem[]> = {
    deck: [],
    sheet: [],
    doc: [],
    page: [],
    image: [],
    report: [],
    podcast: [],
    video: [],
  };

  for (const item of items) {
    groups[item.type].push(item);
  }

  return groups;
}
