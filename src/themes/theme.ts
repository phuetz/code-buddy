/**
 * Theme system for Grok CLI
 * Provides customizable color themes and visual styling
 */

/**
 * Color definition - can be an Ink-compatible color string
 */
export type ThemeColor =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'
  | 'blackBright' | 'redBright' | 'greenBright' | 'yellowBright' | 'blueBright'
  | 'magentaBright' | 'cyanBright' | 'whiteBright'
  | `#${string}`; // Hex colors

/**
 * Color palette for a theme
 */
export interface ThemeColors {
  // Primary colors
  primary: ThemeColor;
  secondary: ThemeColor;
  accent: ThemeColor;

  // Text colors
  text: ThemeColor;
  textMuted: ThemeColor;
  textDim: ThemeColor;

  // Background colors
  background?: ThemeColor;
  backgroundAlt?: ThemeColor;

  // Status colors
  success: ThemeColor;
  error: ThemeColor;
  warning: ThemeColor;
  info: ThemeColor;

  // UI element colors
  border: ThemeColor;
  borderActive: ThemeColor;
  borderBusy: ThemeColor;

  // Chat colors
  userMessage: ThemeColor;
  assistantMessage: ThemeColor;
  toolCall: ThemeColor;
  toolResult: ThemeColor;

  // Code/syntax colors
  code: ThemeColor;
  codeBackground?: ThemeColor;

  // Spinner/loading colors
  spinner: ThemeColor;
}

/**
 * Avatar configuration
 */
export interface AvatarConfig {
  user: string;      // Avatar for user messages
  assistant: string; // Avatar for assistant messages
  tool: string;      // Avatar for tool calls
  system: string;    // Avatar for system messages
}

/**
 * Complete theme definition
 */
export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  avatars: AvatarConfig;
  isBuiltin: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * User's theme preferences stored in settings
 */
export interface ThemePreferences {
  activeTheme: string;
  customAvatars?: Partial<AvatarConfig>;
  customColors?: Partial<ThemeColors>;
}

/**
 * Avatar presets that users can choose from
 */
export interface AvatarPreset {
  id: string;
  name: string;
  description: string;
  avatars: AvatarConfig;
}

/**
 * Default avatar configurations
 */
export const DEFAULT_AVATARS: AvatarConfig = {
  user: '>',
  assistant: '⏺',
  tool: '⏺',
  system: '⚙',
};

/**
 * Emoji avatar set
 */
export const EMOJI_AVATARS: AvatarConfig = {
  user: '🧑',
  assistant: '🤖',
  tool: '🔧',
  system: '⚙️',
};

/**
 * Minimal avatar set
 */
export const MINIMAL_AVATARS: AvatarConfig = {
  user: '→',
  assistant: '←',
  tool: '◆',
  system: '●',
};

/**
 * Fun avatar set
 */
export const FUN_AVATARS: AvatarConfig = {
  user: '👤',
  assistant: '🧠',
  tool: '⚡',
  system: '🎯',
};

/**
 * Hacker avatar set
 */
export const HACKER_AVATARS: AvatarConfig = {
  user: '[>]',
  assistant: '[<]',
  tool: '[#]',
  system: '[$]',
};

/**
 * Space avatar set
 */
export const SPACE_AVATARS: AvatarConfig = {
  user: '🚀',
  assistant: '👽',
  tool: '🛸',
  system: '🌟',
};

/**
 * Animal avatar set
 */
export const ANIMAL_AVATARS: AvatarConfig = {
  user: '🐱',
  assistant: '🦊',
  tool: '🐙',
  system: '🦉',
};

/**
 * Available avatar presets
 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Simple symbols for a clean look',
    avatars: DEFAULT_AVATARS,
  },
  {
    id: 'emoji',
    name: 'Emoji',
    description: 'Colorful emoji avatars',
    avatars: EMOJI_AVATARS,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Minimalist arrow-based avatars',
    avatars: MINIMAL_AVATARS,
  },
  {
    id: 'fun',
    name: 'Fun',
    description: 'Playful emoji avatars',
    avatars: FUN_AVATARS,
  },
  {
    id: 'hacker',
    name: 'Hacker',
    description: 'Terminal-style brackets',
    avatars: HACKER_AVATARS,
  },
  {
    id: 'space',
    name: 'Space',
    description: 'Space-themed emoji avatars',
    avatars: SPACE_AVATARS,
  },
  {
    id: 'animal',
    name: 'Animal',
    description: 'Cute animal emoji avatars',
    avatars: ANIMAL_AVATARS,
  },
];
