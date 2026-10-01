import { getSettingsManager } from '../utils/settings-manager.js';
import { loadDoctorLocalModelPolicy } from './local-model-policy.js';
import { persistDoctorLocalContextCap } from './local-context-cap.js';

/** Shared by doctor and try: save the endpoint/model actually used, before the next CLI run. */
export function persistLocalProviderSelection(baseURL: string, model: string, maxContext = loadDoctorLocalModelPolicy().maxContext): void {
  persistDoctorLocalContextCap(model, maxContext);
  getSettingsManager().saveUserSettings({ provider: 'ollama', baseURL, model, defaultModel: model });
}
