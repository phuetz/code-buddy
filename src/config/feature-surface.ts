import type { CodeBuddyTool } from '../codebuddy/client.js';
import { getConfigManager, type AdvancedCapability, type FeatureSurfaceConfig } from './toml-config.js';

type EnvLike = Record<string, string | undefined>;

const TOOL_CAPABILITIES: Readonly<Record<string, AdvancedCapability>> = {
  lisa_selfie: 'companion',
  relationship_context: 'companion',

  gpu_media_job: 'film',
  video_generate: 'film',
  video_stitch: 'film',

  audio: 'sensory',
  camera_analyze: 'sensory',
  camera_snapshot: 'sensory',
  screen_memory: 'sensory',
  text_to_speech: 'sensory',

  computer_control: 'robot',
  device_manage: 'robot',
  object_detect: 'robot',
  self_describe: 'robot',
  vision_analyze: 'robot',
};

const COMMAND_CAPABILITIES: Readonly<Record<string, AdvancedCapability>> = {
  assistant: 'companion',
  companion: 'companion',
  remind: 'companion',

  film: 'film',

  rules: 'sensory',
  screen: 'sensory',
  speak: 'sensory',
  tts: 'sensory',
  voice: 'sensory',

  device: 'robot',
  nodes: 'robot',

  'vision-train': 'vision_train',
};

const CAPABILITY_ENV_PREFIXES: Readonly<Record<AdvancedCapability, readonly string[]>> = {
  companion: ['CODEBUDDY_COMPANION'],
  film: ['CODEBUDDY_FILM', 'CODEBUDDY_VIDEO_'],
  sensory: ['CODEBUDDY_SENSORY'],
  robot: ['CODEBUDDY_ROBOT'],
  vision_train: ['CODEBUDDY_VISION_TRAIN'],
};

function hasMeaningfulValue(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && !['0', 'false', 'no', 'off', 'disabled'].includes(normalized);
}

/** True when an existing feature-specific environment variable opts the area back in. */
export function isCapabilityEnabledByEnv(
  capability: AdvancedCapability,
  env: EnvLike = process.env,
): boolean {
  return Object.entries(env).some(([key, value]) =>
    CAPABILITY_ENV_PREFIXES[capability].some((prefix) => key === prefix || key.startsWith(prefix))
      && hasMeaningfulValue(value),
  );
}

function activeSurface(): FeatureSurfaceConfig {
  return getConfigManager().getConfig().surface;
}

export function getEffectiveHiddenCapabilities(
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): Set<AdvancedCapability> {
  return new Set(
    (surface.hidden_capabilities ?? []).filter(
      (capability) => !isCapabilityEnabledByEnv(capability, env),
    ),
  );
}

export function isToolVisibleForSurface(
  toolName: string,
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): boolean {
  const capability = TOOL_CAPABILITIES[toolName];
  return capability === undefined || !getEffectiveHiddenCapabilities(surface, env).has(capability);
}

export function filterToolsForSurface(
  tools: CodeBuddyTool[],
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): CodeBuddyTool[] {
  const hidden = getEffectiveHiddenCapabilities(surface, env);
  if (hidden.size === 0) return tools;
  return tools.filter((tool) => {
    const capability = TOOL_CAPABILITIES[tool.function.name];
    return capability === undefined || !hidden.has(capability);
  });
}

export function filterToolNamesForSurface(
  toolNames: string[],
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): string[] {
  const hidden = getEffectiveHiddenCapabilities(surface, env);
  if (hidden.size === 0) return toolNames;
  return toolNames.filter((toolName) => {
    const capability = TOOL_CAPABILITIES[toolName];
    return capability === undefined || !hidden.has(capability);
  });
}

export function isCommandVisibleForSurface(
  commandName: string,
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): boolean {
  const capability = COMMAND_CAPABILITIES[commandName];
  return capability === undefined || !getEffectiveHiddenCapabilities(surface, env).has(capability);
}

export function getHiddenCliCommands(
  surface: FeatureSurfaceConfig = activeSurface(),
  env: EnvLike = process.env,
): string[] {
  return Object.keys(COMMAND_CAPABILITIES).filter(
    (commandName) => !isCommandVisibleForSurface(commandName, surface, env),
  );
}
