/**
 * StudioProjectHistory — bolt.new-style project history in the App Studio
 * empty state: every project directory a session ever worked in, newest
 * first, one click to reopen (the session becomes active; the workbench
 * follows its cwd and cold-session hydration restores the conversation).
 */
import { useMemo } from 'react';
import { FolderGit2 } from 'lucide-react';

import { useAppStore } from '../../store';
import type { Session } from '../../types';

export interface ProjectEntry {
  sessionId: string;
  cwd: string;
  name: string;
  title: string;
  updatedAt: number;
}

/** Distinct project dirs (excluding the default working dir), newest session per dir. */
export function recentProjects(sessions: ReadonlyArray<Session>, cap = 8): ProjectEntry[] {
  const byCwd = new Map<string, ProjectEntry>();
  for (const session of sessions) {
    const cwd = session.cwd?.trim();
    if (!cwd || session.archived) continue;
    if (cwd.endsWith('default_working_dir')) continue;
    const existing = byCwd.get(cwd);
    if (!existing || session.updatedAt > existing.updatedAt) {
      byCwd.set(cwd, {
        sessionId: session.id,
        cwd,
        name: cwd.split('/').filter(Boolean).pop() ?? cwd,
        title: session.title || 'Untitled',
        updatedAt: session.updatedAt,
      });
    }
  }
  return [...byCwd.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, cap);
}

export function StudioProjectHistory() {
  const sessions = useAppStore((s) => s.sessions);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const projects = useMemo(() => recentProjects(sessions), [sessions]);

  if (projects.length === 0) return null;

  return (
    <div className="mx-auto mt-6 w-full max-w-4xl" data-testid="studio-project-history">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recent projects
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {projects.map((project) => (
          <button
            key={project.cwd}
            type="button"
            onClick={() => setActiveSession(project.sessionId)}
            className="rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent hover:bg-accent/10"
            title={project.cwd}
          >
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{project.name}</span>
            </div>
            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{project.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {new Date(project.updatedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
