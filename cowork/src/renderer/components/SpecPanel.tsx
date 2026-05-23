/**
 * SpecPanel — review-gated work backlog (BMAD-inspired spec pipeline).
 *
 * Surfaces the core spec store (`buddy spec ...`, previously CLI-only): a
 * durable backlog of stories with a small transition machine
 * (draft → approved → in_progress → done, plus blocked). The gates are
 * reflected in the UI: approve needs a reviewer, complete needs evidence,
 * block needs a reason, `done` is terminal. Illegal transitions return a
 * readable error from the store rather than crashing.
 *
 * Spec projects are SEPARATE from Cowork projects — they live under the active
 * Cowork project's `.codebuddy/specs/`.
 *
 * @module cowork/renderer/components/SpecPanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, ListChecks, AlertCircle, FolderOpen, RefreshCw, Plus } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';
import {
  NO_ACTIVE_PROJECT,
  type SpecProject,
  type SpecStory,
  type SpecStoryStatus,
  type SprintStatus,
} from '../types/hermes';

const STATUS_TOKEN: Record<SpecStoryStatus, string> = {
  draft: 'text-text-secondary',
  approved: 'text-accent',
  in_progress: 'text-warning',
  done: 'text-success',
  blocked: 'text-error',
};

type ActionKind = 'approve' | 'complete' | 'block';
const ACTION_META: Record<ActionKind, { label: string; placeholder: string }> = {
  approve: { label: 'Approve — reviewer', placeholder: 'reviewer name' },
  complete: { label: 'Complete — evidence', placeholder: 'proof acceptance criteria are met' },
  block: { label: 'Block — reason', placeholder: 'why is this blocked?' },
};

export function SpecPanel() {
  const show = useAppStore((s) => s.showSpecPanel);
  const setShow = useAppStore((s) => s.setShowSpecPanel);

  const [projects, setProjects] = useState<SpecProject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sprint, setSprint] = useState<SprintStatus | null>(null);
  const [stories, setStories] = useState<SpecStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noProject, setNoProject] = useState(false);

  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryNarrative, setNewStoryNarrative] = useState('');
  const [showAddStory, setShowAddStory] = useState(false);

  // Inline action form (avoids window.prompt — unsupported in Electron).
  const [action, setAction] = useState<{ storyId: string; kind: ActionKind; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.electronAPI.spec.listProjects();
    setLoading(false);
    if (!res.ok) {
      setNoProject(res.error === NO_ACTIVE_PROJECT);
      setError(res.error === NO_ACTIVE_PROJECT ? null : res.error ?? 'Failed to load spec projects');
      setProjects([]);
      return;
    }
    setNoProject(false);
    setProjects(res.projects);
    setActiveId((prev) => prev ?? res.projects[0]?.id ?? null);
  }, []);

  const loadStories = useCallback(async (specProjectId: string) => {
    setError(null);
    const [storiesRes, sprintRes] = await Promise.all([
      window.electronAPI.spec.listStories(specProjectId),
      window.electronAPI.spec.sprintStatus(specProjectId),
    ]);
    if (!storiesRes.ok) {
      setError(storiesRes.error ?? 'Failed to load stories');
      setStories([]);
      return;
    }
    setStories(storiesRes.stories);
    setSprint(sprintRes.ok ? sprintRes.status ?? null : null);
  }, []);

  useEffect(() => {
    if (show) void loadProjects();
  }, [show, loadProjects]);

  useEffect(() => {
    if (show && activeId) void loadStories(activeId);
  }, [show, activeId, loadStories]);

  const createProject = async () => {
    if (!newProjectTitle.trim()) return;
    const res = await window.electronAPI.spec.createProject(newProjectTitle.trim());
    if (!res.ok || !res.project) {
      setError(res.error ?? 'Failed to create project');
      return;
    }
    setNewProjectTitle('');
    setActiveId(res.project.id);
    await loadProjects();
  };

  const addStory = async () => {
    if (!activeId || !newStoryTitle.trim()) return;
    const res = await window.electronAPI.spec.addStory(activeId, {
      title: newStoryTitle.trim(),
      narrative: newStoryNarrative.trim() || undefined,
    });
    if (!res.ok) {
      setError(res.error ?? 'Failed to add story');
      return;
    }
    setNewStoryTitle('');
    setNewStoryNarrative('');
    setShowAddStory(false);
    await loadStories(activeId);
  };

  // Transitions that need no extra input.
  const simpleTransition = async (story: SpecStory, kind: 'start' | 'reopen') => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    const res =
      kind === 'start'
        ? await window.electronAPI.spec.startStory(activeId, story.id)
        : await window.electronAPI.spec.reopenStory(activeId, story.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? `${kind} failed`);
      return;
    }
    await loadStories(activeId);
  };

  const submitAction = async () => {
    if (!activeId || !action) return;
    const value = action.value.trim();
    if (!value) {
      setError(`${ACTION_META[action.kind].label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    let res: { ok: boolean; error?: string };
    if (action.kind === 'approve') {
      res = await window.electronAPI.spec.approveStory(activeId, action.storyId, value);
    } else if (action.kind === 'complete') {
      res = await window.electronAPI.spec.completeStory(activeId, action.storyId, value);
    } else {
      res = await window.electronAPI.spec.blockStory(activeId, action.storyId, value);
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? `${action.kind} failed`);
      return;
    }
    setAction(null);
    await loadStories(activeId);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[620px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Spec backlog</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => activeId && void loadStories(activeId)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Close spec panel"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {noProject ? (
          <div className="flex-1">
            <EmptyState
              icon={<FolderOpen className="w-8 h-8 text-text-muted" />}
              title="No active project"
              hint="Select a project to manage its spec backlog (.codebuddy/specs/)."
            />
          </div>
        ) : (
          <>
            {/* Spec project selector + create */}
            <div className="border-b border-border px-4 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={activeId ?? ''}
                  onChange={(e) => setActiveId(e.target.value || null)}
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                >
                  {projects.length === 0 && <option value="">No spec project yet</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.phase}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  placeholder="New spec project title"
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => void createProject()}
                  className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create
                </button>
              </div>
              {sprint && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(Object.keys(sprint.byStatus) as SpecStoryStatus[]).map((st) => (
                    <span
                      key={st}
                      className={`rounded bg-surface/70 px-1.5 py-0.5 text-[10px] ${STATUS_TOKEN[st]}`}
                    >
                      {st}: {sprint.byStatus[st]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Add story */}
            {activeId && (
              <div className="border-b border-border px-4 py-2">
                {showAddStory ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newStoryTitle}
                      onChange={(e) => setNewStoryTitle(e.target.value)}
                      placeholder="Story title"
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <textarea
                      value={newStoryNarrative}
                      onChange={(e) => setNewStoryNarrative(e.target.value)}
                      rows={2}
                      placeholder="Narrative — the why + implementation guidance (optional)"
                      className="w-full resize-y rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowAddStory(false)}
                        className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void addStory()}
                        className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
                      >
                        Add story
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddStory(true)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add story
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {stories.length === 0 ? (
                <EmptyState
                  icon={<ListChecks className="w-8 h-8 text-text-muted" />}
                  title={loading ? 'Loading…' : 'No stories'}
                  hint="Add a story above, or run `buddy spec story add`. Stories must be approved before implementation."
                />
              ) : (
                stories.map((story) => (
                  <div
                    key={story.id}
                    className="rounded border border-border bg-surface/40 p-3 space-y-2"
                    data-testid="spec-story"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary truncate">{story.title}</span>
                      <span className={`text-[10px] uppercase tracking-wide shrink-0 ${STATUS_TOKEN[story.status]}`}>
                        {story.status}
                      </span>
                    </div>
                    {story.narrative && (
                      <p className="text-[11px] text-text-secondary whitespace-pre-wrap line-clamp-3">
                        {story.narrative}
                      </p>
                    )}
                    {story.blockedReason && (
                      <p className="text-[10px] text-error">blocked: {story.blockedReason}</p>
                    )}
                    {story.evidence && <p className="text-[10px] text-success">evidence: {story.evidence}</p>}
                    {story.reviewedBy && (
                      <p className="text-[10px] text-text-muted">approved by {story.reviewedBy}</p>
                    )}

                    {/* Inline action form for the current story */}
                    {action?.storyId === story.id ? (
                      <div className="space-y-2 rounded border border-accent/40 bg-background-secondary p-2">
                        <p className="text-[10px] uppercase tracking-wide text-accent">
                          {ACTION_META[action.kind].label}
                        </p>
                        <input
                          type="text"
                          autoFocus
                          value={action.value}
                          onChange={(e) => setAction({ ...action, value: e.target.value })}
                          placeholder={ACTION_META[action.kind].placeholder}
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setAction(null)}
                            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void submitAction()}
                            className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <StoryActions
                        status={story.status}
                        onApprove={() => setAction({ storyId: story.id, kind: 'approve', value: '' })}
                        onStart={() => void simpleTransition(story, 'start')}
                        onComplete={() => setAction({ storyId: story.id, kind: 'complete', value: '' })}
                        onBlock={() => setAction({ storyId: story.id, kind: 'block', value: '' })}
                        onReopen={() => void simpleTransition(story, 'reopen')}
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StoryActions({
  status,
  onApprove,
  onStart,
  onComplete,
  onBlock,
  onReopen,
}: {
  status: SpecStoryStatus;
  onApprove: () => void;
  onStart: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onReopen: () => void;
}) {
  const btn = 'rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface transition-colors';
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === 'draft' && (
        <>
          <button className={btn} onClick={onBlock}>Block</button>
          <button className={`${btn} !text-accent`} onClick={onApprove}>Approve</button>
        </>
      )}
      {status === 'approved' && (
        <>
          <button className={btn} onClick={onReopen}>Reopen</button>
          <button className={btn} onClick={onBlock}>Block</button>
          <button className={`${btn} !text-accent`} onClick={onStart}>Start</button>
        </>
      )}
      {status === 'in_progress' && (
        <>
          <button className={btn} onClick={onBlock}>Block</button>
          <button className={`${btn} !text-success`} onClick={onComplete}>Complete</button>
        </>
      )}
      {status === 'blocked' && (
        <button className={btn} onClick={onReopen}>Reopen</button>
      )}
      {status === 'done' && <span className="text-[10px] text-text-muted">done · terminal</span>}
    </div>
  );
}
