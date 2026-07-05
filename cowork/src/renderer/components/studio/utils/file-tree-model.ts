export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      ...(node.children ? { children: sortTree(node.children) } : {}),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function fileIconName(path: string): string {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|html|css)$/.test(lower)) return 'code';
  if (lower.endsWith('.json')) return 'json';
  if (/\.(md|txt|log)$/.test(lower)) return 'text';
  if (/\.(zip|tar|gz|tgz|rar|7z)$/.test(lower)) return 'archive';
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return 'image';
  return 'file';
}
