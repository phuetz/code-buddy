/**
 * Un outil optionnel absent ne doit pas gonfler le compteur de warnings :
 * une machine neuve à qui il ne manque que des outils optionnels est saine,
 * et un contrôle de santé qui lit le total de warnings doit la lire ainsi.
 * (CB22 : « doctor — SoX/ICM optionnels comptés dans le résumé » ENCORE OUVERT.)
 */
import { describe, expect, it } from 'vitest';
import { summarizeDoctorChecks, type DoctorCheck } from '../../src/doctor/index.js';

describe('summarizeDoctorChecks', () => {
  it('classe un optionnel absent comme informatif, pas comme warning', () => {
    const checks: DoctorCheck[] = [
      { name: 'Node.js', status: 'ok', message: 'ok' },
      { name: 'sox', status: 'warn', message: 'not found — optional', optional: true },
      { name: 'ICM', status: 'warn', message: 'not found — optional', optional: true },
    ];
    const summary = summarizeDoctorChecks(checks);
    expect(summary.passed).toBe(1);
    expect(summary.warnings).toBe(0);
    expect(summary.optionalNotInstalled).toBe(2);
    expect(summary.errors).toBe(0);
  });

  it('compte encore les vrais warnings non optionnels', () => {
    const checks: DoctorCheck[] = [
      { name: 'Disk space', status: 'warn', message: '0.5 GB free' },
      { name: 'sox', status: 'warn', message: 'not found — optional', optional: true },
      { name: 'SQLite', status: 'error', message: 'native module missing' },
    ];
    const summary = summarizeDoctorChecks(checks);
    expect(summary.warnings).toBe(1);
    expect(summary.optionalNotInstalled).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.passed).toBe(0);
  });

  it('un optionnel INSTALLÉ (status ok) compte comme passed, pas comme optionnel', () => {
    const checks: DoctorCheck[] = [
      { name: 'sox', status: 'ok', message: 'installed', optional: false },
    ];
    const summary = summarizeDoctorChecks(checks);
    expect(summary.passed).toBe(1);
    expect(summary.optionalNotInstalled).toBe(0);
    expect(summary.warnings).toBe(0);
  });
});
