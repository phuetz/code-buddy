import { describe, expect, it } from 'vitest';
import { fileIconName, sortTree, type TreeNode } from '../src/renderer/components/studio/utils/file-tree-model.js';

describe('sortTree', () => {
  it('sorts directories first and recurses without mutating input', () => {
    const tree: TreeNode[] = [
      { name: 'b.ts', path: 'b.ts', type: 'file' },
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [
          { name: 'z.ts', path: 'src/z.ts', type: 'file' },
          { name: 'a.ts', path: 'src/a.ts', type: 'file' },
        ],
      },
      { name: 'a.json', path: 'a.json', type: 'file' },
    ];

    expect(sortTree(tree)).toEqual([
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [
          { name: 'a.ts', path: 'src/a.ts', type: 'file' },
          { name: 'z.ts', path: 'src/z.ts', type: 'file' },
        ],
      },
      { name: 'a.json', path: 'a.json', type: 'file' },
      { name: 'b.ts', path: 'b.ts', type: 'file' },
    ]);
    expect(tree[1]?.children?.[0]?.name).toBe('z.ts');
  });
});

describe('fileIconName', () => {
  it('classifies common file types', () => {
    expect(fileIconName('src/App.tsx')).toBe('code');
    expect(fileIconName('package.json')).toBe('json');
    expect(fileIconName('README.md')).toBe('text');
    expect(fileIconName('assets/logo.png')).toBe('image');
    expect(fileIconName('archive.zip')).toBe('archive');
    expect(fileIconName('LICENSE')).toBe('file');
  });
});
