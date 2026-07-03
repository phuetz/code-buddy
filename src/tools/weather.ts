/**
 * Weather tool — real weather data via Open-Meteo (free, NO API key).
 *
 * Replaces the old hardcoded "weather" presentation hack that lived inside
 * web-search.ts (keyword detection + a French card faked from generic search
 * results, with no weather data behind it). This tool geocodes the location,
 * fetches current conditions + an optional daily forecast, and returns BOTH a
 * deterministic French summary and a structured `WeatherData` payload matching
 * `src/renderers/types.ts` — finally feeding the (previously orphaned)
 * weather renderer.
 *
 * Fail-soft by design: any network/API problem returns a French error
 * ToolResult, never a throw. Base URLs are overridable for loopback tests.
 */

import axios from 'axios';
import type { ToolResult } from '../types/index.js';
import type { WeatherData, WeatherForecast } from '../renderers/types.js';
import { wmoToCondition, CONDITION_EMOJI, CONDITION_LABEL_FR } from '../renderers/weather-conditions.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface WeatherToolOptions {
  /** Geocoding API base (default env CODEBUDDY_OPEN_METEO_GEOCODING_BASE, else Open-Meteo). */
  geocodingBaseUrl?: string;
  /** Forecast API base (default env CODEBUDDY_OPEN_METEO_BASE, else Open-Meteo). */
  forecastBaseUrl?: string;
  timeoutMs?: number;
}

