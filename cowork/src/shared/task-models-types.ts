export type TaskModelType = 'architect' | 'edit' | 'review' | 'research' | 'chat';

export interface TaskModelDefinitionView {
  type: TaskModelType;
  label: string;
  description: string;
}

export interface ActiveTaskModelView {
  id: string;
  key: string;
  provider: string;
  label: string;
}

export type TaskModelMappingsView = Partial<Record<TaskModelType, string>>;
export type TaskModelSaveMappings = Partial<Record<TaskModelType, string | null>>;

export interface TaskModelSettingsView {
  configPath: string;
  defaultModel: string;
  taskTypes: TaskModelDefinitionView[];
  mappings: TaskModelMappingsView;
  legacyMappings: TaskModelMappingsView;
  effectiveMappings: TaskModelMappingsView;
  models: ActiveTaskModelView[];
}

export interface TaskModelSettingsResult {
  ok: boolean;
  error?: string;
  settings: TaskModelSettingsView | null;
}
