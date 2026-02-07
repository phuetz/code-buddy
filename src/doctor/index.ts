import { execSync } from 'child_process';
import { existsSync, statfsSync } from 'fs';
import { join } from 'path';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 18) {
    return { name: 'Node.js version', status: 'ok', message: `${process.version} (>= 18 required)` };
  }
  return { name: 'Node.js version', status: 'error', message: `${process.version} — Node.js >= 18 is required` };
}

function checkDependencies(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const required: Array<{ cmd: string; label: string; level: 'error' | 'warn' }> = [
    { cmd: 'rg', label: 'ripgrep (rg)', level: 'warn' },
    { cmd: 'sox', label: 'sox (voice input)', level: 'warn' },
  ];

  for (const dep of required) {
    checks.push({
      name: dep.label,
      status: commandExists(dep.cmd) ? 'ok' : dep.level,
      message: commandExists(dep.cmd) ? 'installed' : 'not found',
    });
  }

  const audioPlayers = ['ffplay', 'aplay', 'mpv'];
  const found = audioPlayers.filter(cmd => commandExists(cmd));
  checks.push({
    name: 'Audio playback',
    status: found.length > 0 ? 'ok' : 'warn',
    message: found.length > 0 ? `available: ${found.join(', ')}` : 'no player found (install ffplay, aplay, or mpv)',
  });

  return checks;
}

function checkApiKeys(): DoctorCheck[] {
  const keys = ['GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'];
  return keys.map(key => ({
    name: `API key: ${key}`,
    status: process.env[key] ? 'ok' as const : 'warn' as const,
    message: process.env[key] ? 'set' : 'not set',
  }));
}

function checkConfigFiles(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const codeBuddyDir = join(cwd, '.codebuddy');
  checks.push({
    name: '.codebuddy directory',
    status: existsSync(codeBuddyDir) ? 'ok' : 'warn',
    message: existsSync(codeBuddyDir) ? 'exists' : 'not found',
  });

  const configFile = join(cwd, '.codebuddy', 'config.json');
  checks.push({
    name: 'config.json',
    status: existsSync(configFile) ? 'ok' : 'warn',
    message: existsSync(configFile) ? 'exists' : 'not found',
  });

  return checks;
}

function checkTtsProviders(): DoctorCheck[] {
  const providers: Array<{ cmd: string; label: string }> = [
    { cmd: 'edge-tts', label: 'edge-tts' },
    { cmd: 'espeak', label: 'espeak' },
  ];

  const found = providers.filter(p => commandExists(p.cmd));
  return [{
    name: 'TTS providers',
    status: found.length > 0 ? 'ok' : 'warn',
    message: found.length > 0 ? `available: ${found.map(p => p.label).join(', ')}` : 'none found (install edge-tts or espeak)',
  }];
}

function checkDiskSpace(cwd: string): DoctorCheck {
  try {
    const stats = statfsSync(cwd);
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = freeBytes / (1024 ** 3);
    if (freeGB < 1) {
      return { name: 'Disk space', status: 'warn', message: `${freeGB.toFixed(2)} GB free (< 1 GB)` };
    }
    return { name: 'Disk space', status: 'ok', message: `${freeGB.toFixed(1)} GB free` };
  } catch {
    return { name: 'Disk space', status: 'warn', message: 'unable to check' };
  }
}

function checkGit(cwd: string): DoctorCheck {
  if (!commandExists('git')) {
    return { name: 'Git', status: 'error', message: 'git not found' };
  }
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return { name: 'Git', status: 'ok', message: 'installed, inside a git repo' };
  } catch {
    return { name: 'Git', status: 'warn', message: 'installed, but not inside a git repo' };
  }
}

export async function runDoctorChecks(cwd?: string): Promise<DoctorCheck[]> {
  const dir = cwd ?? process.cwd();
  return [
    checkNodeVersion(),
    ...checkDependencies(),
    ...checkApiKeys(),
    ...checkConfigFiles(dir),
    ...checkTtsProviders(),
    checkDiskSpace(dir),
    checkGit(dir),
  ];
}
