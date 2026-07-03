/**
 * WeatherTool — real loopback HTTP round-trips (no mocked transport, per the
 * no-mocks rule): a local server plays Open-Meteo (geocoding + forecast) and
 * every wire parameter and failure mode is exercised for real.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WeatherTool } from '../../src/tools/weather.js';
import { isWeatherData } from '../../src/renderers/types.js';

interface CapturedRequest {
  path: string;
  url: URL;
}

const GEOCODE_PARIS = {
  results: [{ name: 'Paris', country: 'France', latitude: 48.85, longitude: 2.35 }],
};

const FORECAST_OK = {
  current: {
    temperature_2m: 21.4,
    apparent_temperature: 23.1,
    relative_humidity_2m: 55,
    weather_code: 2,
    wind_speed_10m: 12.3,
  },
  daily: {
    time: ['2026-07-04'],
    temperature_2m_max: [27.2],
    temperature_2m_min: [18.1],
    weather_code: [0],
    precipitation_probability_max: [10],
  },
};

describe('WeatherTool (real loopback Open-Meteo)', () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: CapturedRequest[];
  let forecastStatus: number;
  let forecastBody: unknown;
  let geocodeBody: unknown;

  beforeEach(async () => {
    captured = [];
    forecastStatus = 200;
    forecastBody = FORECAST_OK;
    geocodeBody = GEOCODE_PARIS;
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      captured.push({ path: url.pathname, url });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/v1/search') {
        res.end(JSON.stringify(geocodeBody));
      } else if (url.pathname === '/v1/forecast') {
        res.statusCode = forecastStatus;
        res.end(JSON.stringify(forecastBody));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const tool = (): WeatherTool => new WeatherTool({ geocodingBaseUrl: baseUrl, forecastBaseUrl: baseUrl });

  it('happy path: geocodes, fetches, returns a French summary + renderer-ready WeatherData', async () => {
    const result = await tool().getWeather('Paris');
    expect(result.success).toBe(true);

    // Wire params asserted for real.
    const geo = captured.find((c) => c.path === '/v1/search')!;
    expect(geo.url.searchParams.get('name')).toBe('Paris');
    expect(geo.url.searchParams.get('count')).toBe('1');
    const fc = captured.find((c) => c.path === '/v1/forecast')!;
    expect(fc.url.searchParams.get('timezone')).toBe('auto');
    expect(fc.url.searchParams.get('forecast_days')).toBe('1');
    expect(fc.url.searchParams.get('latitude')).toBe('48.85');

    // French summary — deterministic pieces.
    expect(result.output).toContain('Météo à Paris (France)');
    expect(result.output).toContain('21°C');
    expect(result.output).toContain('ressenti 23°C');
    expect(result.output).toContain('partiellement nuageux');
    expect(result.output).toContain('2026-07-04 : 18–27°C');
    expect(result.output).toContain('pluie 10 %');

    // Structured payload feeds the (previously orphaned) weather renderer.
    expect(isWeatherData(result.data)).toBe(true);
    const data = result.data as { current: { condition: string }; location: string; forecast?: unknown[] };
    expect(data.location).toBe('Paris, France');
    expect(data.current.condition).toBe('partly-cloudy');
    expect(data.forecast).toHaveLength(1);
  });

  it('honors the env-based base URLs (default constructor)', async () => {
    const before = {
      geo: process.env.CODEBUDDY_OPEN_METEO_GEOCODING_BASE,
      fc: process.env.CODEBUDDY_OPEN_METEO_BASE,
    };
    process.env.CODEBUDDY_OPEN_METEO_GEOCODING_BASE = baseUrl;
    process.env.CODEBUDDY_OPEN_METEO_BASE = baseUrl;
    try {
      const result = await new WeatherTool().getWeather('Paris');
      expect(result.success).toBe(true);
      expect(captured.some((c) => c.path === '/v1/forecast')).toBe(true);
    } finally {
      if (before.geo === undefined) delete process.env.CODEBUDDY_OPEN_METEO_GEOCODING_BASE;
      else process.env.CODEBUDDY_OPEN_METEO_GEOCODING_BASE = before.geo;
      if (before.fc === undefined) delete process.env.CODEBUDDY_OPEN_METEO_BASE;
      else process.env.CODEBUDDY_OPEN_METEO_BASE = before.fc;
    }
  });

  it('sends accented/multi-word cities as one URL-encoded name param', async () => {
    await tool().getWeather('La Roche-sur-Yon');
    expect(captured.find((c) => c.path === '/v1/search')!.url.searchParams.get('name')).toBe('La Roche-sur-Yon');
    captured = [];
    await tool().getWeather('Besançon');
    expect(captured.find((c) => c.path === '/v1/search')!.url.searchParams.get('name')).toBe('Besançon');
  });

  it('location not found → fail-soft French error, zero forecast calls', async () => {
    geocodeBody = { results: [] };
    const result = await tool().getWeather('Xyzzyville');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Xyzzyville');
    expect(captured.some((c) => c.path === '/v1/forecast')).toBe(false);
  });

  it('forecast 500 and connection-refused both fail soft (never throw)', async () => {
    forecastStatus = 500;
    const apiDown = await tool().getWeather('Paris');
    expect(apiDown.success).toBe(false);
    expect(apiDown.error).toContain('500');

    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const refused = await new WeatherTool({
      geocodingBaseUrl: `http://127.0.0.1:${port}`,
      forecastBaseUrl: `http://127.0.0.1:${port}`,
    }).getWeather('Paris');
    expect(refused.success).toBe(false);
    // Recreate a server so afterEach close() has something to close.
    server = http.createServer((_req, res) => res.end('{}'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  it('empty daily arrays → success with no forecast lines; days is clamped to 7', async () => {
    forecastBody = { ...FORECAST_OK, daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] } };
    const result = await tool().getWeather('Paris', 9);
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('2026-07-04');
    expect((result.data as { forecast?: unknown[] }).forecast).toBeUndefined();
    expect(captured.find((c) => c.path === '/v1/forecast')!.url.searchParams.get('forecast_days')).toBe('7');
  });

  it('empty location → immediate French usage error, no network', async () => {
    const result = await tool().getWeather('   ');
    expect(result.success).toBe(false);
    expect(captured).toHaveLength(0);
  });
});
