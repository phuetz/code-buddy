/**
 * Update Command
 *
 * Manages Code Buddy update channels and performs updates.
 * Advanced enterprise architecture for `Native Engine update --channel stable|beta|dev`.
 *
 * Usage:
 *   buddy update                    # Update to latest on current channel
 *   buddy update --channel beta     # Switch to beta channel and update
 *   buddy update --check            # Check for updates without installing
 *   buddy update --channel stable   # Switch back to stable
 *   buddy update --tag main         # Install from GitHub main branch
 *   buddy update --tag v1.2.3       # Install from GitHub tag/branch
 *   buddy update --from-source      # Alias for --tag main
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { gt } from 'semver';
import { logger } from '../utils/logger.js';

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

export interface NpmRegistryRelease {
  packageName: string;
  tag: string;
  version: string;
  date: string;
}

export type NpmRegistryFetcher = typeof fetch;

export interface UpdateCommandDependencies {
  fetch?: NpmRegistryFetcher;
}

interface PackageMetadata {
  name: string;
  version: string;
}

function readPackageMetadata(): PackageMetadata {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as Partial<PackageMetadata>;
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error(`package.json is missing name or version: ${PACKAGE_JSON_PATH}`);
  }
  return { name: packageJson.name, version: packageJson.version };
}

function recordValue(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

/** Read an actual npm dist-tag and its publication timestamp. */
export async function fetchNpmRelease(
  packageName: string,
  tag: string,
  fetchImpl: NpmRegistryFetcher = globalThis.fetch,
): Promise<NpmRegistryRelease> {
  if (!fetchImpl) throw new Error('fetch is unavailable on this Node.js runtime.');
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetchImpl(registryUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }

  const payload = (await response.json()) as {
    'dist-tags'?: unknown;
    time?: unknown;
  };
  const version = recordValue(payload['dist-tags'], tag);
  if (!version) throw new Error(`dist-tag ${tag} is absent from the npm response.`);
  const date = recordValue(payload.time, version);
  if (!date) throw new Error(`publication date for ${version} is absent from the npm response.`);

  return { packageName, tag, version, date };
}

export function createUpdateCommand(dependencies: UpdateCommandDependencies = {}): Command {
  const cmd = new Command('update')
    .description('Update Code Buddy (switch channels: stable, beta, dev)')
    .option('--channel <channel>', 'Switch update channel (stable, beta, dev)')
    .option('--check', 'Check for updates without installing')
    .option('--force', 'Force reinstall even if up-to-date')
    .option('--tag <ref>', 'Install from GitHub ref (branch or tag, e.g. main, v1.2.3)')
    .option('--from-source', 'Alias for --tag main (install from GitHub main branch)')
    .action(async (opts) => {
      // Resolve --from-source alias
      const gitRef = opts.fromSource ? 'main' : opts.tag;

      // GitHub install path — skip channel logic entirely
      if (gitRef) {
        return performGitHubInstall(gitRef);
      }

      const { UpdateChannelManager } = await import('../utils/session-enhancements.js');
      const manager = UpdateChannelManager.getInstance();

      // Switch channel if requested
      if (opts.channel) {
        try {
          manager.setChannel(opts.channel);
          console.log(`Update channel switched to: ${opts.channel}`);
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      }

      const channel = manager.getCurrentChannel();
      console.log(`\nChannel: ${channel}`);

      if (opts.check) {
        try {
          const pkg = readPackageMetadata();
          const npmTag = channel === 'stable' ? 'latest' : channel;
          const release = await fetchNpmRelease(
            pkg.name,
            npmTag,
            dependencies.fetch ?? globalThis.fetch,
          );
          console.log('Registry: npm');
          console.log(`Package: ${release.packageName}`);
          console.log(`Latest:  ${release.version} (${release.date})`);
          console.log(`Current: ${pkg.version}`);
          if (pkg.version === release.version && !opts.force) {
            console.log('Already up-to-date.');
          } else if (gt(pkg.version, release.version)) {
            console.log(`Registry release is older than the current version: ${pkg.version} > ${release.version}`);
          } else {
            console.log(`Update available: ${pkg.version} → ${release.version}`);
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`npm registry unreachable: ${detail}`);
          process.exitCode = 1;
        }
        return;
      }

      // Perform update
      const npmTag = channel === 'stable' ? 'latest' : channel;
      const packageName = readPackageMetadata().name;
      console.log(`\nInstalling ${packageName}@${npmTag}...`);

      try {
        execSync(`npm install -g ${packageName}@${npmTag}`, {
          stdio: 'inherit',
        });
        console.log(`\nUpdate complete. Restart your terminal to use the new version.`);
      } catch (err) {
        logger.error('Update failed', { err });
        console.error('Update failed. Try running with sudo or check your npm permissions.');
        process.exit(1);
      }
    });

  return cmd;
}

const GITHUB_REPO = 'phuetz/code-buddy';

/**
 * Build the npm install command for a GitHub ref.
 * Exported for testing.
 */
export function buildGitHubInstallCommand(ref: string): string {
  return `npm install -g github:${GITHUB_REPO}#${ref}`;
}

/**
 * Install from a GitHub branch or tag.
 */
async function performGitHubInstall(ref: string): Promise<void> {
  const installCmd = buildGitHubInstallCommand(ref);

  console.warn('\n⚠ Installing from GitHub (development install)');
  console.log(`  Ref: ${ref}`);
  console.log(`  Command: ${installCmd}\n`);

  try {
    execSync(installCmd, { stdio: 'inherit' });
    console.log('\nUpdate complete. Restart your terminal to use the new version.');
  } catch (err) {
    logger.error('GitHub install failed', { err });
    console.error('GitHub install failed. Check your network and npm permissions.');
    process.exit(1);
  }
}
