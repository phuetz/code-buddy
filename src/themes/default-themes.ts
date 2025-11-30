/**
 * Built-in themes for Grok CLI
 */

import { Theme, DEFAULT_AVATARS, EMOJI_AVATARS, HACKER_AVATARS, SPACE_AVATARS, MINIMAL_AVATARS } from './theme.js';

/**
 * Default theme - Clean and professional
 */
export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Default',
  description: 'Clean and professional theme with cyan accents',
  colors: {
    primary: 'cyan',
    secondary: 'magenta',
    accent: 'yellow',
    text: 'white',
    textMuted: 'gray',
    textDim: 'gray',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'cyan',
    border: 'gray',
    borderActive: 'blue',
    borderBusy: 'yellow',
    userMessage: 'gray',
    assistantMessage: 'white',
    toolCall: 'magenta',
    toolResult: 'gray',
    code: 'yellow',
    spinner: 'cyan',
  },
  avatars: DEFAULT_AVATARS,
  isBuiltin: true,
};

/**
 * Dark theme - Easy on the eyes
 */
export const DARK_THEME: Theme = {
  id: 'dark',
  name: 'Dark',
  description: 'Subdued colors for dark environments',
  colors: {
    primary: 'blueBright',
    secondary: 'magentaBright',
    accent: 'cyanBright',
    text: 'whiteBright',
    textMuted: 'gray',
    textDim: 'gray',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'blueBright',
    border: 'gray',
    borderActive: 'blueBright',
    borderBusy: 'yellowBright',
    userMessage: 'gray',
    assistantMessage: 'whiteBright',
    toolCall: 'magentaBright',
    toolResult: 'gray',
    code: 'cyanBright',
    spinner: 'blueBright',
  },
  avatars: DEFAULT_AVATARS,
  isBuiltin: true,
};

/**
 * Neon theme - Vibrant cyberpunk colors
 */
export const NEON_THEME: Theme = {
  id: 'neon',
  name: 'Neon',
  description: 'Vibrant cyberpunk colors for a futuristic feel',
  colors: {
    primary: 'magentaBright',
    secondary: 'cyanBright',
    accent: 'yellowBright',
    text: 'whiteBright',
    textMuted: 'magenta',
    textDim: 'cyan',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'cyanBright',
    border: 'magenta',
    borderActive: 'cyanBright',
    borderBusy: 'yellowBright',
    userMessage: 'cyanBright',
    assistantMessage: 'whiteBright',
    toolCall: 'magentaBright',
    toolResult: 'cyan',
    code: 'yellowBright',
    spinner: 'magentaBright',
  },
  avatars: EMOJI_AVATARS,
  isBuiltin: true,
};

/**
 * Pastel theme - Soft and gentle colors
 */
export const PASTEL_THEME: Theme = {
  id: 'pastel',
  name: 'Pastel',
  description: 'Soft pastel colors for a gentle experience',
  colors: {
    primary: 'cyan',
    secondary: 'magenta',
    accent: 'yellow',
    text: 'white',
    textMuted: 'gray',
    textDim: 'gray',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'blue',
    border: 'cyan',
    borderActive: 'magenta',
    borderBusy: 'yellow',
    userMessage: 'cyan',
    assistantMessage: 'white',
    toolCall: 'magenta',
    toolResult: 'cyan',
    code: 'yellow',
    spinner: 'magenta',
  },
  avatars: EMOJI_AVATARS,
  isBuiltin: true,
};

/**
 * High contrast theme - Maximum readability
 */
export const HIGH_CONTRAST_THEME: Theme = {
  id: 'high-contrast',
  name: 'High Contrast',
  description: 'Maximum contrast for accessibility',
  colors: {
    primary: 'whiteBright',
    secondary: 'yellowBright',
    accent: 'cyanBright',
    text: 'whiteBright',
    textMuted: 'white',
    textDim: 'white',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'cyanBright',
    border: 'whiteBright',
    borderActive: 'yellowBright',
    borderBusy: 'redBright',
    userMessage: 'whiteBright',
    assistantMessage: 'whiteBright',
    toolCall: 'yellowBright',
    toolResult: 'white',
    code: 'cyanBright',
    spinner: 'yellowBright',
  },
  avatars: DEFAULT_AVATARS,
  isBuiltin: true,
};

