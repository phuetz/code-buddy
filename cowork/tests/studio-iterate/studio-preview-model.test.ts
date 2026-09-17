/**
 * studio-preview-model — real tests (no mocks): dev-command inference, instance
 * resolution, status mapping, device framing, webview guard.
 */
import { describe, expect, it } from 'vitest';
import {
  detectDevCommand,
  pickInstance,
  statusFromInstance,
  frameWidth,
  canRenderWebview,
  type DevStatusLike,
} from '../../src/renderer/components/studio-iterate/studio-preview-model';

describe('detectDevCommand', () => {
  it('recognises Vite, Next, Astro and CRA', () => {
    expect(detectDevCommand({ scripts: { dev: 'vite' } })).toEqual({
      command: 'npm run dev',
      url: 'http://localhost:5173',
    });
    expect(detectDevCommand({ scripts: { dev: 'next dev' } }).url).toBe('http://localhost:3000');
    expect(detectDevCommand({ scripts: { dev: 'astro dev' } }).url).toBe('http://localhost:4321');
    expect(detectDevCommand({ scripts: { start: 'react-scripts start' } })).toEqual({
      command: 'npm start',
      url: 'http://localhost:3000',
    });
    expect(detectDevCommand({
      scripts: { dev: 'expo start --web', web: 'expo start --web', start: 'expo start' },
    })).toEqual({
      command: 'npm run web',
      url: 'http://localhost:8081',
    });
  });

  it('falls back to Vite defaults for an unknown or empty project', () => {
    expect(detectDevCommand({ scripts: { dev: 'some-tool' } })).toEqual({
      command: 'npm run dev',
      url: 'http://localhost:5173',
    });
    expect(detectDevCommand(null)).toEqual({ command: 'npm run dev', url: 'http://localhost:5173' });
    expect(detectDevCommand({})).toEqual({ command: 'npm run dev', url: 'http://localhost:5173' });
  });
});

describe('pickInstance', () => {
  const status: DevStatusLike = {
    instances: [
      { pid: 1, url: 'http://localhost:5173', cwd: '/proj/a', state: 'dead' },
      { pid: 2, url: 'http://localhost:5174', cwd: '/proj/b', state: 'running' },
      { pid: 3, url: 'http://localhost:5175', cwd: '/proj/a', state: 'running' },
    ],
  };

  it('prefers the exact running cwd (ignoring a trailing slash)', () => {
    expect(pickInstance(status, '/proj/a')!.pid).toBe(3);
    expect(pickInstance(status, '/proj/a/')!.pid).toBe(3);
  });

  it('falls back to the sole running instance when cwd has none', () => {
    const one: DevStatusLike = {
      instances: [{ pid: 9, url: 'http://localhost:5173', cwd: '/other', state: 'running' }],
    };
    expect(pickInstance(one, '/proj/x')!.pid).toBe(9);
  });

  it('returns null when nothing matches and multiple servers run', () => {
    expect(pickInstance(status, '/proj/z')).toBeNull();
    expect(pickInstance(null, '/proj/a')).toBeNull();
  });
});

describe('statusFromInstance', () => {
  it('latches starting, then reflects the instance state', () => {
    expect(statusFromInstance(null, true)).toBe('starting');
    expect(statusFromInstance(null, false)).toBe('idle');
    expect(
      statusFromInstance({ pid: 1, url: 'u', cwd: '/a', state: 'running' }, false),
    ).toBe('running');
    expect(statusFromInstance({ pid: 1, url: 'u', cwd: '/a', state: 'dead' }, false)).toBe('dead');
  });
});

describe('frameWidth', () => {
  it('desktop fills (0), tablet/mobile clamp', () => {
    expect(frameWidth('desktop')).toBe(0);
    expect(frameWidth('tablet')).toBe(834);
    expect(frameWidth('mobile')).toBe(390);
  });
});

describe('canRenderWebview', () => {
  it('only mounts for a running loopback URL', () => {
    expect(canRenderWebview('running', 'http://localhost:5173')).toBe(true);
    expect(canRenderWebview('running', 'http://127.0.0.1:3000')).toBe(true);
    expect(canRenderWebview('starting', 'http://localhost:5173')).toBe(false);
    expect(canRenderWebview('running', 'http://example.com')).toBe(false);
    expect(canRenderWebview('running', undefined)).toBe(false);
    expect(canRenderWebview('running', 'not a url')).toBe(false);
  });
});
