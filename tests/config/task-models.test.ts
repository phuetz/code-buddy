import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getEffectiveTaskModels,
  legacyModelPairsToTaskModels,
  readTaskModelSettings,
  replaceTaskModelsSection,
  saveTaskModelSettings,
} from '../../src/config/task-models.js';

const temporaryDirectories: string[] = [];

function temporaryConfig(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'codebuddy-task-models-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'config.toml');
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('task model compatibility and persistence', () => {
  it('keeps legacy pairs dormant unless compatibility routing is explicitly enabled', () => {
    expect(legacyModelPairsToTaskModels({
      architect: 'legacy-thinker',
      editor: 'legacy-editor',
    })).toEqual({
      architect: 'legacy-thinker',
      edit: 'legacy-editor',
    });

    const config = {
      model_pairs: { architect: 'legacy-thinker', editor: 'legacy-editor' },
      task_models: { architect: 'new-thinker', review: 'reviewer' },
    };

    expect(getEffectiveTaskModels(config)).toEqual({
      architect: 'new-thinker',
      review: 'reviewer',
    });
    expect(getEffectiveTaskModels(config, { includeLegacyModelPairs: true })).toEqual({
      architect: 'new-thinker',
      edit: 'legacy-editor',
      review: 'reviewer',
    });
  });

  it('replaces only the task_models TOML section', () => {
    const original = [
      'active_model = "fast"',
      '',
      '[model_pairs]',
      'architect = "legacy-thinker"',
      'editor = "legacy-editor"',
      '',
      '[task_models]',
      'review = "old-reviewer"',
      '',
      '[profiles.keep-me]',
      'active_model = "profile-model"',
      '',
    ].join('\n');

    const updated = replaceTaskModelsSection(original, {
      review: 'new-reviewer',
      research: 'research-model',
    });

    expect(updated).toContain('[model_pairs]\narchitect = "legacy-thinker"');
    expect(updated).toContain('[profiles.keep-me]\nactive_model = "profile-model"');
    expect(updated).toContain('[task_models]\nreview = "new-reviewer"\nresearch = "research-model"');
    expect(updated.match(/\[task_models\]/g)).toHaveLength(1);
    expect(updated).not.toContain('old-reviewer');
  });

  it('saves active model IDs atomically while retaining legacy sections', () => {
    const path = temporaryConfig([
      'active_model = "local-fast"',
      '',
      '[providers.local]',
      'api_key_env = "LOCAL_KEY"',
      'type = "custom"',
      'enabled = true',
      '',
      '[models.local-fast]',
      'provider = "local"',
      'model_id = "local/fast-v2"',
      'price_per_m_input = 0',
      'price_per_m_output = 0',
      'max_context_tokens = 100000',
      '',
      '[model_pairs]',
      'architect = "legacy-thinker"',
      'editor = "legacy-editor"',
      '',
      '[profiles.keep-me]',
      'active_model = "profile-model"',
      '',
    ].join('\n'));

    const saved = saveTaskModelSettings({
      review: 'local-fast',
      chat: null,
    }, path);

    expect(saved.mappings).toEqual({ review: 'local/fast-v2' });
    expect(saved.legacyMappings).toEqual({
      architect: 'legacy-thinker',
      edit: 'legacy-editor',
    });
    expect(saved.effectiveMappings).toEqual({ review: 'local/fast-v2' });
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toContain('review = "local/fast-v2"');
    expect(onDisk).toContain('[profiles.keep-me]');
    expect(onDisk).toContain('[model_pairs]');
  });

  it('rejects a Cowork selection whose provider is disabled', () => {
    const path = temporaryConfig([
      'active_model = "grok-code-fast"',
      '',
      '[providers.offline]',
      'api_key_env = "OFFLINE_KEY"',
      'type = "custom"',
      'enabled = false',
      '',
      '[models.offline-model]',
      'provider = "offline"',
      'model_id = "offline/model"',
      'price_per_m_input = 0',
      'price_per_m_output = 0',
      'max_context_tokens = 100000',
      '',
    ].join('\n'));

    expect(readTaskModelSettings(path).models.some((model) => model.id === 'offline/model')).toBe(false);
    expect(() => saveTaskModelSettings({ review: 'offline/model' }, path)).toThrow(
      'model is not active: offline/model',
    );
  });
});
