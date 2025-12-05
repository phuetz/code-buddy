/**
 * WeatherRenderer - Render weather data with ASCII art
 *
 * Displays weather information with:
 * - ASCII art icons for conditions
 * - Current temperature and conditions
 * - Optional forecast
 */

import stringWidth from 'string-width';
import {
  Renderer,
  RenderContext,
  WeatherData,
  WeatherCondition,
  WeatherForecast,
  isWeatherData,
} from './types.js';

// ============================================================================
// ASCII Art Icons
// ============================================================================

const WEATHER_ICONS: Record<WeatherCondition, string[]> = {
  'sunny': [
    '    \\   /    ',
    '     .-.     ',
    '  ― (   ) ―  ',
    '     `-´     ',
    '    /   \\    ',
  ],
  'clear': [
    '    \\   /    ',
    '     .-.     ',
    '  ― (   ) ―  ',
    '     `-´     ',
    '    /   \\    ',
  ],
  'partly-cloudy': [
    '   \\  /      ',
    ' _ /\"\".-.    ',
    '   \\_(   ).  ',
    '   /(___(__) ',
    '             ',
  ],
  'cloudy': [
    '             ',
    '     .--.    ',
    '  .-(    ).  ',
    ' (___.__)__) ',
    '             ',
  ],
  'overcast': [
    '             ',
    '     .--.    ',
    '  .-(    ).  ',
    ' (___.__)__) ',
    '             ',
  ],
  'rain': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '    ʻ ʻ ʻ ʻ  ',
    '   ʻ ʻ ʻ ʻ   ',
  ],
  'drizzle': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '    ʻ  ʻ     ',
    '      ʻ      ',
  ],
  'showers': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '   ‚ʻ‚ʻ‚ʻ‚   ',
    '   ‚ʻ‚ʻ‚ʻ    ',
  ],
  'thunderstorm': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '  ⚡ʻ ʻ⚡ʻ ʻ  ',
    '   ʻ ʻ ʻ ʻ   ',
  ],
  'snow': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '    * * * *  ',
    '   * * * *   ',
  ],
  'sleet': [
    '     .-.     ',
    '    (   ).   ',
    '   (___(__)  ',
    '    ʻ * ʻ *  ',
    '   * ʻ * ʻ   ',
  ],
  'fog': [
    '             ',
    ' _ - _ - _ - ',
    '  _ - _ - _  ',
    ' _ - _ - _ - ',
    '             ',
  ],
  'mist': [
    '             ',
    ' _ - _ - _ - ',
    '  _ - _ - _  ',
    ' _ - _ - _ - ',
    '             ',
  ],
  'windy': [
    '             ',
    '    ~~~~>    ',
    '  ~~~~~~>    ',
    '    ~~~~>    ',
    '             ',
  ],
  'unknown': [
    '             ',
    '     ?       ',
    '    ???      ',
    '     ?       ',
    '             ',
  ],
};

