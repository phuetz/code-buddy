/**
 * Renderer-side application of slash-command results.
 *
 * The SlashCommandBridge (main process) decides *what* a slash command does —
 * render engine output, forward a prompt to the LLM, or apply a presentation-only
 * `ui_effect`. This module applies that decision inside the Cowork renderer. It
 * deliberately does NOT re-implement command behaviour: the engine behaviour
 * already ran headlessly in the main process, and we only render / forward /
 * apply the small set of presentation effects here.
 *
 * @module renderer/commands/slash-command-actions
 */

import { useAppStore } from '../store';
import type { Message, TextContent } from '../types';

/** Mirror of the SlashCommandBridge execute result (see preload `command.execute`). */
export interface SlashExecuteResult {
  success: boolean;
  prompt?: string;
  message?: string;
  output?: string;
  error?: string;
  handled?: boolean;
  action?: {
    type: 'open_schedule' | 'create_schedule' | 'ui_effect';
    uiEffect?: 'open_model_picker' | 'run_orchestrator' | 'open_orchestrator_launcher' | 'open_fleet' | 'set_plan_mode' | 'open_lessons' | 'open_team' | 'open_companion' | 'open_spec' | 'open_settings' | 'open_panel' | 'engine_action';
    args?: string[];
  };
}

/** Mirror of OrchestratorBridge.run()'s result (see main `orchestrator.run`). */
export interface OrchestratorRunResult {
  success: boolean;
  summary?: string;
  agentResults?: Array<{ role: string; success: boolean; output?: string }>;
}

export interface SlashActionContext {
  /** Command name without the leading slash (for notice prefixes). */
  commandName: string;
  /** Active session id, required to render engine output as a chat message. */
  activeSessionId: string | null;
  /** Forwards a resolved prompt to the LLM (ChatView's continueSession closure). */
  continueWithPrompt: (prompt: string) => void | Promise<void>;
}

function notice(type: 'info' | 'success' | 'error', message: string): void {
  useAppStore.getState().setGlobalNotice({ id: `slash-${type}-${Date.now()}`, type, message });
}

/** Render engine command output as a local assistant message in the active session. */
function renderOutput(sessionId: string, output: string): void {
  const message: Message = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: output } as TextContent],
    timestamp: Date.now(),
  };
  useAppStore.getState().addMessage(sessionId, message);
}

/**
 * Launch a multi-agent run via Cowork's NATIVE orchestrator bridge. This is the
 * path whose `subagent.*` events the always-mounted SubAgentPanel observes, so
 * the agents appear live in the chat. (The headless CLI `handleSwarm` would
 * spawn into a separate, terminal-only MultiAgentSystem the panel never sees.)
 */
function runOrchestrator(goal: string, ctx: SlashActionContext): void {
  if (!ctx.activeSessionId) {
    notice('error', 'Aucune session active pour lancer un swarm.');
    return;
  }
  if (!goal) {
    useAppStore.getState().setShowOrchestratorLauncher(true);
    return;
  }
  const maxRounds = useAppStore.getState().lastOrchestratorOptions?.maxRounds ?? 3;
  const sessionId = ctx.activeSessionId;
  // `/swarm` and `/parallel` both imply the parallel strategy (matches the CLI).
  void window.electronAPI?.orchestrator
    ?.run(sessionId, goal, { strategy: 'parallel', maxRounds })
    .then((raw: unknown) => {
      // Surface the synthesized result in the chat — without this the swarm
      // ran to completion but left no trace beyond the live sub-agent panel.
      const result = raw as OrchestratorRunResult | undefined;
      if (!result) return;
      const lines: string[] = [
        result.success ? '✅ **Swarm complete**' : '⚠️ **Swarm finished with issues**',
      ];
      if (result.summary?.trim()) lines.push('', result.summary.trim());
      if (result.agentResults?.length) {
        lines.push('', '**Agents:**');
        for (const r of result.agentResults) {
          lines.push(`- ${r.role}: ${r.success ? '✓' : '✗'}`);
        }
      }
      renderOutput(sessionId, lines.join('\n'));
    })
    .catch((err: unknown) => {
      notice('error', `Swarm échoué : ${err instanceof Error ? err.message : String(err)}`);
    });
  notice('success', `Swarm lancé (parallel) : ${goal}`);
}

