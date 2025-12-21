import { TrackManager } from '../../src/tracks/track-manager';
import { TrackCommands } from '../../src/tracks/track-commands';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TrackManager', () => {
  let manager: TrackManager;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-test-'));
    manager = new TrackManager(tempDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create context files', async () => {
      await manager.initialize();

      const contextDir = path.join(tempDir, '.codebuddy', 'context');
      expect(fs.existsSync(contextDir)).toBe(true);
      expect(fs.existsSync(path.join(contextDir, 'product.md'))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, 'tech-stack.md'))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, 'guidelines.md'))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, 'workflow.md'))).toBe(true);
    });

    it('should create tracks directory', async () => {
      await manager.initialize();

      const tracksDir = path.join(tempDir, '.codebuddy', 'tracks');
      expect(fs.existsSync(tracksDir)).toBe(true);
    });
  });

  describe('createTrack', () => {
    it('should create a new track with files', async () => {
      const track = await manager.createTrack({
        name: 'Test Feature',
        type: 'feature',
      });

      expect(track.metadata.name).toBe('Test Feature');
      expect(track.metadata.type).toBe('feature');
      expect(track.metadata.status).toBe('planning');

      // Check files exist
      const trackDir = path.join(tempDir, '.codebuddy', 'tracks', track.metadata.id);
      expect(fs.existsSync(trackDir)).toBe(true);
      expect(fs.existsSync(path.join(trackDir, 'spec.md'))).toBe(true);
      expect(fs.existsSync(path.join(trackDir, 'plan.md'))).toBe(true);
      expect(fs.existsSync(path.join(trackDir, 'metadata.json'))).toBe(true);
    });

    it('should generate unique IDs', async () => {
      const track1 = await manager.createTrack({ name: 'Feature 1', type: 'feature' });
      const track2 = await manager.createTrack({ name: 'Feature 2', type: 'feature' });

      expect(track1.metadata.id).not.toBe(track2.metadata.id);
    });
  });

  describe('getTrack', () => {
    it('should retrieve an existing track', async () => {
      const created = await manager.createTrack({ name: 'Get Test', type: 'bugfix' });
      const retrieved = await manager.getTrack(created.metadata.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata.name).toBe('Get Test');
      expect(retrieved?.metadata.type).toBe('bugfix');
    });

    it('should return null for non-existent track', async () => {
      const track = await manager.getTrack('non-existent-id');
      expect(track).toBeNull();
    });
  });

  describe('listTracks', () => {
    it('should list all tracks', async () => {
      await manager.createTrack({ name: 'Track 1', type: 'feature' });
      await manager.createTrack({ name: 'Track 2', type: 'bugfix' });

      const tracks = await manager.listTracks();
      expect(tracks.length).toBe(2);
    });

    it('should filter by status', async () => {
      const track = await manager.createTrack({ name: 'Filter Test', type: 'feature' });
      await manager.updateTrackStatus(track.metadata.id, 'in_progress');

      const planningTracks = await manager.listTracks({ status: 'planning' });
      const inProgressTracks = await manager.listTracks({ status: 'in_progress' });

      expect(planningTracks.length).toBe(0);
      expect(inProgressTracks.length).toBe(1);
    });

    it('should filter by type', async () => {
      await manager.createTrack({ name: 'Feature', type: 'feature' });
      await manager.createTrack({ name: 'Bug', type: 'bugfix' });

      const features = await manager.listTracks({ type: 'feature' });
      const bugs = await manager.listTracks({ type: 'bugfix' });

      expect(features.length).toBe(1);
      expect(bugs.length).toBe(1);
    });
  });

  describe('updateTrackStatus', () => {
    it('should update track status', async () => {
      const track = await manager.createTrack({ name: 'Status Test', type: 'feature' });

      await manager.updateTrackStatus(track.metadata.id, 'in_progress');
      const updated = await manager.getTrack(track.metadata.id);

      expect(updated?.metadata.status).toBe('in_progress');
    });

    it('should throw for non-existent track', async () => {
      await expect(
        manager.updateTrackStatus('fake-id', 'completed')
      ).rejects.toThrow();
    });
  });

  describe('getContextString', () => {
    it('should return empty string when no context files', async () => {
      const context = await manager.getContextString();
      expect(context).toBe('');
    });

    it('should return context after initialization', async () => {
      await manager.initialize();
      const context = await manager.getContextString();

      expect(context).toContain('Product Context');
      expect(context).toContain('Tech Stack');
    });
  });
});

describe('TrackCommands', () => {
  let commands: TrackCommands;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-cmd-test-'));
    commands = new TrackCommands(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('execute', () => {
    it('should handle unknown command', async () => {
      const result = await commands.execute('unknown');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown track command');
    });

    it('should handle status with no tracks', async () => {
      const result = await commands.execute('status');
      expect(result.success).toBe(true);
      expect(result.message).toContain('No tracks found');
    });

    it('should handle new without args', async () => {
      const result = await commands.execute('new');
      expect(result.success).toBe(true);
      expect(result.prompt).toBeDefined();
    });

    it('should create track with name', async () => {
      const result = await commands.execute('new "My Feature"');
      expect(result.success).toBe(true);
      expect(result.track).toBeDefined();
    });

    it('should handle setup', async () => {
      const result = await commands.execute('setup');
      expect(result.success).toBe(true);
      expect(result.message).toContain('initialized');
    });

    it('should list tracks', async () => {
      await commands.execute('new "Test Track"');
      const result = await commands.execute('list');
      expect(result.success).toBe(true);
      expect(result.tracks).toBeDefined();
      expect(result.tracks!.length).toBe(1);
    });
  });
});