// Simple emoji icons for compact display
const EMOJI_ICONS: Record<WeatherCondition, string> = {
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

// ============================================================================
// Renderer Implementation
// ============================================================================

export const weatherRenderer: Renderer<WeatherData> = {
  id: 'weather',
  name: 'Weather Renderer',
  priority: 10,

  canRender(data: unknown): data is WeatherData {
    return isWeatherData(data);
  },

  render(data: WeatherData, ctx: RenderContext): string {
    if (ctx.mode === 'plain') {
      return renderPlain(data);
    }
    return renderFancy(data, ctx);
  },
};

// ============================================================================
// Plain Mode Rendering
// ============================================================================

function renderPlain(data: WeatherData): string {
  const lines: string[] = [];
  const { location, current, forecast, units } = data;
  const tempUnit = units === 'imperial' ? '°F' : '°C';

  lines.push(`Weather for ${location}`);
  lines.push(`Temperature: ${current.temperature}${tempUnit}`);
  if (current.feelsLike !== undefined) {
    lines.push(`Feels like: ${current.feelsLike}${tempUnit}`);
  }
  lines.push(`Condition: ${formatCondition(current.condition)}`);
  if (current.humidity !== undefined) {
    lines.push(`Humidity: ${current.humidity}%`);
  }
  if (current.windSpeed !== undefined) {
    const windUnit = units === 'imperial' ? 'mph' : 'km/h';
    lines.push(`Wind: ${current.windSpeed} ${windUnit}${current.windDirection ? ` ${current.windDirection}` : ''}`);
  }

  if (forecast && forecast.length > 0) {
    lines.push('');
    lines.push('Forecast:');
    for (const day of forecast) {
      lines.push(`  ${day.date}: ${day.low}${tempUnit} - ${day.high}${tempUnit}, ${formatCondition(day.condition)}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Fancy Mode Rendering
// ============================================================================

function renderFancy(data: WeatherData, ctx: RenderContext): string {
  const lines: string[] = [];
  const { location, current, forecast, units } = data;
  const tempUnit = units === 'imperial' ? '°F' : '°C';
  const W = Math.min(ctx.width, 60);

  // Header
  lines.push('┌' + '─'.repeat(W - 2) + '┐');
  const icon = ctx.emoji ? EMOJI_ICONS[current.condition] + ' ' : '';
  const title = `${icon}Weather: ${location}`;
  lines.push('│' + centerText(title, W - 2) + '│');
  lines.push('├' + '─'.repeat(W - 2) + '┤');

  // ASCII art and current conditions side by side
  const artLines = WEATHER_ICONS[current.condition] || WEATHER_ICONS.unknown;
  const artWidth = 14;

  // Build info lines
  const infoLines: string[] = [];
  infoLines.push(`${current.temperature}${tempUnit}`);
  if (current.feelsLike !== undefined) {
    infoLines.push(`Feels: ${current.feelsLike}${tempUnit}`);
  }
  infoLines.push(formatCondition(current.condition));
  if (current.humidity !== undefined) {
    infoLines.push(`Humidity: ${current.humidity}%`);
  }
  if (current.windSpeed !== undefined) {
    const windUnit = units === 'imperial' ? 'mph' : 'km/h';
    const wind = `${current.windSpeed} ${windUnit}`;
    infoLines.push(`Wind: ${wind}`);
  }

  // Combine art and info
  const maxLines = Math.max(artLines.length, infoLines.length);
  for (let i = 0; i < maxLines; i++) {
    const art = artLines[i] || ' '.repeat(artWidth);
    const info = infoLines[i] || '';
    const combined = art + '  ' + info;
    lines.push('│ ' + padEnd(combined, W - 4) + ' │');
  }

  // Forecast if available
  if (forecast && forecast.length > 0) {
    lines.push('├' + '─'.repeat(W - 2) + '┤');
    lines.push('│' + centerText('Forecast', W - 2) + '│');
    lines.push('├' + '─'.repeat(W - 2) + '┤');

    for (const day of forecast.slice(0, 5)) {
      const dayIcon = ctx.emoji ? EMOJI_ICONS[day.condition] : '';
      const temps = `${day.low}° - ${day.high}°`;
      const precip = day.precipitation !== undefined ? ` ${day.precipitation}%` : '';
      const dayLine = `${day.date.padEnd(10)} ${dayIcon} ${temps}${precip}`;
      lines.push('│ ' + padEnd(dayLine, W - 4) + ' │');
    }
  }

  // Footer
  lines.push('└' + '─'.repeat(W - 2) + '┘');

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatCondition(condition: WeatherCondition): string {
  return condition
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function centerText(text: string, width: number): string {
  const textWidth = stringWidth(text);
  if (textWidth >= width) return text.slice(0, width);
  const leftPad = Math.floor((width - textWidth) / 2);
  const rightPad = width - textWidth - leftPad;
  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}

function padEnd(str: string, width: number): string {
  const currentWidth = stringWidth(str);
  if (currentWidth >= width) return str;
  return str + ' '.repeat(width - currentWidth);
}

export default weatherRenderer;
