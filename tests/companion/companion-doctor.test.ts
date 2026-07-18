import {
  doctorInputFromPersonaVoice,
  formatCompanionDoctorReport,
  runCompanionDoctor,
  runLiveCompanionDoctor,
} from '../../src/companion/companion-doctor.js';

describe('companion-doctor', () => {
  const prevRobot = process.env.CODEBUDDY_ROBOT_NAME;
  const prevFallback = process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK;

  afterEach(() => {
    if (prevRobot === undefined) delete process.env.CODEBUDDY_ROBOT_NAME;
    else process.env.CODEBUDDY_ROBOT_NAME = prevRobot;
    if (prevFallback === undefined) delete process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK;
    else process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK = prevFallback;
  });

  it('passes when persona lisa + ROBOT_NAME + long spokenPrompt', () => {
    const report = runCompanionDoctor({
      personaId: 'lisa',
      personaRobotName: 'Lisa',
      spokenPrompt: 'x'.repeat(120),
      robotNameEnv: 'Lisa',
    });
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.severity === 'ok')).toBe(true);
    expect(formatCompanionDoctorReport(report)).toContain('PASS');
  });

  it('errors when ROBOT_NAME is Lisa but persona is debugger without spoken', () => {
    const report = runCompanionDoctor({
      personaId: 'debugger',
      spokenPrompt: '',
      robotNameEnv: 'Lisa',
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.id === 'persona_mismatch' && c.severity === 'error')).toBe(
      true,
    );
    expect(report.checks.some((c) => c.id === 'spoken_prompt' && c.severity === 'error')).toBe(
      true,
    );
    expect(formatCompanionDoctorReport(report)).toContain('FAIL');
  });

  it('warns when spoken is borrowed from lisa on a non-lisa persona', () => {
    const report = runCompanionDoctor({
      personaId: 'debugger',
      spokenPrompt: 'Je suis Lisa, ta petite amie exclusive et code buddy. '.repeat(5),
      robotNameEnv: 'Lisa',
      borrowedLisaSpoken: true,
    });
    expect(report.ok).toBe(true);
    expect(report.checks.some((c) => c.id === 'persona_borrow' && c.severity === 'warn')).toBe(
      true,
    );
  });

  it('doctorInputFromPersonaVoice detects borrow heuristic', () => {
    const input = doctorInputFromPersonaVoice(
      {
        personaId: 'debugger',
        robotName: 'Lisa',
        spokenPrompt: 'Lisa petite amie exclusive code-buddy character spine. '.repeat(8),
      },
      { CODEBUDDY_ROBOT_NAME: 'Lisa' },
    );
    expect(input.borrowedLisaSpoken).toBe(true);
    expect(input.robotNameEnv).toBe('Lisa');
  });

  it('runLiveCompanionDoctor uses injected getVoice and never throws', async () => {
    const report = await runLiveCompanionDoctor(async () => ({
      personaId: 'lisa',
      robotName: 'Lisa',
      spokenPrompt: 'y'.repeat(100),
    }), { CODEBUDDY_ROBOT_NAME: 'Lisa' });
    expect(report.ok).toBe(true);

    const crashed = await runLiveCompanionDoctor(async () => {
      throw new Error('boom');
    });
    expect(crashed.ok).toBe(false);
    expect(crashed.checks[0]?.id).toBe('doctor_crash');
  });
});
