import { ipcMain } from 'electron';
import type { ProjectManager, ProjectCreateInput, ProjectUpdateInput } from '../project/project-manager';
import type { ProjectEvolutionService } from '../project/project-evolution';
import type { ActivityFeed } from '../activity/activity-feed';
import { sendToRenderer } from '../ipc-main-bridge';
import type {
  ProjectEvolutionCreateInput,
  ProjectEvolutionRejectInput,
} from '../../shared/project-evolution';

type ProjectManagerSource = ProjectManager | null | (() => ProjectManager | null);
type ActivityFeedSource = ActivityFeed | null | (() => ActivityFeed | null);
type ProjectEvolutionServiceSource =
  | ProjectEvolutionService
  | null
  | (() => ProjectEvolutionService | null);

function resolveProjectManager(source: ProjectManagerSource): ProjectManager | null {
  return typeof source === 'function' ? source() : source;
}

function resolveActivityFeed(source: ActivityFeedSource): ActivityFeed | null {
  return typeof source === 'function' ? source() : source;
}

function resolveProjectEvolutionService(
  source: ProjectEvolutionServiceSource
): ProjectEvolutionService | null {
  return typeof source === 'function' ? source() : source;
}

export function registerProjectIpcHandlers(
  projectManagerSource: ProjectManagerSource,
  activityFeedSource: ActivityFeedSource,
  projectEvolutionServiceSource: ProjectEvolutionServiceSource = null,
) {
  ipcMain.handle('project.list', async () => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return { projects: [] };
    return { projects: projectManager.list() };
  });

  ipcMain.handle('project.get', async (_event, id: string) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.get(id);
  });

  ipcMain.handle('project.create', async (_event, input: ProjectCreateInput) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) throw new Error('ProjectManager not initialized');
    const project = projectManager.create(input);
    sendToRenderer({ type: 'project.created', payload: { project } });
    const activityFeed = resolveActivityFeed(activityFeedSource);
    activityFeed?.record({
      type: 'project.created',
      title: `Project created: ${project.name}`,
      description: project.description,
      projectId: project.id,
    });
    return project;
  });

  ipcMain.handle('project.update', async (_event, id: string, updates: ProjectUpdateInput) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    const project = projectManager.update(id, updates);
    if (project) {
      sendToRenderer({ type: 'project.updated', payload: { project } });
    }
    return project;
  });

  ipcMain.handle('project.delete', async (_event, id: string) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return false;
    const ok = projectManager.delete(id);
    if (ok) {
      sendToRenderer({ type: 'project.deleted', payload: { projectId: id } });
      const activityFeed = resolveActivityFeed(activityFeedSource);
      activityFeed?.record({
        type: 'project.deleted',
        title: `Project deleted`,
        projectId: id,
      });
    }
    return ok;
  });

  ipcMain.handle('project.setActive', async (_event, id: string | null) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.setActive(id);
  });

  ipcMain.handle('project.getActive', async () => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.getActive();
  });

  ipcMain.handle('project.evolution.list', async (_event, projectId: string) => {
    const service = resolveProjectEvolutionService(projectEvolutionServiceSource);
    if (!service) return { proposals: [] };
    return { proposals: service.list(projectId) };
  });

  ipcMain.handle(
    'project.evolution.create',
    async (_event, input: ProjectEvolutionCreateInput) => {
      const service = resolveProjectEvolutionService(projectEvolutionServiceSource);
      if (!service) throw new Error('Project evolution service is not initialized');
      const proposal = service.create(input);
      resolveActivityFeed(activityFeedSource)?.record({
        type: 'gui.action',
        title: 'Project update proposed',
        projectId: proposal.projectId,
        sessionId: proposal.sourceSessionId,
        metadata: {
          proposalId: proposal.id,
          proposalType: proposal.type,
          sourceKind: proposal.sourceKind,
        },
      });
      return proposal;
    }
  );

  ipcMain.handle('project.evolution.approve', async (_event, proposalId: string) => {
    const service = resolveProjectEvolutionService(projectEvolutionServiceSource);
    if (!service) return { ok: false, proposal: null, error: 'Project evolution service is not initialized' };
    const result = service.approve(proposalId);
    if (result.ok && result.proposal) {
      const updatedProject = resolveProjectManager(projectManagerSource)?.get(result.proposal.projectId);
      if (updatedProject) {
        sendToRenderer({ type: 'project.updated', payload: { project: updatedProject } });
      }
      resolveActivityFeed(activityFeedSource)?.record({
        type: 'gui.action',
        title: 'Project update approved',
        projectId: result.proposal.projectId,
        metadata: {
          proposalId: result.proposal.id,
          proposalType: result.proposal.type,
          auditAction: 'approved',
        },
      });
    }
    return result;
  });

  ipcMain.handle(
    'project.evolution.reject',
    async (_event, input: ProjectEvolutionRejectInput) => {
      const service = resolveProjectEvolutionService(projectEvolutionServiceSource);
      if (!service) return { ok: false, proposal: null, error: 'Project evolution service is not initialized' };
      const result = service.reject(input);
      if (result.ok && result.proposal) {
        resolveActivityFeed(activityFeedSource)?.record({
          type: 'gui.action',
          title: 'Project update rejected',
          projectId: result.proposal.projectId,
          metadata: {
            proposalId: result.proposal.id,
            proposalType: result.proposal.type,
            auditAction: 'rejected',
          },
        });
      }
      return result;
    }
  );

  ipcMain.handle('project.evolution.rollback', async (_event, proposalId: string) => {
    const service = resolveProjectEvolutionService(projectEvolutionServiceSource);
    if (!service) return { ok: false, proposal: null, error: 'Project evolution service is not initialized' };
    const result = service.rollback(proposalId);
    if (result.ok && result.proposal) {
      const updatedProject = resolveProjectManager(projectManagerSource)?.get(result.proposal.projectId);
      if (updatedProject) {
        sendToRenderer({ type: 'project.updated', payload: { project: updatedProject } });
      }
      resolveActivityFeed(activityFeedSource)?.record({
        type: 'gui.action',
        title: 'Project update rolled back',
        projectId: result.proposal.projectId,
        metadata: {
          proposalId: result.proposal.id,
          proposalType: result.proposal.type,
          auditAction: 'rolled_back',
        },
      });
    }
    return result;
  });
}
