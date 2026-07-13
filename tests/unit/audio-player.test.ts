import { describe, it, expect, vi } from 'vitest';
import { playWavFile, tryPlayWavFile } from '../../src/utils/audio-player.js';
import { execFile } from 'child_process';
import * as os from 'os';

vi.mock('child_process', () => {
  return {
    execFile: vi.fn().mockImplementation((command, args, callback) => {
      callback(null); // Success
    })
  };
});

describe('playWavFile', () => {
  it('should call execFile with the correct platform command', async () => {
    const mockExecFile = execFile as any;
    mockExecFile.mockClear();

    await playWavFile('test-path.wav');

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const commandCalled = mockExecFile.mock.calls[0][0];
    const argsCalled = mockExecFile.mock.calls[0][1];
    const platform = os.platform();

    if (platform === 'win32') {
      expect(commandCalled).toContain('powershell');
      expect(argsCalled).toContain('test-path.wav');
    } else if (platform === 'darwin') {
      expect(commandCalled).toBe('afplay');
      expect(argsCalled).toEqual(['test-path.wav']);
    } else {
      expect(commandCalled).toBe('aplay');
      expect(argsCalled).toEqual(['test-path.wav']);
    }
  });

  it('should pass the wav path as an argument instead of shell-interpolating it', async () => {
    const mockExecFile = execFile as any;
    mockExecFile.mockClear();
    const trickyPath = 'voice"; Remove-Item C:\\important; ".wav';

    await playWavFile(trickyPath);

    const argsCalled = mockExecFile.mock.calls[0][1];
    expect(argsCalled).toContain(trickyPath);
  });

  it('reports whether a platform player successfully played the file', async () => {
    const mockExecFile = execFile as any;
    mockExecFile.mockImplementationOnce((_command: string, _args: string[], callback: Function) => {
      callback(null);
    });

    await expect(tryPlayWavFile('preview.wav')).resolves.toBe(true);
  });

  it('returns false when every platform player fails', async () => {
    const mockExecFile = execFile as any;
    mockExecFile.mockImplementation((_command: string, _args: string[], callback: Function) => {
      callback(new Error('player unavailable'));
    });

    await expect(tryPlayWavFile('preview.wav')).resolves.toBe(false);
  });
});
