import {
  buildCompanionLiveBrief,
  buildCompanionListenCheck,
  formatCompanionListenCheck,
  formatCompanionLiveBrief,
  formatCompanionStatus,
  getCompanionStatus,
  parseAlsaCaptureDevices,
  recordCompanionSelfState,
  selectPreferredAlsaCaptureDevice,
  setupCompanionMode,
} from '../src/companion/companion-mode.js';
import type { CompanionLiveRuntime } from '../src/companion/companion-mode.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const identity = {
    load: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const voiceInput = {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    isAvailable: vi.fn(),
  };
  const tts = {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    isAvailable: vi.fn(),
  };
  const hasCodexCredentials = vi.fn();
  const settings = {
    setCurrentModel: vi.fn(),
    getCurrentModel: vi.fn(),
  };
  const checkCameraAvailability = vi.fn();
  return { identity, voiceInput, tts, hasCodexCredentials, settings, checkCameraAvailability };
});

jest.mock('../src/identity/identity-manager.js', () => ({
  getIdentityManager: jest.fn(() => mocks.identity),
}));

jest.mock('../src/input/voice-input-enhanced.js', () => ({
  getVoiceInputManager: jest.fn(() => mocks.voiceInput),
}));

jest.mock('../src/input/text-to-speech.js', () => ({
  getTTSManager: jest.fn(() => mocks.tts),
}));

jest.mock('../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: mocks.hasCodexCredentials,
  getCodexAuthFilePath: jest.fn(() => '/home/test/.codebuddy/codex-auth.json'),
}));

jest.mock('../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn(() => mocks.settings),
}));

jest.mock('../src/companion/camera.js', () => ({
  checkCameraAvailability: mocks.checkCameraAvailability,
}));

