import { describe, expect, it } from 'vitest';

import { filterDrive, groupByType, type DriveItem } from '../src/renderer/utils/drive-index';

const items: DriveItem[] = [
  { id: 'a', title: 'Rapport IA', type: 'report', tags: ['research'], updatedAt: 1 },
  { id: 'b', title: 'Deck Vente', type: 'deck', tags: ['sales'], updatedAt: 2 },
  { id: 'c', title: 'Table Prospects', type: 'sheet', tags: ['sales', 'crm'], updatedAt: 3 },
];

describe('filterDrive', () => {
  it('filters by query across title, type and tags', () => {
    expect(filterDrive(items, 'vente', []).map((item) => item.id)).toEqual(['b']);
    expect(filterDrive(items, 'crm', []).map((item) => item.id)).toEqual(['c']);
  });

  it('filters by selected tags', () => {
    expect(filterDrive(items, '', ['sales']).map((item) => item.id)).toEqual(['b', 'c']);
  });
});

describe('groupByType', () => {
  it('groups items into all known types', () => {
    const groups = groupByType(items);

    expect(groups.report).toHaveLength(1);
    expect(groups.deck).toHaveLength(1);
    expect(groups.doc).toHaveLength(0);
  });
});
