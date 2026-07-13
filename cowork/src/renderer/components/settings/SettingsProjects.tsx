import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText, CheckCircle, Files, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store';
import type { Project } from '../../types';
import { SettingsContentSection } from './shared';
import { ProjectEvolutionPanel } from './ProjectEvolutionPanel';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

function toWorkspaceRelativePath(filePath: string, workspacePath: string): string | null {
  const file = filePath.replaceAll('\\', '/');
  const root = workspacePath.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!root) return null;
  const caseInsensitive = /^[a-z]:\//i.test(root);
  const comparableFile = caseInsensitive ? file.toLowerCase() : file;
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null;
  return file.slice(root.length + 1);
}

export function SettingsProjects() {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const setProjects = useAppStore((state) => state.setProjects);
  const addProject = useAppStore((state) => state.addProject);
  const updateProject = useAppStore((state) => state.updateProject);
  const removeProject = useAppStore((state) => state.removeProject);
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftWorkspacePath, setDraftWorkspacePath] = useState('');
  const [draftMasterInstruction, setDraftMasterInstruction] = useState('');
  const [draftKnowledgeFiles, setDraftKnowledgeFiles] = useState('');
  const [draftKnowledgeBudget, setDraftKnowledgeBudget] = useState('16000');
  const [draftAutoConsolidate, setDraftAutoConsolidate] = useState(true);
  const [draftIncludeIcm, setDraftIncludeIcm] = useState(false);
  const [draftMaxEntries, setDraftMaxEntries] = useState('100');
  const [draftMemoryStrategy, setDraftMemoryStrategy] = useState<'auto' | 'manual' | 'rolling'>(
    'auto'
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects]
  );

  const resetDraft = useCallback(() => {
    setDraftName('');
    setDraftDescription('');
    setDraftWorkspacePath(workingDir || '');
    setDraftMasterInstruction('');
    setDraftKnowledgeFiles('');
    setDraftKnowledgeBudget('16000');
    setDraftAutoConsolidate(true);
    setDraftIncludeIcm(false);
    setDraftMaxEntries('100');
    setDraftMemoryStrategy('auto');
    setEditingId(null);
  }, [workingDir]);

  const loadProjects = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const [listResult, activeResult] = await Promise.all([
        window.electronAPI.project.list(),
        window.electronAPI.project.getActive(),
      ]);
      setProjects(listResult.projects || []);
      setActiveProjectId(activeResult?.id || null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('projects.loadFailed', 'Failed to load projects'));
    } finally {
      setLoading(false);
    }
  }, [setActiveProjectId, setProjects, t]);

  useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  useEffect(() => {
    if (!isElectron) return;
    void loadProjects();
  }, [loadProjects]);

  const beginEdit = useCallback((project: Project) => {
    setEditingId(project.id);
    setDraftName(project.name);
    setDraftDescription(project.description || '');
    setDraftWorkspacePath(project.workspacePath || '');
    setDraftMasterInstruction(project.contextConfig?.masterInstruction || '');
    setDraftKnowledgeFiles((project.contextConfig?.knowledgeFiles || []).join('\n'));
    setDraftKnowledgeBudget(String(project.contextConfig?.maxKnowledgeChars ?? 16000));
    setDraftAutoConsolidate(project.memoryConfig?.autoConsolidate ?? true);
    setDraftIncludeIcm(project.memoryConfig?.includeICM ?? false);
    setDraftMaxEntries(String(project.memoryConfig?.maxMemoryEntries ?? 100));
    setDraftMemoryStrategy(project.memoryConfig?.memoryStrategy ?? 'auto');
  }, []);

  const pickKnowledgeFiles = useCallback(async () => {
    if (!isElectron) return;
    if (!draftWorkspacePath.trim()) {
      setNotice(t('projects.workspaceRequiredForKnowledge', 'Choose the Project workspace first.'));
      return;
    }
    const selected = await window.electronAPI.selectFiles?.();
    if (!selected?.length) return;
    const relativePaths = selected
      .map((path) => toWorkspaceRelativePath(path, draftWorkspacePath.trim()))
      .filter((path): path is string => Boolean(path));
    if (relativePaths.length !== selected.length) {
      setNotice(t(
        'projects.knowledgeOutsideWorkspace',
        'Files outside the Project workspace were ignored.'
      ));
    }
    if (relativePaths.length === 0) return;
    setDraftKnowledgeFiles((current) => {
      const paths = current
        .split(/\r?\n|,/)
        .map((value) => value.trim())
        .filter(Boolean);
      return Array.from(new Set([...paths, ...relativePaths])).join('\n');
    });
  }, [draftWorkspacePath, t]);

  const handleSubmit = useCallback(async () => {
    if (!isElectron || !draftName.trim()) {
      setNotice(t('projects.nameRequired', 'Project name is required.'));
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      const payload = {
        name: draftName.trim(),
        description: editingId ? draftDescription.trim() : draftDescription.trim() || undefined,
        workspacePath: editingId ? draftWorkspacePath.trim() : draftWorkspacePath.trim() || undefined,
        memoryConfig: {
          autoConsolidate: draftAutoConsolidate,
          includeICM: draftIncludeIcm,
          maxMemoryEntries: Number(draftMaxEntries) || 100,
          memoryStrategy: draftMemoryStrategy,
        },
        contextConfig: {
          masterInstruction: draftMasterInstruction.trim() || undefined,
          knowledgeFiles: draftKnowledgeFiles
            .split(/\r?\n|,/)
            .map((value) => value.trim())
            .filter(Boolean),
          maxKnowledgeChars: Number(draftKnowledgeBudget) || 16000,
        },
      };

      if (editingId) {
        const updated = await window.electronAPI.project.update(editingId, payload);
        if (updated) {
          updateProject(editingId, updated);
          setNotice(t('projects.updated', 'Project updated'));
        }
      } else {
        const created = await window.electronAPI.project.create(payload);
        addProject(created);
        setNotice(t('projects.created', 'Project created'));
      }
      resetDraft();
      await loadProjects();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('projects.saveFailed', 'Failed to save project'));
    } finally {
      setLoading(false);
    }
  }, [
    addProject,
    draftAutoConsolidate,
    draftDescription,
    draftIncludeIcm,
    draftMemoryStrategy,
    draftMasterInstruction,
    draftKnowledgeBudget,
    draftKnowledgeFiles,
    draftMaxEntries,
    draftName,
    draftWorkspacePath,
    editingId,
    loadProjects,
    resetDraft,
    t,
    updateProject,
  ]);

  const handleDelete = useCallback(
    async (project: Project) => {
      if (!isElectron || !window.confirm(t('projects.deleteConfirm', { name: project.name }))) {
        return;
      }
      setLoading(true);
      setNotice('');
      try {
        const ok = await window.electronAPI.project.delete(project.id);
        if (ok) {
          removeProject(project.id);
          if (activeProjectId === project.id) {
            setActiveProjectId(null);
          }
          setNotice(t('projects.deleted', 'Project deleted'));
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('projects.deleteFailed', 'Failed to delete project'));
      } finally {
        setLoading(false);
      }
    },
    [activeProjectId, removeProject, setActiveProjectId, t]
  );

  const handleSetActive = useCallback(
    async (projectId: string | null) => {
      if (!isElectron) return;
      setLoading(true);
      setNotice('');
      try {
        const next = await window.electronAPI.project.setActive(projectId);
        setActiveProjectId(next?.id || null);
        setNotice(
          next
            ? t('projects.activeSet', { name: next.name })
            : t('projects.activeCleared', 'Project context cleared')
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('projects.activateFailed', 'Failed to switch project'));
      } finally {
        setLoading(false);
      }
    },
    [setActiveProjectId, t]
  );

  return (
    <div className="space-y-5">
      <SettingsContentSection
        title={t('projects.title', 'Projects')}
        description={t(
          'projects.hint',
          'Group sessions by workspace, keep a scoped memory folder, and switch the active project context.'
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label={t('projects.namePlaceholder', 'Project name')}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={t('projects.namePlaceholder', 'Project name')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <input
            aria-label={t('projects.workspacePlaceholder', 'Workspace path')}
            value={draftWorkspacePath}
            onChange={(event) => setDraftWorkspacePath(event.target.value)}
            placeholder={t('projects.workspacePlaceholder', 'Workspace path')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <textarea
            aria-label={t('projects.descriptionPlaceholder', 'Description')}
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder={t('projects.descriptionPlaceholder', 'Description')}
            rows={3}
            className="md:col-span-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <div className="md:col-span-2 rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t('projects.sharedContext', 'Shared Project context')}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {t(
                    'projects.sharedContextHint',
                    'Every session in this Project inherits these instructions and explicitly selected reference files. This is local, reviewable, and never uploads files by itself.'
                  )}
                </p>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-secondary">
                {t('projects.masterInstruction', 'Master instruction')}
              </span>
              <textarea
                value={draftMasterInstruction}
                onChange={(event) => setDraftMasterInstruction(event.target.value)}
                placeholder={t(
                  'projects.masterInstructionPlaceholder',
                  'Example: Write in French, preserve cited evidence, and end every research task with next actions.'
                )}
                rows={5}
                data-testid="project-master-instruction"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <div className="block space-y-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  {t('projects.knowledgeFiles', 'Knowledge files (one workspace-relative path per line)')}
                </span>
                <textarea
                  aria-label={t('projects.knowledgeFiles', 'Knowledge files (one workspace-relative path per line)')}
                  value={draftKnowledgeFiles}
                  onChange={(event) => setDraftKnowledgeFiles(event.target.value)}
                  placeholder={'docs/brand.md\nresearch/decisions.md'}
                  rows={3}
                  data-testid="project-knowledge-files"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-primary"
                />
                <button
                  type="button"
                  onClick={() => void pickKnowledgeFiles()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-accent/10 hover:text-text-primary"
                >
                  <Files className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('projects.chooseKnowledgeFiles', 'Choose files')}
                </button>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  {t('projects.knowledgeBudget', 'Context budget')}
                </span>
                <input
                  type="number"
                  min={4000}
                  max={64000}
                  value={draftKnowledgeBudget}
                  onChange={(event) => setDraftKnowledgeBudget(event.target.value)}
                  inputMode="numeric"
                  data-testid="project-knowledge-budget"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
                />
                <span className="block text-[11px] leading-4 text-text-muted">
                  {t('projects.knowledgeBudgetHint', '4,000–64,000 characters')}
                </span>
              </label>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={draftAutoConsolidate}
              onChange={(event) => setDraftAutoConsolidate(event.target.checked)}
            />
            {t('projects.autoConsolidate', 'Auto-consolidate project memory')}
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={draftIncludeIcm}
              onChange={(event) => setDraftIncludeIcm(event.target.checked)}
            />
            {t('projects.includeIcm', 'Include ICM in project memory')}
          </label>
          <input
            type="number"
            min={1}
            max={10000}
            inputMode="numeric"
            aria-label={t('projects.maxEntries', 'Max memory entries')}
            value={draftMaxEntries}
            onChange={(event) => setDraftMaxEntries(event.target.value)}
            placeholder={t('projects.maxEntries', 'Max memory entries')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="shrink-0">{t('projects.memoryStrategy', 'Memory strategy')}</span>
            <select
              value={draftMemoryStrategy}
              onChange={(event) =>
                setDraftMemoryStrategy(event.target.value as 'auto' | 'manual' | 'rolling')
              }
              className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
            >
              <option value="auto">{t('projects.memoryStrategyAuto', 'Auto')}</option>
              <option value="manual">{t('projects.memoryStrategyManual', 'Manual')}</option>
              <option value="rolling">{t('projects.memoryStrategyRolling', 'Rolling')}</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {editingId ? t('projects.saveChanges', 'Save changes') : t('projects.create', 'Create project')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetDraft}
                className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary"
              >
                {t('projects.cancelEdit', 'Cancel')}
              </button>
            )}
          </div>
        </div>
        {notice && <div role="status" aria-live="polite" className="text-xs text-text-muted">{notice}</div>}
      </SettingsContentSection>

      <SettingsContentSection
        title={t('projects.listTitle', 'Project list')}
        description={t(
          'projects.listHint',
          'Switch the active project or edit an existing workspace profile.'
        )}
      >
        {loading && <div role="status" aria-live="polite" className="text-xs text-text-muted">{t('common.loading')}</div>}
        {!loading && projects.length === 0 && (
          <div className="text-xs text-text-muted">{t('projects.empty', 'No projects yet')}</div>
        )}
        <div className="space-y-3">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`rounded-xl border px-4 py-4 ${
                  isActive ? 'border-accent bg-accent/5' : 'border-border-muted bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-text-primary">{project.name}</div>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" />
                          {t('projects.active', 'Active')}
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <div className="mt-1 text-xs leading-5 text-text-muted">{project.description}</div>
                    )}
                    {project.workspacePath && (
                      <div className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-text-secondary">
                        <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="break-all">{project.workspacePath}</span>
                      </div>
                    )}
                    {(project.contextConfig?.masterInstruction ||
                      (project.contextConfig?.knowledgeFiles?.length ?? 0) > 0) && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-accent">
                        {project.contextConfig?.masterInstruction && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1">
                            <BookOpenText className="h-3 w-3" aria-hidden="true" />
                            {t('projects.instructionsActive', 'Instructions active')}
                          </span>
                        )}
                        {(project.contextConfig?.knowledgeFiles?.length ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1">
                            <Files className="h-3 w-3" aria-hidden="true" />
                            {t('projects.knowledgeFileCount', {
                              count: project.contextConfig?.knowledgeFiles?.length ?? 0,
                              defaultValue: '{{count}} reference file(s)',
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSetActive(isActive ? null : project.id)}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
                    >
                      {isActive ? t('projects.clearActive', 'Clear active') : t('projects.setActive', 'Set active')}
                    </button>
                    <button
                      type="button"
                      onClick={() => beginEdit(project)}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(project)}
                      aria-label={t('projects.deleteProject', {
                        name: project.name,
                        defaultValue: `Delete ${project.name}`,
                      })}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {activeProject && (
          <>
            <div className="text-xs text-text-muted">
              {t('projects.current', { name: activeProject.name })}
            </div>
            <ProjectEvolutionPanel
              project={activeProject}
              activeSessionId={activeSessionId}
            />
          </>
        )}
      </SettingsContentSection>
    </div>
  );
}
