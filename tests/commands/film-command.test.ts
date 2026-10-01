import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFilmCommand } from '../../src/commands/film.js';
import { produceFilm } from '../../src/agent/film/film-producer.js';

vi.mock('../../src/agent/film/film-producer.js', () => ({
  produceFilm: vi.fn().mockResolvedValue({
    success: true,
    warnings: [],
    progress: { total: 0, ready: 0, failed: 0 },
    scenes: []
  })
}));

vi.mock('../../src/agent/film/film-project.js', () => ({
  loadFilmProject: vi.fn().mockResolvedValue({ name: 'f', scenes: [] }),
  filmProjectPath: vi.fn().mockReturnValue('path')
}));

describe('film generate command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('transmits audio.musicVolume === 0 when --music-volume 0 is passed', async () => {
    const cmd = createFilmCommand();
    await cmd.parseAsync(['node', 'x', 'generate', 'f', '--assemble-only', '--music', 'm.mp3', '--music-volume', '0']);
    expect(produceFilm).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({
        musicVolume: 0
      })
    }));
  });

  it('transmits transitionDuration === 0 when --transition-duration 0 is passed', async () => {
    const cmd = createFilmCommand();
    await cmd.parseAsync(['node', 'x', 'generate', 'f', '--assemble-only', '--transition-duration', '0']);
    expect(produceFilm).toHaveBeenCalledWith(expect.objectContaining({
      transitionDuration: 0
    }));
  });

  it('does not add musicVolume or transitionDuration when no option is provided', async () => {
    const cmd = createFilmCommand();
    await cmd.parseAsync(['node', 'x', 'generate', 'f', '--assemble-only']);
    const calls = vi.mocked(produceFilm).mock.calls;
    expect(calls.length).toBe(1);
    const arg = calls[0][0];

    expect(arg.transitionDuration).toBeUndefined();
    if (arg.audio) {
      expect(arg.audio.musicVolume).toBeUndefined();
    }
  });
});
