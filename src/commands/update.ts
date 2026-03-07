/**
 * Update Command
 *
 * Manages Code Buddy update channels and performs updates.
 * Inspired by OpenClaw's `openclaw update --channel stable|beta|dev`.
 *
 * Usage:
 *   buddy update                    # Update to latest on current channel
 *   buddy update --channel beta     # Switch to beta channel and update
 *   buddy update --check            # Check for updates without installing
 *   buddy update --channel stable   # Switch back to stable
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

export function createUpdateCommand(): Command {
  const cmd = new Command('update')
    .description('Update Code Buddy (switch channels: stable, beta, dev)')
    .option('--channel <channel>', 'Switch update channel (stable, beta, dev)')
    .option('--check', 'Check for updates without installing')
    .option('--force', 'Force reinstall even if up-to-date')
    .action(async (opts) => {
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
      const latest = manager.getLatestVersion(channel);

      console.log(`\nChannel: ${channel}`);
      console.log(`Latest:  ${latest.version} (${latest.date})`);

      if (opts.check) {
        const { readFileSync } = await import('fs');
        const { join, dirname } = await import('path');
        const { fileURLToPath } = await import('url');
        const thisDir = dirname(fileURLToPath(import.meta.url));
        try {
          const pkg = JSON.parse(readFileSync(join(thisDir, '..', '..', 'package.json'), 'utf8'));
          console.log(`Current: ${pkg.version}`);
          if (pkg.version === latest.version && !opts.force) {
            console.log('Already up-to-date.');
          } else {
            console.log(`Update available: ${pkg.version} → ${latest.version}`);
          }
        } catch {
          console.log('Current: unknown');
        }
        return;
      }

      // Perform update
      const npmTag = channel === 'stable' ? 'latest' : channel;
      const packageName = 'codebuddy-cli';
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
