/**
 * Weather conditions — the SINGLE canonical vocabulary + symbol tables.
 *
 * Pure data module (no d3, no terminal deps) so `src/tools/weather.ts` can
 * import it without dragging renderer dependencies. Before this module the
 * condition→symbol mapping was hardcoded THREE times (emoji in web-search's
 * weather hack, ASCII/emoji in weather-renderer, SVG branches in
 * special-charts) with no shared table.
 */

import type { WeatherCondition } from './types.js';
export type { WeatherCondition } from './types.js';

/**
 * Map a WMO weather code (Open-Meteo `weather_code`) onto the renderer's
 * WeatherCondition union. Reference: WMO 4677 / Open-Meteo docs.
 */
export function wmoToCondition(code: number): WeatherCondition {
  if (!Number.isFinite(code)) return 'unknown';
  const c = Math.trunc(code);
  if (c === 0) return 'sunny';
  if (c === 1 || c === 2) return 'partly-cloudy';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 80 && c <= 82) return 'showers';
  if (c === 95 || c === 96 || c === 99) return 'thunderstorm';
  return 'unknown';
}

/** Compact emoji per condition (moved verbatim from weather-renderer). */
export const CONDITION_EMOJI: Record<WeatherCondition, string> = {
  'sunny': '☀️',
  'clear': '🌙',
  'partly-cloudy': '⛅',
  'cloudy': '☁️',
  'overcast': '☁️',
  'rain': '🌧️',
  'drizzle': '🌦️',
  'showers': '🌧️',
  'thunderstorm': '⛈️',
  'snow': '❄️',
  'sleet': '🌨️',
  'fog': '🌫️',
  'mist': '🌫️',
  'windy': '💨',
  'unknown': '❓',
};

/** Spoken/written French label per condition (for summaries and the voice path). */
export const CONDITION_LABEL_FR: Record<WeatherCondition, string> = {
  'sunny': 'ensoleillé',
  'clear': 'dégagé',
  'partly-cloudy': 'partiellement nuageux',
  'cloudy': 'nuageux',
  'overcast': 'couvert',
  'rain': 'pluvieux',
  'drizzle': 'bruine',
  'showers': 'averses',
  'thunderstorm': 'orageux',
  'snow': 'neigeux',
  'sleet': 'neige fondue',
  'fog': 'brouillard',
  'mist': 'brume',
  'windy': 'venteux',
  'unknown': 'conditions inconnues',
};
