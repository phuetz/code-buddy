/**
 * Theme system exports for Grok CLI
 */

// Types and interfaces
export {
  Theme,
  ThemeColor,
  ThemeColors,
  AvatarConfig,
  ThemePreferences,
  AvatarPreset,
  DEFAULT_AVATARS,
  EMOJI_AVATARS,
  MINIMAL_AVATARS,
  FUN_AVATARS,
  HACKER_AVATARS,
  SPACE_AVATARS,
  ANIMAL_AVATARS,
  AVATAR_PRESETS,
} from './theme.js';

// Default themes
export {
  DEFAULT_THEME,
  DARK_THEME,
  NEON_THEME,
  PASTEL_THEME,
  HIGH_CONTRAST_THEME,
  MATRIX_THEME,
  OCEAN_THEME,
  SUNSET_THEME,
  MINIMAL_THEME,
  BUILTIN_THEMES,
  getBuiltinTheme,
} from './default-themes.js';

// Theme manager
export { ThemeManager, getThemeManager } from './theme-manager.js';