function applyUiEffect(result: SlashExecuteResult, ctx: SlashActionContext): void {
  const action = result.action;
  if (!action || action.type !== 'ui_effect') return;

  switch (action.uiEffect) {
    case 'open_model_picker': {
      const target = action.args?.[0];
      if (target) {
        void window.electronAPI?.model?.switch(target);
        const cfg = useAppStore.getState().appConfig;
        if (cfg) useAppStore.getState().setAppConfig({ ...cfg, model: target });
        notice('success', `Modèle : ${target}`);
      } else {
        notice('info', 'Choisis un modèle via le sélecteur en haut, ou utilise /model <nom>.');
      }
      break;
    }
    case 'run_orchestrator':
      runOrchestrator((action.args ?? []).join(' ').trim(), ctx);
      break;
    case 'open_orchestrator_launcher':
      useAppStore.getState().setShowOrchestratorLauncher(true);
      break;
    case 'open_fleet':
      useAppStore.getState().setShowFleetCommandCenter(true);
      break;
    case 'set_plan_mode':
      void window.electronAPI?.permission?.setMode('plan');
      useAppStore.getState().setPermissionMode('plan');
      notice('success', 'Mode plan activé (lecture seule).');
      break;
    case 'open_lessons':
      useAppStore.getState().setShowLessonCandidatePanel(true);
      break;
    case 'open_team':
      useAppStore.getState().setShowTeamPanel(true);
      break;
    case 'open_companion':
      useAppStore.getState().setShowCompanionPanel(true);
      break;
    case 'open_spec':
      useAppStore.getState().setShowSpecPanel(true);
      break;
    case 'open_settings': {
      const tab = action.args?.[0];
      if (tab) useAppStore.getState().setSettingsTab(tab);
      useAppStore.getState().setShowSettings(true);
      break;
    }
    case 'open_panel': {
      const key = action.args?.[0];
      // `export` needs the active session id, so it is dispatched here (where ctx
      // is available) rather than through the arg-less PANEL_OPENERS map. The
      // Sidebar listens for `cowork:open-export` and opens its ExportDialog.
      if (key === 'export') {
        if (ctx.activeSessionId) {
          window.dispatchEvent(
            new CustomEvent('cowork:open-export', { detail: { sessionId: ctx.activeSessionId } }),
          );
        } else {
          notice('info', 'Ouvre une session pour l’exporter.');
        }
        break;
      }
      const setter = key ? PANEL_OPENERS[key] : undefined;
      if (setter) setter(true);
      break;
    }
    case 'engine_action': {
      const op = action.args?.[0];
      const fn = op ? ENGINE_ACTIONS[op] : undefined;
      if (fn) {
        void fn();
        notice('success', `Action: ${op}`);
      }
      break;
    }
  }
}

/** Real side-effecting engine ops triggered from the slash palette via IPC. */
const ENGINE_ACTIONS: Record<string, () => void> = {
  undo: () => void window.electronAPI?.checkpoint?.undo(),
  redo: () => void window.electronAPI?.checkpoint?.redo(),
};

/**
 * Generic panel openers keyed by panel id (lets the bridge route many slash
 * commands through a single `open_panel` ui_effect). Each maps to a confirmed
 * store show-flag setter.
 */
const PANEL_OPENERS: Record<string, (show: boolean) => void> = {
  global_search: (s) => useAppStore.getState().setShowGlobalSearch(s),
  shortcuts: (s) => useAppStore.getState().setShowShortcutsDialog(s),
  persona: (s) => useAppStore.getState().setShowPersonaSwitcher(s),
  session_insights: (s) => useAppStore.getState().setShowSessionInsights(s),
  memory: (s) => useAppStore.getState().setShowMemoryEditor(s),
  identity: (s) => useAppStore.getState().setShowIdentityPanel(s),
  device: (s) => useAppStore.getState().setShowDevicePanel(s),
  reasoning: (s) => useAppStore.getState().setShowReasoningViewer(s),
  test_runner: (s) => useAppStore.getState().setShowTestRunner(s),
  // Voice overlay is owned by Titlebar-local state; it exposes the intended
  // `cowork:open-voice-chat` DOM event as its external open hook.
  voice: (s) => {
    if (s) window.dispatchEvent(new Event('cowork:open-voice-chat'));
  },
  // The lessons-vault graph (knowledge graph) renders inside the Fleet Command
  // Center, so open both. Both flags are store-backed.
  knowledge_graph: (s) => {
    useAppStore.getState().setShowFleetCommandCenter(s);
    useAppStore.getState().setShowLessonsGraph(s);
  },
};

/**
 * Apply a non-schedule slash-command result. Schedule actions
 * (`open_schedule` / `create_schedule`) are handled by ChatView directly,
 * because they depend on ChatView-local state.
 *
 * @returns true when the result was fully applied here (caller should clear the
 * input and stop), false when there was nothing to do (caller falls through).
 */
export function applySlashCommandResult(result: SlashExecuteResult, ctx: SlashActionContext): boolean {
  // 1. Presentation-only effect (model switch, orchestrator launch, panels).
  if (result.action?.type === 'ui_effect') {
    applyUiEffect(result, ctx);
    return true;
  }

  // 2. Prompt-forwarding commands may also return a status/output line
  // (notably /goal). Render that line first, then send the prompt onward.
  if (result.success && result.prompt) {
    if (result.output && ctx.activeSessionId) {
      renderOutput(ctx.activeSessionId, result.output);
    }
    void ctx.continueWithPrompt(result.prompt);
    return true;
  }

  // 3. Engine output → render as an assistant chat message.
  if (result.output && ctx.activeSessionId) {
    renderOutput(ctx.activeSessionId, result.output);
    return true;
  }

  // 4. Handled with only a toast (info / denied / "not yet pilotable").
  if (result.handled) {
    if (result.message) {
      notice('info', ctx.commandName ? `/${ctx.commandName}: ${result.message}` : result.message);
    }
    return true;
  }

  // 5. Error.
  if (result.error) {
    notice('error', result.error);
    return true;
  }

  return false;
}
