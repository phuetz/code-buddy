import { beforeEach, describe, expect, it, vi } from 'vitest';

const addMessage = vi.fn();
const setGlobalNotice = vi.fn();
const setAppConfig = vi.fn();
const setShowOrchestratorLauncher = vi.fn();
const setShowFleetCommandCenter = vi.fn();
const setShowLessonCandidatePanel = vi.fn();
const setShowTeamPanel = vi.fn();
const setShowCompanionPanel = vi.fn();
const setShowSpecPanel = vi.fn();
const setSettingsTab = vi.fn();
const setShowSettings = vi.fn();
const setShowGlobalSearch = vi.fn();
const setShowPersonaSwitcher = vi.fn();
const setPermissionMode = vi.fn();
const modelSwitch = vi.fn();
const permissionSetMode = vi.fn();
const orchestratorRun = vi.fn(() => Promise.resolve({}));

let storeState: Record<string, unknown>;

vi.mock('../src/renderer/store', () => ({
  useAppStore: { getState: () => storeState },
}));

import { applySlashCommandResult, type SlashActionContext } from '../src/renderer/commands/slash-command-actions';

beforeEach(() => {
  addMessage.mockReset();
  setGlobalNotice.mockReset();
  setAppConfig.mockReset();
  setShowOrchestratorLauncher.mockReset();
  setShowFleetCommandCenter.mockReset();
  setShowLessonCandidatePanel.mockReset();
  setShowTeamPanel.mockReset();
  setShowCompanionPanel.mockReset();
  setShowSpecPanel.mockReset();
  setSettingsTab.mockReset();
  setShowSettings.mockReset();
  setShowGlobalSearch.mockReset();
  setShowPersonaSwitcher.mockReset();
  setPermissionMode.mockReset();
  modelSwitch.mockReset();
  permissionSetMode.mockReset();
  orchestratorRun.mockClear();
  storeState = {
    addMessage,
    setGlobalNotice,
    setAppConfig,
    setShowOrchestratorLauncher,
    setShowFleetCommandCenter,
    setShowLessonCandidatePanel,
    setShowTeamPanel,
    setShowCompanionPanel,
    setShowSpecPanel,
    setSettingsTab,
    setShowSettings,
    setShowGlobalSearch,
    setShowPersonaSwitcher,
    setPermissionMode,
    appConfig: { model: 'old-model' },
    lastOrchestratorOptions: { strategy: 'hierarchical', maxRounds: 5 },
  };
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      model: { switch: modelSwitch },
      orchestrator: { run: orchestratorRun },
      permission: { setMode: permissionSetMode },
    },
  };
});

function ctx(over: Partial<SlashActionContext> = {}): SlashActionContext {
  return { commandName: 'x', activeSessionId: 's1', continueWithPrompt: vi.fn(), ...over };
}