describe('companion-mode', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;
  const envKeys = [
    'CODEBUDDY_SENSORY',
    'CODEBUDDY_SENSORY_CAMERA',
    'CODEBUDDY_SENSORY_TOKEN',
    'CODEBUDDY_SENSORY_SPEECH',
    'CODEBUDDY_SENSORY_SPEAK',
    'CODEBUDDY_SENSORY_SPEAK_ACT',
    'CODEBUDDY_SENSORY_SPEAK_MODEL',
    'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE',
    'CODEBUDDY_SENSORY_CHIME_IN',
    'CODEBUDDY_SENSORY_ALWAYS_RESPOND',
    'CODEBUDDY_ROBOT_NAME',
    'CODEBUDDY_SENSORY_GREET',
    'CODEBUDDY_COMPANION_PRESENCE',
    'CODEBUDDY_COMPANION_IDLE',
    'CODEBUDDY_REMINDERS',
    'CODEBUDDY_TTS_VOICE',
    'CODEBUDDY_TTS_PIPER_MODEL',
    'CODEBUDDY_PIPER_BIN',
    'COWORK_PIPER_BIN',
    'CODEBUDDY_SPEECH_PYTHON',
    'CODEBUDDY_SPEECH_ENGINE',
    'CODEBUDDY_SPEECH_MODEL',
    'CODEBUDDY_SPEECH_LANG',
    'CODEBUDDY_PARAKEET_MODEL_DIR',
    'CODEBUDDY_COMPANION_AUDIO_DIR',
    'CODEBUDDY_VOICE_PYTHON',
    'COWORK_VOICE_PYTHON',
    'CODEBUDDY_PYTHON_BIN',
    'CODEBUDDY_VOICE_TO_TELEGRAM',
    'CODEBUDDY_SENSORY_ALERT_TOKEN',
    'CODEBUDDY_SENSORY_ALERT_CHAT',
    'CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT',
    'BUDDY_VISION_YOLO_MODEL',
    'BUDDY_VISION_PERSON_BACKEND',
    'BUDDY_VISION_PYTHON',
    'CODEBUDDY_YOLO_MODEL',
    'CODEBUDDY_YOLO_PYTHON',
    'CODEBUDDY_VISION_PYTHON',
    'BUDDY_SENSE_TOKEN',
    'BUDDY_SENSE_BRIDGE_URL',
    'BUDDY_SENSE_CAMERA_INDEX',
    'BUDDY_EAR_PYTHON',
    'BUDDY_EAR_DEVICE',
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    process.env.CODEBUDDY_ROBOT_NAME = 'Buddy';
    mocks.identity.load.mockResolvedValue([]);
    mocks.identity.get.mockReturnValue(undefined);
    mocks.identity.set.mockResolvedValue(undefined);
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: false,
      provider: 'system',
      language: 'en',
      hotkey: 'ctrl+shift+v',
      autoSend: false,
    });
    mocks.voiceInput.isAvailable.mockResolvedValue({ available: true });
    mocks.tts.getConfig.mockReturnValue({
      enabled: false,
      provider: 'edge-tts',
      voice: undefined,
      autoSpeak: false,
    });
    mocks.tts.isAvailable.mockResolvedValue({ available: true });
    mocks.hasCodexCredentials.mockReturnValue(true);
    mocks.settings.getCurrentModel.mockReturnValue('gpt-5.5');
    mocks.checkCameraAvailability.mockResolvedValue({
      available: true,
      ffmpegAvailable: true,
      platform: 'linux',
      commandPreview: 'ffmpeg ...',
    });
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-companion-mode-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  function createReadyLiveRuntime(): CompanionLiveRuntime {
    return {
      exists: vi.fn((candidate: string) => (
        candidate.endsWith(path.join('buddy-vision', 'watch.py'))
        || candidate.endsWith(path.join('buddy-vision', 'ear.py'))
        || candidate.endsWith('.onnx')
      )),
      checkPythonModule: vi.fn().mockResolvedValue(true),
      commandExists: vi.fn().mockResolvedValue(true),
    };
  }

  it('installs identity, configures voice, and sets the project model when ChatGPT OAuth exists', async () => {
    const result = await setupCompanionMode({ cwd: '/repo' });

    expect(mocks.identity.load).toHaveBeenCalledWith('/repo');
    expect(mocks.identity.set).toHaveBeenCalledWith('SOUL.md', expect.stringContaining('Buddy Companion'));
    expect(mocks.identity.set).toHaveBeenCalledWith('BOOT.md', expect.stringContaining('Buddy Companion Boot'));
    expect(mocks.voiceInput.setConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      autoSend: true,
    }));
    expect(mocks.tts.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      provider: 'edge-tts',
      autoSpeak: true,
    }));
    expect(mocks.settings.setCurrentModel).toHaveBeenCalledWith('gpt-5.6-sol');
    expect(result.modelConfigured).toBe(true);
  });

  it('installs Lisa identity when the companion robot name is Lisa', async () => {
    process.env.CODEBUDDY_ROBOT_NAME = 'Lisa';

    await setupCompanionMode({ cwd: '/repo', configureVoice: false, configureModel: false });

    expect(mocks.identity.set).toHaveBeenCalledWith('SOUL.md', expect.stringContaining('Lisa Companion'));
    expect(mocks.identity.set).toHaveBeenCalledWith('BOOT.md', expect.stringContaining('Lisa Companion Boot'));
  });

  it('does not replace existing identity or set the model when disabled', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: 'Existing identity',
    }));
    mocks.hasCodexCredentials.mockReturnValue(false);

    const result = await setupCompanionMode({
      cwd: '/repo',
      configureVoice: false,
      configureModel: false,
    });

    expect(mocks.identity.set).not.toHaveBeenCalled();
    expect(mocks.voiceInput.setConfig).not.toHaveBeenCalled();
    expect(mocks.tts.updateConfig).not.toHaveBeenCalled();
    expect(mocks.settings.setCurrentModel).not.toHaveBeenCalled();
    expect(result.skippedSoul).toBe(true);
    expect(result.skippedBoot).toBe(true);
    expect(result.modelConfigured).toBe(false);
  });

  it('formats readiness with actionable next steps', async () => {
    mocks.hasCodexCredentials.mockReturnValue(false);
    mocks.voiceInput.isAvailable.mockResolvedValue({
      available: false,
      reason: 'Missing sox',
    });
    mocks.tts.isAvailable.mockResolvedValue({
      available: false,
      reason: 'edge-tts not found',
    });
    mocks.checkCameraAvailability.mockResolvedValue({
      available: false,
      ffmpegAvailable: false,
      platform: 'linux',
      reason: 'ffmpeg missing',
    });

    const status = await getCompanionStatus({ cwd: '/repo' });
    const output = formatCompanionStatus(status);

    expect(output).toContain('Buddy Companion Status');
    expect(output).toContain('ChatGPT OAuth credentials missing');
    expect(output).toContain('Run `buddy login`');
    expect(output).toContain('Voice input setup: Missing sox');
    expect(output).toContain('TTS setup: edge-tts not found');
    expect(output).toContain('Camera setup: ffmpeg missing');
  });

  it('records the companion self-state as a self percept', async () => {
    const percept = await recordCompanionSelfState({ cwd: tempDir });

    expect(percept.modality).toBe('self');
    expect(percept.source).toBe('companion_status');
    expect(percept.summary).toContain('Buddy self-state recorded');
    expect(percept.payload).toMatchObject({
      model: 'gpt-5.5',
      chatGptCredentialsPresent: true,
      cameraReady: true,
    });
  });

  it('builds a live companion brief without recording when requested', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Buddy Companion' : 'Buddy Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      hotkey: 'ctrl+shift+v',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'shared-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_ACT = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'auto';
    process.env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE = 'plan';
    process.env.CODEBUDDY_SENSORY_CHIME_IN = 'true';
    process.env.CODEBUDDY_ROBOT_NAME = 'Buddy';
    process.env.CODEBUDDY_SPEECH_PYTHON = '/tmp/voice/bin/python';
    process.env.CODEBUDDY_SPEECH_ENGINE = 'parakeet';
    process.env.CODEBUDDY_SPEECH_MODEL = 'base';
    process.env.CODEBUDDY_SPEECH_LANG = 'fr';
    process.env.CODEBUDDY_PARAKEET_MODEL_DIR = path.join(tempDir, 'parakeet');
    process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE = path.join(tempDir, 'speech-hotwords.txt');
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    process.env.CODEBUDDY_COMPANION_PRESENCE = 'true';
    process.env.CODEBUDDY_COMPANION_IDLE = 'true';
    process.env.CODEBUDDY_REMINDERS = 'true';
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = tempDir;
    process.env.BUDDY_VISION_YOLO_MODEL = path.join(tempDir, 'missing.onnx');
    process.env.BUDDY_VISION_PERSON_BACKEND = 'mediapipe';
    process.env.BUDDY_VISION_PYTHON = '/tmp/vision/bin/python';
    process.env.BUDDY_SENSE_TOKEN = 'shared-secret';
    process.env.BUDDY_SENSE_BRIDGE_URL = 'ws://127.0.0.1:8129';
    process.env.BUDDY_SENSE_CAMERA_INDEX = '1';
    process.env.BUDDY_EAR_PYTHON = '/tmp/ear/bin/python';
    process.env.BUDDY_EAR_DEVICE = 'plughw:test';

    const brief = await buildCompanionLiveBrief({
      cwd: tempDir,
      record: false,
      runtime: createReadyLiveRuntime(),
    });
    const output = formatCompanionLiveBrief(brief);

    expect(brief.perceptId).toBeUndefined();
    expect(brief.readinessScore).toBe(100);
    expect(output).toContain('Buddy Companion Live Brief');
    expect(output).toContain('buddy server');
    expect(output).toContain('CODEBUDDY_SENSORY_CAMERA=true');
    expect(output).toContain('CODEBUDDY_ROBOT_NAME=Buddy');
    expect(output).toContain('CODEBUDDY_SENSORY_SPEAK_ACT=true');
    expect(output).toContain('CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default');
    expect(output).toContain('CODEBUDDY_SPEECH_PYTHON=/tmp/voice/bin/python');
    expect(output).toContain('CODEBUDDY_SPEECH_ENGINE=parakeet');
    expect(output).toContain(`CODEBUDDY_PARAKEET_MODEL_DIR=${path.join(tempDir, 'parakeet')}`);
    expect(output).toContain('CODEBUDDY_SPEECH_MODEL=base');
    expect(output).toContain('CODEBUDDY_SPEECH_LANG=fr');
    expect(output).toContain(`CODEBUDDY_SPEECH_HOTWORDS_FILE=${path.join(tempDir, 'speech-hotwords.txt')}`);
    expect(output).toContain('CODEBUDDY_PIPER_BIN=piper');
    expect(output).toContain('Voice assistant behavior');
    expect(output).toContain('/tmp/ear/bin/python buddy-vision/ear.py');
    expect(output).toContain('BUDDY_SENSE_CAMERA_INDEX=1');
    expect(output).toContain('/tmp/vision/bin/python buddy-vision/watch.py');
    expect(output).toContain('Fleet read-only tools');
    expect(output).not.toContain('shared-secret');
  });

  it('uses the resolved assistant name in the live brief title and launch command', async () => {
    process.env.CODEBUDDY_ROBOT_NAME = 'Lisa';
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Lisa Companion' : 'Lisa Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'shared-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_CHIME_IN = 'true';
    process.env.BUDDY_SENSE_TOKEN = 'shared-secret';
    process.env.BUDDY_VISION_PERSON_BACKEND = 'mediapipe';

    const brief = await buildCompanionLiveBrief({
      cwd: tempDir,
      record: false,
      runtime: createReadyLiveRuntime(),
    });
    const output = formatCompanionLiveBrief(brief);

    expect(brief.assistantName).toBe('Lisa');
    expect(output).toContain('Lisa Companion Live Brief');
    expect(output).toContain('CODEBUDDY_ROBOT_NAME=Lisa');
  });

  it('checks the latest real companion WAV path and evaluates the Lisa response gate', async () => {
    process.env.CODEBUDDY_ROBOT_NAME = 'Lisa';
    process.env.CODEBUDDY_SPEECH_ENGINE = 'parakeet';
    process.env.CODEBUDDY_PARAKEET_MODEL_DIR = path.join(tempDir, 'parakeet');
    process.env.CODEBUDDY_SPEECH_MODEL = 'base';
    process.env.CODEBUDDY_SPEECH_LANG = 'fr';
    process.env.CODEBUDDY_SPEECH_PYTHON = '/tmp/voice/bin/python';
    const wav = path.join(tempDir, 'utt-1.wav');
    await writeFile(wav, Buffer.from('RIFF test wav placeholder'));
    let now = 1000;

    const check = await buildCompanionListenCheck({
      cwd: tempDir,
      wav,
      transcribe: async () => 'Lisa, tu m entends ?',
      now: () => {
        now += 250;
        return now;
      },
    });
    const output = formatCompanionListenCheck(check);

    expect(check.ok).toBe(true);
    expect(check.transcript).toBe('Lisa, tu m entends ?');
    expect(check.sttMs).toBe(250);
    expect(check.decision).toEqual({ respond: true, reason: 'addressed' });
    expect(output).toContain('Lisa Listen Check');
    expect(output).toContain('Parakeet/sherpa-onnx (fr)');
    expect(output).toContain(`Parakeet model: ${path.join(tempDir, 'parakeet')}`);
    expect(output).toContain('Response gate: respond (addressed)');
  });

  it('prefers webcam microphones when parsing ALSA capture devices', () => {
    const output = [
      'card 0: PCH [HDA Intel PCH], device 0: ALC Analog [ALC Analog]',
      'card 1: Monitor [HDMI Monitor], device 0: HDMI Audio [HDMI Audio]',
      'card 2: BRIO [Logitech BRIO], device 0: USB Audio [USB Audio]',
    ].join('\n');

    const devices = parseAlsaCaptureDevices(output);
    const selected = selectPreferredAlsaCaptureDevice(output);

    expect(devices).toHaveLength(3);
    expect(selected?.alsaDevice).toBe('plughw:CARD=BRIO,DEV=0');
    expect(selected?.score).toBeGreaterThan(devices[0]!.score);
  });

  it('marks the live brief not ready when the vision sidecar cannot import websocket-client', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Buddy Companion' : 'Buddy Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      hotkey: 'ctrl+shift+v',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'shared-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_CHIME_IN = 'true';
    process.env.BUDDY_SENSE_TOKEN = 'shared-secret';
    process.env.BUDDY_VISION_PERSON_BACKEND = 'yolo';
    process.env.BUDDY_VISION_YOLO_MODEL = path.join(tempDir, 'yolov8n.onnx');
    process.env.BUDDY_VISION_PYTHON = '/tmp/vision/bin/python';

    const runtime: CompanionLiveRuntime = {
      exists: vi.fn((candidate: string) => (
        candidate.endsWith(path.join('buddy-vision', 'watch.py'))
        || candidate.endsWith(path.join('buddy-vision', 'ear.py'))
        || candidate.endsWith('yolov8n.onnx')
        || candidate.endsWith('.onnx')
      )),
      checkPythonModule: vi.fn(async (_pythonCommand: string, moduleName: string) => moduleName !== 'websocket'),
      commandExists: vi.fn().mockResolvedValue(true),
    };

    const brief = await buildCompanionLiveBrief({ cwd: tempDir, record: false, runtime });
    const sidecar = brief.capabilities.find(capability => capability.id === 'vision_sidecar');
    const output = formatCompanionLiveBrief(brief);

    expect(brief.ready).toBe(false);
    expect(sidecar?.ready).toBe(false);
    expect(sidecar?.detail).toContain('websocket-client missing');
    expect(output).toContain('websocket-client');
  });

  it('marks the live brief not ready when camera bridge tokens do not match', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Buddy Companion' : 'Buddy Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      hotkey: 'ctrl+shift+v',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'server-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_CHIME_IN = 'true';
    process.env.BUDDY_SENSE_TOKEN = 'sidecar-secret';
    process.env.BUDDY_VISION_PERSON_BACKEND = 'mediapipe';

    const brief = await buildCompanionLiveBrief({
      cwd: tempDir,
      record: false,
      runtime: createReadyLiveRuntime(),
    });
    const bridge = brief.capabilities.find(capability => capability.id === 'sensory_camera_auth');
    const output = formatCompanionLiveBrief(brief);

    expect(brief.ready).toBe(false);
    expect(bridge?.ready).toBe(false);
    expect(bridge?.detail).toContain('do not match');
    expect(output).toContain('Sensory camera auth');
  });

  it('marks the live brief not ready when the microphone ear or STT is unavailable', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Buddy Companion' : 'Buddy Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      hotkey: 'ctrl+shift+v',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'shared-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_ACT = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE = 'plan';
    process.env.BUDDY_SENSE_TOKEN = 'shared-secret';
    process.env.BUDDY_VISION_PERSON_BACKEND = 'mediapipe';
    process.env.BUDDY_EAR_PYTHON = '/tmp/ear/bin/python';
    process.env.CODEBUDDY_SPEECH_PYTHON = '/tmp/voice/bin/python';

    const runtime: CompanionLiveRuntime = {
      exists: vi.fn((candidate: string) => candidate.endsWith(path.join('buddy-vision', 'watch.py'))),
      checkPythonModule: vi.fn(async (_pythonCommand: string, moduleName: string) => (
        moduleName !== 'faster_whisper'
      )),
      commandExists: vi.fn(async (command: string) => command !== 'arecord'),
    };

    const brief = await buildCompanionLiveBrief({
      cwd: tempDir,
      record: false,
      runtime,
    });
    const assistant = brief.capabilities.find(capability => capability.id === 'voice_assistant');
    const output = formatCompanionLiveBrief(brief);

    expect(brief.ready).toBe(false);
    expect(assistant?.ready).toBe(false);
    expect(assistant?.detail).toContain('ear.py');
    expect(assistant?.detail).toContain('arecord');
    expect(assistant?.detail).toContain('faster-whisper');
    expect(output).toContain('Voice assistant behavior');
  });

  it('marks the live brief not ready when voice actions use an unsafe permission posture', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: name === 'SOUL.md' ? 'Buddy Companion' : 'Buddy Companion Boot',
    }));
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: true,
      provider: 'whisper-local',
      language: 'fr',
      hotkey: 'ctrl+shift+v',
      autoSend: true,
    });
    mocks.tts.getConfig.mockReturnValue({
      enabled: true,
      provider: 'piper',
      voice: '/voices/fr.onnx',
      autoSpeak: true,
    });
    process.env.CODEBUDDY_SENSORY = 'true';
    process.env.CODEBUDDY_SENSORY_CAMERA = 'true';
    process.env.CODEBUDDY_SENSORY_TOKEN = 'shared-secret';
    process.env.CODEBUDDY_SENSORY_SPEECH = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_ACT = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE = 'bypassPermissions';
    process.env.CODEBUDDY_SENSORY_CHIME_IN = 'true';
    process.env.BUDDY_SENSE_TOKEN = 'shared-secret';
    process.env.BUDDY_VISION_PERSON_BACKEND = 'mediapipe';

    const brief = await buildCompanionLiveBrief({
      cwd: tempDir,
      record: false,
      runtime: createReadyLiveRuntime(),
    });
    const assistant = brief.capabilities.find(capability => capability.id === 'voice_assistant');
    const output = formatCompanionLiveBrief(brief);

    expect(brief.ready).toBe(false);
    expect(assistant?.ready).toBe(false);
    expect(assistant?.detail).toContain('unsafe');
    expect(output).toContain('Voice assistant behavior');
  });

  it('records the live companion brief as a self percept by default', async () => {
    const brief = await buildCompanionLiveBrief({ cwd: tempDir, runtime: createReadyLiveRuntime() });

    expect(brief.perceptId).toMatch(/^percept-/);
    const output = formatCompanionLiveBrief(brief);
    expect(output).toContain(`Percept recorded: ${brief.perceptId}`);
  });
});
