/**
 * ProjectSelector — Dropdown for switching between projects
 * Claude Cowork parity: persistent projects with scoped memory.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FolderKanban, Plus, Trash2, Folder, X, Package } from 'lucide-react';
import { useAppStore } from '../store';
import { useProjects, useActiveProject } from '../store/selectors';
import type { Project, ProjectCreateInput } from '../types';
import { ProjectTemplateGallery } from './ProjectTemplateGallery';

export const ProjectSelector: React.FC = () => {
  const { t } = useTranslation();
  const projects = useProjects();
  const active = useActiveProject();
  const setProjects = useAppStore((s) => s.setProjects);
  const addProject = useAppStore((s) => s.addProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);

  const [open, setOpen] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newWorkspacePath, setNewWorkspacePath] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<{ name: string; description: string } | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load projects on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.project) return;
    api.project.list().then((result) => {
      setProjects(result.projects);
    }).catch(() => {});
    api.project.getActive().then((project) => {
      if (project) setActiveProjectId(project.id);
    }).catch(() => {});
  }, [setProjects, setActiveProjectId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelectProject = useCallback(
    async (project: Project | null) => {
      const api = window.electronAPI;
      if (!api?.project) return;
      await api.project.setActive(project?.id ?? null);
      setActiveProjectId(project?.id ?? null);
      setOpen(false);
    },
    [setActiveProjectId]
  );

  const handleCreateProject = useCallback(async () => {
    if (!newName.trim()) return;
    const api = window.electronAPI;
    if (!api?.project) return;

    const input: ProjectCreateInput = {
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      workspacePath: newWorkspacePath.trim() || undefined,
    };

    const project = await api.project.create(input);
    addProject(project);
    await api.project.setActive(project.id);
    setActiveProjectId(project.id);

    // Phase 2 step 12: apply the selected template (if any) to the new workspace.
    if (selectedTemplate && project.workspacePath && api.template?.create) {
      setApplyingTemplate(true);
      try {
        await api.template.create(selectedTemplate.name, project.workspacePath);
      } catch (err) {
        console.error('[ProjectSelector] template create failed:', err);
      } finally {
        setApplyingTemplate(false);
      }
    }

    setNewName('');
    setNewDescription('');
    setNewWorkspacePath('');
    setSelectedTemplate(null);
    setShowNewDialog(false);
    setOpen(false);
  }, [newName, newDescription, newWorkspacePath, selectedTemplate, addProject, setActiveProjectId]);

  const handleDeleteProject = useCallback(
    async (project: Project, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm(t('project.deleteConfirm', { name: project.name }))) return;
      const api = window.electronAPI;
      if (!api?.project) return;
      await api.project.delete(project.id);
      removeProject(project.id);
    },
    [removeProject, t]
  );

  const handleBrowse = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const paths = await api.selectFiles?.();
    if (paths && paths.length > 0) {
      setNewWorkspacePath(paths[0]);
    }
  }, []);

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary bg-background/60 hover:bg-surface-hover border border-border-subtle transition-colors w-full"
          title={active ? t('project.projectLabel', { name: active.name }) : t('project.noActiveProject')}
          data-testid="project-selector-button"
        >
          <FolderKanban size={14} className="text-accent shrink-0" />
          <span className="flex-1 text-left truncate text-text-primary">
            {active ? active.name : t('project.allSessions')}
          </span>
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-surface border border-border rounded-lg shadow-elevated z-50 overflow-hidden max-h-96 overflow-y-auto">
            {/* All Sessions option */}
            <button
              onClick={() => handleSelectProject(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors border-b border-border-muted ${
                !active ? 'bg-surface-active' : ''
              }`}
            >
              <Folder size={14} className="text-text-muted" />
              <span className="text-xs text-text-secondary flex-1">{t('project.allSessions')}</span>
              {!active && <span className="text-xs text-success">✓</span>}
            </button>

            {/* Project list */}
            {projects.length === 0 && (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                {t('project.noProjects')}
              </div>
            )}

            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => handleSelectProject(project)}
                className={`group flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors cursor-pointer ${
                  active?.id === project.id ? 'bg-surface-active' : ''
                }`}
              >
                <FolderKanban size={14} className="text-accent shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary truncate">{project.name}</div>
                  {project.description && (
                    <div className="text-xs text-text-muted truncate">{project.description}</div>
                  )}
                  {project.workspacePath && (
                    <div className="text-[10px] text-text-muted truncate font-mono">
                      {project.workspacePath}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => handleDeleteProject(project, e)}
                  aria-label={t('project.deleteNamed', {
                    name: project.name,
                    defaultValue: `Delete ${project.name}`,
                  })}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-error transition-opacity"
                  title={t('project.deleteTitle')}
                >
                  <Trash2 size={12} />
                </button>
                {active?.id === project.id && (
                  <span className="text-xs text-success mt-0.5">✓</span>
                )}
              </div>
            ))}

            {/* New project button */}
            <button
              onClick={() => {
                setShowNewDialog(true);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover border-t border-border-muted transition-colors text-accent"
            >
              <Plus size={14} />
              <span className="text-xs font-medium">{t('project.newProject')}</span>
            </button>
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-elevated w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <FolderKanban size={20} className="text-accent" />
                {t('project.newProject')}
              </h2>
              <button
                onClick={() => setShowNewDialog(false)}
                aria-label={t('project.closeNewProject', 'Close new Project dialog')}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {t('project.nameRequired')}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('project.namePlaceholder')}
                  autoFocus
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {t('project.description')}
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t('project.descriptionPlaceholder')}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {t('project.workspacePath')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newWorkspacePath}
                    onChange={(e) => setNewWorkspacePath(e.target.value)}
                    placeholder={t('project.workspacePathPlaceholder')}
                    className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={handleBrowse}
                    className="px-3 py-2 bg-surface border border-border rounded-lg text-xs text-text-secondary hover:bg-surface-hover"
                  >
                    {t('project.browse')}
                  </button>
                </div>
                <p className="text-xs text-text-muted mt-1">
                  {t('project.memoryFolderHint', { path: '.codebuddy/memory/' })}
                </p>
              </div>

              {/* Template chooser (Phase 2 step 12) */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {t('templates.optionalTemplate')}
                </label>
                {selectedTemplate ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-lg">
                    <Package size={14} className="text-accent" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-text-primary truncate">
                        {selectedTemplate.name}
                      </div>
                      <div className="text-[10px] text-text-muted truncate">
                        {selectedTemplate.description}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedTemplate(null)}
                      className="p-1 text-text-muted hover:text-error"
                      title={t('common.remove')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTemplateGallery(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface border border-border border-dashed rounded-lg text-xs text-text-muted hover:text-text-primary hover:border-accent transition-colors"
                  >
                    <Package size={14} />
                    {t('templates.browseTemplates')}
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowNewDialog(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newName.trim() || applyingTemplate}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {applyingTemplate ? t('templates.applying') : t('project.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template gallery overlay (Phase 2 step 12) */}
      {showTemplateGallery && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-background border border-border rounded-xl shadow-elevated w-[90vw] max-w-4xl h-[80vh] overflow-hidden">
            <ProjectTemplateGallery
              onSelect={(tpl) => {
                setSelectedTemplate({ name: tpl.name, description: tpl.description });
                setShowTemplateGallery(false);
              }}
              onCancel={() => setShowTemplateGallery(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};
