/**
 * Deploy Command
 *
 * Generate deployment configurations for cloud platforms.
 * Inspired by OpenClaw's multi-platform deployment support.
 *
 * Usage:
 *   buddy deploy init <platform>     # Generate deployment config
 *   buddy deploy platforms            # List supported platforms
 *   buddy deploy nix                  # Generate Nix flake configs
 */

import type { Command } from 'commander';

export function registerDeployCommands(program: Command): void {
  const deploy = program
    .command('deploy')
    .description('Generate cloud deployment configurations');

  deploy
    .command('platforms')
    .description('List supported cloud platforms')
    .action(() => {
      console.log('\nSupported Deployment Platforms:\n');
      console.log('  fly         Fly.io — globally distributed apps');
      console.log('  railway     Railway — instant deployments');
      console.log('  render      Render — zero-config cloud');
      console.log('  hetzner     Hetzner Cloud — European VPS');
      console.log('  northflank  Northflank — Kubernetes PaaS');
      console.log('  gcp         Google Cloud Platform');
      console.log('  nix         Nix flake — declarative installation');
      console.log('\nUsage: buddy deploy init <platform> [--name <app-name>] [--port <port>]');
    });

  deploy
    .command('init')
    .description('Generate deployment config for a platform')
    .argument('<platform>', 'Target platform (fly, railway, render, hetzner, northflank, gcp)')
    .option('--name <name>', 'Application name', 'codebuddy')
    .option('--port <port>', 'Service port', '3000')
    .option('--region <region>', 'Deployment region')
    .option('--output <dir>', 'Output directory', '.')
    .action(async (platform, opts) => {
      const { generateDeployConfig, writeDeployConfigs } = await import('../../deploy/cloud-configs.js');

      const result = await writeDeployConfigs(opts.output, {
        platform: platform as import('../../deploy/cloud-configs.js').CloudPlatform,
        appName: opts.name,
        port: parseInt(opts.port, 10),
        region: opts.region,
      });

      if (result.success) {
        console.log(`\nDeployment config generated for ${platform}:`);
        for (const file of result.files) {
          console.log(`  Created: ${file.path}`);
        }
        console.log(`\n${result.instructions}`);
      } else {
        console.error(`Failed: ${result.instructions}`);
        process.exit(1);
      }
    });

  deploy
    .command('nix')
    .description('Generate Nix flake configuration')
    .option('--output <dir>', 'Output directory', '.')
    .action(async (opts) => {
      const { writeNixConfigs } = await import('../../deploy/nix-config.js');
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');

      let version = '0.0.0';
      try {
        const thisDir = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(readFileSync(join(thisDir, '..', '..', '..', 'package.json'), 'utf8'));
        version = pkg.version || version;
      } catch { /* use default */ }

      const result = await writeNixConfigs(opts.output, {
        packageName: 'codebuddy',
        version,
        description: 'Code Buddy AI coding assistant',
        nodeVersion: '22',
      });

      console.log('\nNix configuration generated:');
      console.log(`  Created: ${result.flake}`);
      console.log(`  Created: ${result.defaultNix}`);
      console.log('\nUsage: nix build, nix develop, or nix run');
    });
}
