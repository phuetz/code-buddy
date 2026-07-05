import {
  ChevronRight,
  File,
  FileArchive,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { fileIconName, sortTree, type TreeNode } from './utils/file-tree-model.js';

export interface StudioFileTreeProps {
  tree: TreeNode[];
  activePath?: string;
  onOpen: (path: string) => void;
  onCreate?: (parentPath: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
}

interface TreeRowProps extends Omit<StudioFileTreeProps, 'tree'> {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function FileIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  if (node.type === 'directory') {
    const Icon = expanded ? FolderOpen : Folder;
    return <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  }

  const icon = fileIconName(node.path);
  if (icon === 'code') return <FileCode className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (icon === 'json') return <FileJson className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (icon === 'text') return <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (icon === 'archive') return <FileArchive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (icon === 'image') return <Image className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  return <File className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

function TreeRow({
  node,
  depth,
  expanded,
  activePath,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onToggle,
}: TreeRowProps) {
  const isDirectory = node.type === 'directory';
  const isExpanded = expanded.has(node.path);
  const isActive = activePath === node.path;

  const handleMainClick = () => {
    if (isDirectory) {
      onToggle(node.path);
      return;
    }
    onOpen(node.path);
  };

  const stop = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation();

  return (
    <li>
      <div
        className={`group flex h-8 items-center gap-1 px-2 text-xs ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          onClick={handleMainClick}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          aria-expanded={isDirectory ? isExpanded : undefined}
        >
          {isDirectory ? (
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          ) : (
            <span className="h-3 w-3 shrink-0" />
          )}
          <FileIcon node={node} expanded={isExpanded} />
          <span className="truncate">{node.name}</span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
          {isDirectory && onCreate && (
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                onCreate(node.path);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title="Créer"
              aria-label={`Créer dans ${node.name}`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onRename && (
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                onRename(node.path);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title="Renommer"
              aria-label={`Renommer ${node.name}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                onDelete(node.path);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title="Supprimer"
              aria-label={`Supprimer ${node.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {isDirectory && isExpanded && node.children && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
              onOpen={onOpen}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function StudioFileTree({ tree, activePath, onOpen, onCreate, onRename, onDelete }: StudioFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const sortedTree = useMemo(() => sortTree(tree), [tree]);

  const handleToggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <nav className="flex h-full min-h-0 flex-col border border-border bg-surface" aria-label="Fichiers du projet">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted px-3">
        <span className="text-xs font-medium text-muted-foreground">Fichiers</span>
        {onCreate && (
          <button
            type="button"
            onClick={() => onCreate('')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground"
            title="Créer"
            aria-label="Créer un fichier"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {sortedTree.length > 0 ? (
          <ul>
            {sortedTree.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                activePath={activePath}
                onOpen={onOpen}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
                onToggle={handleToggle}
              />
            ))}
          </ul>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Aucun fichier.</div>
        )}
      </div>
    </nav>
  );
}