describe('applySlashCommandResult (renderer dispatch)', () => {
  it('renders engine output as an assistant chat message (not a toast)', () => {
    const handled = applySlashCommandResult({ success: true, handled: true, output: 'hello' }, ctx());
    expect(handled).toBe(true);
    expect(addMessage).toHaveBeenCalledTimes(1);
    const [sid, msg] = addMessage.mock.calls[0];
    expect(sid).toBe('s1');
    expect(msg.role).toBe('assistant');
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(setGlobalNotice).not.toHaveBeenCalled();
  });

  it('applies open_model_picker with a target: switches model + updates config', () => {
    const handled = applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_model_picker', args: ['grok-4'] } },
      ctx()
    );
    expect(handled).toBe(true);
    expect(modelSwitch).toHaveBeenCalledWith('grok-4');
    expect(setAppConfig).toHaveBeenCalledWith({ model: 'grok-4' });
  });

  it('open_model_picker without a target shows a hint and does not switch', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_model_picker', args: [] } },
      ctx()
    );
    expect(modelSwitch).not.toHaveBeenCalled();
    expect(setGlobalNotice).toHaveBeenCalled();
  });

  it('shows a toast for a handled message (denied/info), no chat message', () => {
    applySlashCommandResult(
      { success: true, handled: true, message: 'pas encore pilotable' },
      ctx({ commandName: 'compact' })
    );
    expect(setGlobalNotice).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', message: expect.stringContaining('compact') })
    );
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('forwards a prompt via continueWithPrompt', () => {
    const continueWithPrompt = vi.fn();
    const handled = applySlashCommandResult(
      { success: true, handled: false, prompt: 'do X' },
      ctx({ continueWithPrompt })
    );
    expect(handled).toBe(true);
    expect(continueWithPrompt).toHaveBeenCalledWith('do X');
  });

  it('returns false when there is nothing to apply', () => {
    expect(applySlashCommandResult({ success: true }, ctx())).toBe(false);
  });

  // --- S1: multi-agent ui_effects ---

  it('run_orchestrator launches via the native orchestrator (parallel) with the goal', () => {
    const handled = applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'run_orchestrator', args: ['build', 'a', 'CLI'] } },
      ctx()
    );
    expect(handled).toBe(true);
    expect(orchestratorRun).toHaveBeenCalledWith('s1', 'build a CLI', { strategy: 'parallel', maxRounds: 5 });
    expect(setShowOrchestratorLauncher).not.toHaveBeenCalled();
  });

  it('run_orchestrator without a goal opens the launcher instead of running', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'run_orchestrator', args: [] } },
      ctx()
    );
    expect(orchestratorRun).not.toHaveBeenCalled();
    expect(setShowOrchestratorLauncher).toHaveBeenCalledWith(true);
  });

  it('run_orchestrator with no active session errors and does not run', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'run_orchestrator', args: ['x'] } },
      ctx({ activeSessionId: null })
    );
    expect(orchestratorRun).not.toHaveBeenCalled();
    expect(setGlobalNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('open_orchestrator_launcher opens the launcher modal', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_orchestrator_launcher', args: [] } },
      ctx()
    );
    expect(setShowOrchestratorLauncher).toHaveBeenCalledWith(true);
  });

  it('open_fleet opens the Fleet Command Center', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_fleet', args: [] } },
      ctx()
    );
    expect(setShowFleetCommandCenter).toHaveBeenCalledWith(true);
  });

  it('set_plan_mode enters read-only plan permission mode', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'set_plan_mode', args: [] } },
      ctx()
    );
    expect(permissionSetMode).toHaveBeenCalledWith('plan');
    expect(setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('open_lessons opens the lesson candidate panel', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_lessons', args: [] } },
      ctx()
    );
    expect(setShowLessonCandidatePanel).toHaveBeenCalledWith(true);
  });

  it('open_team opens the Team panel', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_team', args: [] } },
      ctx()
    );
    expect(setShowTeamPanel).toHaveBeenCalledWith(true);
  });

  it('open_companion opens the companion panel (C1)', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_companion', args: [] } },
      ctx()
    );
    expect(setShowCompanionPanel).toHaveBeenCalledWith(true);
  });

  it('open_spec opens the Spec panel (C1)', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_spec', args: [] } },
      ctx()
    );
    expect(setShowSpecPanel).toHaveBeenCalledWith(true);
  });

  it('open_settings opens the requested Settings tab (C2)', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_settings', args: ['workflows'] } },
      ctx()
    );
    expect(setSettingsTab).toHaveBeenCalledWith('workflows');
    expect(setShowSettings).toHaveBeenCalledWith(true);
  });

  it('open_panel opens the keyed panel (C-batch generic opener)', () => {
    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_panel', args: ['global_search'] } },
      ctx()
    );
    expect(setShowGlobalSearch).toHaveBeenCalledWith(true);

    applySlashCommandResult(
      { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_panel', args: ['persona'] } },
      ctx()
    );
    expect(setShowPersonaSwitcher).toHaveBeenCalledWith(true);
  });

  it('open_panel with an unknown key is a safe no-op', () => {
    expect(() =>
      applySlashCommandResult(
        { success: true, handled: true, action: { type: 'ui_effect', uiEffect: 'open_panel', args: ['nope'] } },
        ctx()
      )
    ).not.toThrow();
  });
});
