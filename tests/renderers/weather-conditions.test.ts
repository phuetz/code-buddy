/**
 * Canonical weather-conditions module — the single condition vocabulary
 * (WMO code mapping + emoji + French labels) shared by the weather tool
 * and the renderers.
 */
import { describe, expect, it } from 'vitest';

import {
  wmoToCondition,
  CONDITION_EMOJI,
  CONDITION_LABEL_FR,
  type WeatherCondition,
} from '../../src/renderers/weather-conditions.js';

const ALL_CONDITIONS: WeatherCondition[] = [
  'sunny', 'clear', 'partly-cloudy', 'cloudy', 'overcast', 'rain', 'drizzle',
  'showers', 'thunderstorm', 'snow', 'sleet', 'fog', 'mist', 'windy', 'unknown',
];

describe('wmoToCondition (WMO 4677 / Open-Meteo weather_code)', () => {
  it('maps the full WMO table onto the WeatherCondition union', () => {
    const table: Array<[number[], WeatherCondition]> = [
      [[0], 'sunny'],
      [[1, 2], 'partly-cloudy'],
      [[3], 'cloudy'],
      [[45, 48], 'fog'],
      [[51, 53, 55, 56, 57], 'drizzle'],
      [[61, 63, 65, 66, 67], 'rain'],
      [[71, 73, 75, 77, 85, 86], 'snow'],
      [[80, 81, 82], 'showers'],
      [[95, 96, 99], 'thunderstorm'],
    ];
    for (const [codes, expected] of table) {
      for (const code of codes) {
        expect(wmoToCondition(code), `WMO ${code}`).toBe(expected);
      }
    }
  });

  it('maps unknown/invalid codes to "unknown"', () => {
    for (const code of [4, 30, 50, 60, 70, 79, 83, 90, 100, -1, NaN, Infinity]) {
      expect(wmoToCondition(code), `code ${code}`).toBe('unknown');
    }
  });
});

describe('symbol tables cover the whole union', () => {
  it('every condition has an emoji and a French label', () => {
    for (const condition of ALL_CONDITIONS) {
      expect(CONDITION_EMOJI[condition], `emoji ${condition}`).toBeTruthy();
      expect(CONDITION_LABEL_FR[condition], `label ${condition}`).toBeTruthy();
    }
  });

  it('spot-checks the mapping semantics', () => {
    expect(CONDITION_EMOJI['sunny']).toBe('☀️');
    expect(CONDITION_EMOJI['thunderstorm']).toBe('⛈️');
    expect(CONDITION_LABEL_FR['partly-cloudy']).toBe('partiellement nuageux');
    expect(CONDITION_LABEL_FR['unknown']).toBe('conditions inconnues');
  });
});