interface GeocodeHit {
  name: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export class WeatherTool {
  private readonly geocodingBaseUrl: string;
  private readonly forecastBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: WeatherToolOptions = {}) {
    this.geocodingBaseUrl =
      options.geocodingBaseUrl ??
      process.env.CODEBUDDY_OPEN_METEO_GEOCODING_BASE ??
      'https://geocoding-api.open-meteo.com';
    this.forecastBaseUrl =
      options.forecastBaseUrl ?? process.env.CODEBUDDY_OPEN_METEO_BASE ?? 'https://api.open-meteo.com';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getWeather(location: string, days = 1, units: 'metric' | 'imperial' = 'metric'): Promise<ToolResult> {
    const query = (location ?? '').trim();
    if (!query) {
      return { success: false, error: 'Aucun lieu fourni. Exemple : weather({ location: "Paris" }).' };
    }
    const forecastDays = Math.min(7, Math.max(1, Math.trunc(Number.isFinite(days) ? days : 1)));

    // 1. Geocode — first hit wins, and the resolved "name, country" is echoed
    //    everywhere so a wrong disambiguation is visible and correctable.
    let hit: GeocodeHit;
    try {
      const geoUrl =
        `${this.geocodingBaseUrl}/v1/search?name=${encodeURIComponent(query)}` + `&count=1&language=fr&format=json`;
      const geo = await axios.get(geoUrl, { timeout: this.timeoutMs });
      const results = (geo.data as { results?: GeocodeHit[] })?.results;
      if (!Array.isArray(results) || results.length === 0 || !results[0]) {
        return {
          success: false,
          error: `Lieu introuvable : « ${query} ». Vérifiez l'orthographe ou précisez (ville, pays).`,
        };
      }
      hit = results[0];
    } catch (err) {
      return { success: false, error: this.describeApiError('géocodage', err) };
    }

    // 2. Forecast.
    let payload: OpenMeteoForecast;
    try {
      const unitParams =
        units === 'imperial' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
      const fcUrl =
        `${this.forecastBaseUrl}/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
        `&timezone=auto&forecast_days=${forecastDays}${unitParams}`;
      const fc = await axios.get(fcUrl, { timeout: this.timeoutMs });
      payload = fc.data as OpenMeteoForecast;
    } catch (err) {
      return { success: false, error: this.describeApiError('prévisions', err) };
    }

    const current = payload?.current;
    const tempRaw = current?.temperature_2m;
    if (!current || typeof tempRaw !== 'number' || !Number.isFinite(tempRaw)) {
      return { success: false, error: `Données météo indisponibles pour « ${query} » (réponse incomplète).` };
    }

    const resolvedLocation = hit.country ? `${hit.name}, ${hit.country}` : hit.name;
    const condition = wmoToCondition(current.weather_code ?? NaN);
    const tempUnit = units === 'imperial' ? '°F' : '°C';
    const windUnit = units === 'imperial' ? 'mph' : 'km/h';
    const temperature = tempRaw;
    const feelsLike = typeof current.apparent_temperature === 'number' && Number.isFinite(current.apparent_temperature)
      ? current.apparent_temperature
      : undefined;
    const humidity = typeof current.relative_humidity_2m === 'number' && Number.isFinite(current.relative_humidity_2m)
      ? current.relative_humidity_2m
      : undefined;
    const windSpeed = typeof current.wind_speed_10m === 'number' && Number.isFinite(current.wind_speed_10m)
      ? current.wind_speed_10m
      : undefined;

    const data: WeatherData = {
      type: 'weather',
      location: resolvedLocation,
      current: {
        temperature,
        ...(feelsLike !== undefined ? { feelsLike } : {}),
        condition,
        ...(humidity !== undefined ? { humidity } : {}),
        ...(windSpeed !== undefined ? { windSpeed } : {}),
      },
      units,
    };

    const forecast = this.zipDaily(payload.daily);
    if (forecast.length > 0) data.forecast = forecast;

    // Deterministic French summary (ISO dates kept for testability).
    const parts = [
      `Météo à ${hit.name}${hit.country ? ` (${hit.country})` : ''} : ${Math.round(temperature)}${tempUnit}` +
        `${feelsLike !== undefined ? ` (ressenti ${Math.round(feelsLike)}${tempUnit})` : ''}` +
        `, ${CONDITION_LABEL_FR[condition]} ${CONDITION_EMOJI[condition]}` +
        `${windSpeed !== undefined ? `, vent ${Math.round(windSpeed)} ${windUnit}` : ''}` +
        `${humidity !== undefined ? `, humidité ${Math.round(humidity)} %` : ''}.`,
    ];
    for (const day of forecast) {
      const dayCondition = day.condition;
      parts.push(
        `${day.date} : ${Math.round(day.low)}–${Math.round(day.high)}${tempUnit}, ` +
          `${CONDITION_LABEL_FR[dayCondition]} ${CONDITION_EMOJI[dayCondition]}` +
          `${day.precipitation !== undefined ? ` (pluie ${Math.round(day.precipitation)} %)` : ''}`,
      );
    }

    return { success: true, output: parts.join('\n'), data };
  }

  /** Zip Open-Meteo's parallel daily arrays into WeatherForecast rows; empty/mismatched → []. */
  private zipDaily(daily: OpenMeteoForecast['daily']): WeatherForecast[] {
    const time = daily?.time;
    const max = daily?.temperature_2m_max;
    const min = daily?.temperature_2m_min;
    const codes = daily?.weather_code;
    if (!Array.isArray(time) || !Array.isArray(max) || !Array.isArray(min) || !Array.isArray(codes)) return [];
    if (time.length === 0 || max.length !== time.length || min.length !== time.length || codes.length !== time.length) {
      return [];
    }
    const precip = Array.isArray(daily?.precipitation_probability_max) ? daily!.precipitation_probability_max : [];
    const out: WeatherForecast[] = [];
    for (let i = 0; i < time.length; i++) {
      const high = max[i];
      const low = min[i];
      if (typeof time[i] !== 'string' || !Number.isFinite(high) || !Number.isFinite(low)) continue;
      out.push({
        date: time[i]!,
        high: high!,
        low: low!,
        condition: wmoToCondition(codes[i] ?? NaN),
        ...(Number.isFinite(precip[i]) ? { precipitation: precip[i]! } : {}),
      });
    }
    return out;
  }

  private describeApiError(stage: string, err: unknown): string {
    if (axios.isAxiosError(err)) {
      if (err.response) return `Service météo indisponible (${stage} : HTTP ${err.response.status}). Réessayez plus tard.`;
      if (err.code === 'ECONNABORTED') return `Service météo trop lent (${stage} : délai dépassé).`;
      return `Service météo injoignable (${stage} : ${err.code ?? 'réseau'}).`;
    }
    return `Service météo en erreur (${stage} : ${err instanceof Error ? err.message : String(err)}).`;
  }
}

interface OpenMeteoForecast {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
    precipitation_probability_max?: number[];
  };
}
