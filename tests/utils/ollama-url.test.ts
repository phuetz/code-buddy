import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getOllamaBaseUrl, getOllamaV1BaseUrl } from '../../src/utils/ollama-url.js';

describe('ollama-url', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default when OLLAMA_HOST is not set', () => {
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_BASE_URL;
    expect(getOllamaBaseUrl()).toBe('http://127.0.0.1:11434');
    expect(getOllamaV1BaseUrl()).toBe('http://127.0.0.1:11434/v1');
  });

  it('uses OLLAMA_HOST with http schema', () => {
    process.env.OLLAMA_HOST = 'http://autre:1234';
    expect(getOllamaBaseUrl()).toBe('http://autre:1234');
    expect(getOllamaV1BaseUrl()).toBe('http://autre:1234/v1');
  });

  it('adds http schema if missing from OLLAMA_HOST', () => {
    process.env.OLLAMA_HOST = 'autre:1234';
    expect(getOllamaBaseUrl()).toBe('http://autre:1234');
    expect(getOllamaV1BaseUrl()).toBe('http://autre:1234/v1');
  });

  it('handles trailing slashes', () => {
    process.env.OLLAMA_HOST = 'http://autre:1234/';
    expect(getOllamaBaseUrl()).toBe('http://autre:1234');
    expect(getOllamaV1BaseUrl()).toBe('http://autre:1234/v1');
  });

  it('uses OLLAMA_BASE_URL if set instead of OLLAMA_HOST', () => {
    delete process.env.OLLAMA_HOST;
    process.env.OLLAMA_BASE_URL = 'http://baseurl:5555';
    expect(getOllamaBaseUrl()).toBe('http://baseurl:5555');
  });

  it('uses the scoped environment and ignores the process environment', () => {
    process.env.OLLAMA_HOST = 'http://outside:11434';
    expect(getOllamaV1BaseUrl({ OLLAMA_HOST: 'inside:11435/' })).toBe('http://inside:11435/v1');
  });

  it('falls back from blank OLLAMA_HOST and avoids a duplicate v1 suffix', () => {
    expect(getOllamaBaseUrl({ OLLAMA_HOST: '  ', OLLAMA_BASE_URL: 'http://inside:11435/v1/' }))
      .toBe('http://inside:11435');
    expect(getOllamaV1BaseUrl({ OLLAMA_HOST: '  ', OLLAMA_BASE_URL: 'http://inside:11435/v1/' }))
      .toBe('http://inside:11435/v1');
  });
});
