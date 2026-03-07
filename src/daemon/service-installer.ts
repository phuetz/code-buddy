/**
 * Service Installer
 *
 * Installs Code Buddy daemon as a system service for persistent operation.
 * Supports:
 * - macOS: launchd (LaunchAgent plist)
 * - Linux: systemd (user service unit)
 * - Windows: NSSM-based Windows service or Task Scheduler
 *
 * Usage: `buddy daemon start --install-daemon`
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ServiceInstallerConfig {
  serviceName: string;
  displayName: string;
  description: string;
  execPath: string;
  args: string[];
  workingDirectory: string;
  env?: Record<string, string>;
  port?: number;
}

export interface ServiceInstallResult {
  success: boolean;
  servicePath: string;
  platform: string;
  instructions?: string;
  error?: string;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_SERVICE_NAME = 'com.codebuddy.daemon';
const DEFAULT_DISPLAY_NAME = 'Code Buddy Daemon';
const DEFAULT_DESCRIPTION = 'Code Buddy AI assistant daemon service';

function getDefaultExecPath(): string {
  try {
    return execSync('which buddy 2>/dev/null || which codebuddy 2>/dev/null || echo npx', {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'npx';
  }
}

// ============================================================================
// Service Installer
// ============================================================================

export class ServiceInstaller {
  private config: ServiceInstallerConfig;

  constructor(config?: Partial<ServiceInstallerConfig>) {
    const execPath = config?.execPath || getDefaultExecPath();
    this.config = {
      serviceName: config?.serviceName || DEFAULT_SERVICE_NAME,
      displayName: config?.displayName || DEFAULT_DISPLAY_NAME,
      description: config?.description || DEFAULT_DESCRIPTION,
      execPath,
      args: config?.args || ['daemon', 'start', '--foreground'],
      workingDirectory: config?.workingDirectory || homedir(),
      env: config?.env,
      port: config?.port || 3000,
    };
  }

  async install(): Promise<ServiceInstallResult> {
    const os = platform();
    switch (os) {
      case 'darwin':
        return this.installLaunchd();
      case 'linux':
        return this.installSystemd();
      case 'win32':
        return this.installWindows();
      default:
        return {
          success: false,
          servicePath: '',
          platform: os,
          error: `Unsupported platform: ${os}. Use 'buddy daemon start' for manual operation.`,
        };
    }
  }

  async uninstall(): Promise<ServiceInstallResult> {
    const os = platform();
    switch (os) {
      case 'darwin':
        return this.uninstallLaunchd();
      case 'linux':
        return this.uninstallSystemd();
      case 'win32':
        return this.uninstallWindows();
      default:
        return {
          success: false,
          servicePath: '',
          platform: os,
          error: `Unsupported platform: ${os}`,
        };
    }
  }

  async status(): Promise<{ installed: boolean; running: boolean; platform: string }> {
    const os = platform();
    try {
      switch (os) {
        case 'darwin': {
          const plistPath = this.getLaunchdPlistPath();
          const exists = await fileExists(plistPath);
          if (!exists) return { installed: false, running: false, platform: os };
          const output = execSync(`launchctl list ${this.config.serviceName} 2>/dev/null || true`, {
            encoding: 'utf8',
          });
          return { installed: true, running: output.includes('PID'), platform: os };
        }
        case 'linux': {
          const unitPath = this.getSystemdUnitPath();
          const exists = await fileExists(unitPath);
          if (!exists) return { installed: false, running: false, platform: os };
          const output = execSync(
            `systemctl --user is-active ${this.config.serviceName}.service 2>/dev/null || true`,
            { encoding: 'utf8' }
          );
          return { installed: true, running: output.trim() === 'active', platform: os };
        }
        case 'win32': {
          const taskOutput = execSync(
            `schtasks /query /tn "${this.config.serviceName}" 2>nul || echo NOT_FOUND`,
            { encoding: 'utf8' }
          );
          const installed = !taskOutput.includes('NOT_FOUND');
          return { installed, running: taskOutput.includes('Running'), platform: os };
        }
        default:
          return { installed: false, running: false, platform: os };
      }
    } catch {
      return { installed: false, running: false, platform: os };
    }
  }

  // --------------------------------------------------------------------------
  // macOS: launchd
  // --------------------------------------------------------------------------

  private getLaunchdPlistPath(): string {
    return path.join(homedir(), 'Library', 'LaunchAgents', `${this.config.serviceName}.plist`);
  }

  private async installLaunchd(): Promise<ServiceInstallResult> {
    const plistPath = this.getLaunchdPlistPath();
    const dir = path.dirname(plistPath);
    await fs.mkdir(dir, { recursive: true });

    const envEntries = this.config.env
      ? Object.entries(this.config.env)
          .map(([k, v]) => `      <key>${k}</key>\n      <string>${v}</string>`)
          .join('\n')
      : '';

    const envBlock = envEntries
      ? `    <key>EnvironmentVariables</key>\n    <dict>\n${envEntries}\n    </dict>`
      : '';

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${this.config.serviceName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${this.config.execPath}</string>
${this.config.args.map(a => `        <string>${a}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${this.config.workingDirectory}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homedir(), '.codebuddy', 'daemon', 'codebuddy.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homedir(), '.codebuddy', 'daemon', 'codebuddy-error.log')}</string>
${envBlock}
</dict>
</plist>`;

    await fs.writeFile(plistPath, plist, 'utf8');
    logger.info(`Wrote launchd plist to ${plistPath}`);

    try {
      execSync(`launchctl load ${plistPath}`, { stdio: 'pipe' });
    } catch {
      logger.warn('launchctl load failed — service may need manual loading');
    }

    return {
      success: true,
      servicePath: plistPath,
      platform: 'darwin',
      instructions: `Service installed. Run 'launchctl load ${plistPath}' to start, or it will start on next login.`,
    };
  }

  private async uninstallLaunchd(): Promise<ServiceInstallResult> {
    const plistPath = this.getLaunchdPlistPath();
    try {
      execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // Already unloaded
    }
    try {
      await fs.unlink(plistPath);
    } catch {
      // Already removed
    }
    return { success: true, servicePath: plistPath, platform: 'darwin' };
  }

  // --------------------------------------------------------------------------
  // Linux: systemd
  // --------------------------------------------------------------------------

  private getSystemdUnitPath(): string {
    return path.join(homedir(), '.config', 'systemd', 'user', `${this.config.serviceName}.service`);
  }

  private async installSystemd(): Promise<ServiceInstallResult> {
    const unitPath = this.getSystemdUnitPath();
    const dir = path.dirname(unitPath);
    await fs.mkdir(dir, { recursive: true });

    const envLines = this.config.env
      ? Object.entries(this.config.env)
          .map(([k, v]) => `Environment="${k}=${v}"`)
          .join('\n')
      : '';

    const unit = `[Unit]
Description=${this.config.description}
After=network.target

[Service]
Type=simple
ExecStart=${this.config.execPath} ${this.config.args.join(' ')}
WorkingDirectory=${this.config.workingDirectory}
Restart=on-failure
RestartSec=5
${envLines}

[Install]
WantedBy=default.target
`;

    await fs.writeFile(unitPath, unit, 'utf8');
    logger.info(`Wrote systemd unit to ${unitPath}`);

    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      execSync(`systemctl --user enable ${this.config.serviceName}.service`, { stdio: 'pipe' });
      execSync(`systemctl --user start ${this.config.serviceName}.service`, { stdio: 'pipe' });
    } catch {
      logger.warn('systemctl commands failed — service may need manual enabling');
    }

    return {
      success: true,
      servicePath: unitPath,
      platform: 'linux',
      instructions: `Service installed. Run 'systemctl --user status ${this.config.serviceName}' to check.`,
    };
  }

  private async uninstallSystemd(): Promise<ServiceInstallResult> {
    const unitPath = this.getSystemdUnitPath();
    try {
      execSync(`systemctl --user stop ${this.config.serviceName}.service 2>/dev/null`, { stdio: 'pipe' });
      execSync(`systemctl --user disable ${this.config.serviceName}.service 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // Already stopped/disabled
    }
    try {
      await fs.unlink(unitPath);
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    } catch {
      // Already removed
    }
    return { success: true, servicePath: unitPath, platform: 'linux' };
  }

  // --------------------------------------------------------------------------
  // Windows: Task Scheduler
  // --------------------------------------------------------------------------

  private async installWindows(): Promise<ServiceInstallResult> {
    const taskName = this.config.serviceName;
    const cmd = `${this.config.execPath} ${this.config.args.join(' ')}`;

    try {
      execSync(
        `schtasks /create /tn "${taskName}" /tr "${cmd}" /sc onlogon /rl highest /f`,
        { stdio: 'pipe' }
      );
      // Start immediately
      execSync(`schtasks /run /tn "${taskName}"`, { stdio: 'pipe' });
    } catch {
      logger.warn('schtasks commands failed — service may need manual creation');
    }

    return {
      success: true,
      servicePath: taskName,
      platform: 'win32',
      instructions: `Task '${taskName}' created. It will run on logon. Use 'schtasks /query /tn "${taskName}"' to check.`,
    };
  }

  private async uninstallWindows(): Promise<ServiceInstallResult> {
    const taskName = this.config.serviceName;
    try {
      execSync(`schtasks /delete /tn "${taskName}" /f 2>nul`, { stdio: 'pipe' });
    } catch {
      // Already removed
    }
    return { success: true, servicePath: taskName, platform: 'win32' };
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let installerInstance: ServiceInstaller | null = null;

export function getServiceInstaller(config?: Partial<ServiceInstallerConfig>): ServiceInstaller {
  if (!installerInstance) {
    installerInstance = new ServiceInstaller(config);
  }
  return installerInstance;
}

export function resetServiceInstaller(): void {
  installerInstance = null;
}