/**
 * Matrix theme - Green on black hacker style
 */
export const MATRIX_THEME: Theme = {
  id: 'matrix',
  name: 'Matrix',
  description: 'Green terminal aesthetic inspired by the Matrix',
  colors: {
    primary: 'greenBright',
    secondary: 'green',
    accent: 'greenBright',
    text: 'greenBright',
    textMuted: 'green',
    textDim: 'green',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'greenBright',
    border: 'green',
    borderActive: 'greenBright',
    borderBusy: 'yellowBright',
    userMessage: 'green',
    assistantMessage: 'greenBright',
    toolCall: 'greenBright',
    toolResult: 'green',
    code: 'greenBright',
    spinner: 'greenBright',
  },
  avatars: HACKER_AVATARS,
  isBuiltin: true,
};

/**
 * Ocean theme - Calming blue tones
 */
export const OCEAN_THEME: Theme = {
  id: 'ocean',
  name: 'Ocean',
  description: 'Calming ocean-inspired blue tones',
  colors: {
    primary: 'cyanBright',
    secondary: 'blueBright',
    accent: 'cyan',
    text: 'whiteBright',
    textMuted: 'cyan',
    textDim: 'blue',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'cyanBright',
    border: 'blue',
    borderActive: 'cyanBright',
    borderBusy: 'yellowBright',
    userMessage: 'cyan',
    assistantMessage: 'whiteBright',
    toolCall: 'blueBright',
    toolResult: 'cyan',
    code: 'cyanBright',
    spinner: 'cyanBright',
  },
  avatars: SPACE_AVATARS,
  isBuiltin: true,
};

/**
 * Sunset theme - Warm orange and red tones
 */
export const SUNSET_THEME: Theme = {
  id: 'sunset',
  name: 'Sunset',
  description: 'Warm sunset colors with orange and red tones',
  colors: {
    primary: 'yellowBright',
    secondary: 'redBright',
    accent: 'magentaBright',
    text: 'whiteBright',
    textMuted: 'yellow',
    textDim: 'red',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'yellow',
    border: 'red',
    borderActive: 'yellowBright',
    borderBusy: 'redBright',
    userMessage: 'yellow',
    assistantMessage: 'whiteBright',
    toolCall: 'redBright',
    toolResult: 'yellow',
    code: 'yellowBright',
    spinner: 'yellowBright',
  },
  avatars: EMOJI_AVATARS,
  isBuiltin: true,
};

/**
 * Minimal theme - Clean with minimal colors
 */
export const MINIMAL_THEME: Theme = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Minimal and distraction-free',
  colors: {
    primary: 'white',
    secondary: 'gray',
    accent: 'white',
    text: 'white',
    textMuted: 'gray',
    textDim: 'gray',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'white',
    border: 'gray',
    borderActive: 'white',
    borderBusy: 'gray',
    userMessage: 'gray',
    assistantMessage: 'white',
    toolCall: 'gray',
    toolResult: 'gray',
    code: 'white',
    spinner: 'gray',
  },
  avatars: MINIMAL_AVATARS,
  isBuiltin: true,
};

/**
 * All built-in themes
 */
export const BUILTIN_THEMES: Theme[] = [
  DEFAULT_THEME,
  DARK_THEME,
  NEON_THEME,
  PASTEL_THEME,
  HIGH_CONTRAST_THEME,
  MATRIX_THEME,
  OCEAN_THEME,
  SUNSET_THEME,
  MINIMAL_THEME,
];

/**
 * Get a built-in theme by ID
 */
export function getBuiltinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find(theme => theme.id === id);
}
