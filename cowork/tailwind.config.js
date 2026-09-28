// Tailwind's plain `var(...)` colors do not generate slash-opacity utilities.
// Keep every color tied to the active theme while supporting bg-accent/10, etc.
const themeColor = (variable) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${variable})`
    : `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;
const currentColor = ({ opacityValue }) =>
  opacityValue === undefined
    ? 'currentColor'
    : `color-mix(in srgb, currentColor calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Existing tokens and compatibility aliases share the same theme source.
        background: {
          DEFAULT: themeColor('--color-background'),
          secondary: themeColor('--color-background-secondary'),
        },
        surface: {
          DEFAULT: themeColor('--color-surface'),
          hover: themeColor('--color-surface-hover'),
          active: themeColor('--color-surface-active'),
          muted: themeColor('--color-surface-muted'),
          secondary: themeColor('--color-background-secondary'),
        },
        border: {
          DEFAULT: themeColor('--color-border'),
          muted: themeColor('--color-border-muted'),
          subtle: themeColor('--color-border-subtle'),
          strong: themeColor('--color-border-strong'),
        },
        accent: {
          DEFAULT: themeColor('--color-accent'),
          hover: themeColor('--color-accent-hover'),
          muted: themeColor('--color-accent-muted'),
          foreground: themeColor('--color-on-accent'),
          contrast: themeColor('--color-on-accent'),
          primary: themeColor('--color-accent'),
        },
        mcp: {
          DEFAULT: themeColor('--color-mcp'),
        },
        text: {
          DEFAULT: themeColor('--color-text-primary'),
          primary: themeColor('--color-text-primary'),
          secondary: themeColor('--color-text-secondary'),
          // Historical text-text-muted classes remain readable; the raw CSS
          // variable stays available for decorative lines and icons only.
          muted: themeColor('--color-text-secondary'),
          tertiary: themeColor('--color-text-secondary'),
        },
        primary: themeColor('--color-accent'),
        'primary-foreground': themeColor('--color-on-accent'),
        muted: themeColor('--color-surface-muted'),
        'muted-foreground': themeColor('--color-text-secondary'),
        foreground: themeColor('--color-text-primary'),
        destructive: themeColor('--color-error'),
        danger: themeColor('--color-error'),
        secondary: themeColor('--color-text-secondary'),
        info: themeColor('--color-info'),
        current: currentColor,
        success: themeColor('--color-success'),
        warning: themeColor('--color-warning'),
        error: themeColor('--color-error'),
      },
      opacity: {
        8: '0.08', 12: '0.12', 18: '0.18', 35: '0.35', 45: '0.45',
        55: '0.55', 65: '0.65', 88: '0.88', 92: '0.92',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'soft': 'var(--shadow-soft)',
        'card': 'var(--shadow-card)',
        'elevated': 'var(--shadow-elevated)',
      },
      borderRadius: {
        'lg': '8px',
        'xl': '10px',
        '2xl': '14px',
        '3xl': '16px',
      },
      backgroundImage: {
        'grid-pattern': `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4d2cc' fill-opacity='0.4'%3E%3Cpath d='M0 0h1v40H0V0zm39 0h1v40h-1V0z'/%3E%3Cpath d='M0 0h40v1H0V0zm0 39h40v1H0v-1z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'spin-slow': 'spin 2s linear infinite',
        'expand': 'expand 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        expand: {
          '0%': { opacity: '0', maxHeight: '0' },
          '100%': { opacity: '1', maxHeight: '500px' },
        },
      },
    },
  },
  plugins: [],
}
