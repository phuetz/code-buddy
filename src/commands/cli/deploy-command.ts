/**
 * Deploy Command
 *
 * Generate deployment configurations for cloud platforms, plus one-click
 * static/build publish (Cloudflare Pages, Netlify) in dry-run by default.
 *
 * Usage:
 *   buddy deploy run [dir]           # Simulate (default) or --apply
 *   buddy deploy init <platform>     # Generate deployment config
 *   buddy deploy platforms           # List supported platforms
 *   buddy deploy nix                 # Generate Nix flake configs
 */

import type { Command } from 'commander';
import type { OneClickDeps, OneClickReport } from '../../deploy/one-click-types.js';

export interface RegisterDeployCommandsOptions {
  write?: (msg: string) => void;
  writeErr?: (msg: string) => void;
  runOneClick?: (
    request: { projectRoot: string; apply?: boolean; dryRun?: boolean },
    deps?: OneClickDeps,
  ) => Promise<OneClickReport>;
}

export function registerDeployCommands(
  program: Command,
  options: RegisterDeployCommandsOptions = {},
): void {
  const write = options.write ?? ((msg: string) => {
    process.stdout.write(`${msg}\n`);
  });
  const writeErr = options.writeErr ?? ((msg: string) => {
    process.stderr.write(`${msg}\n`);
  });

  const deploy = program
    .command('deploy')
    .description('One-click web publish (dry-run by default) and cloud config generators');

  deploy
    .command('run')
    .description('Build and publish a static/build web project (simulation by default; nothing is sent)')
    .argument('[dir]', 'Project directory', '.')
    .option('--dry-run', 'Show the exact plan without uploading (default)')
    .option('--apply', 'Really upload (requires .codebuddy/deploy.json target + official CLI + token)')
    .option('--json', 'Print the report as JSON (secrets never included)')
    .action(async (dir: string, opts: { dryRun?: boolean; apply?: boolean; json?: boolean }) => {
      const { runOneClickDeploy, formatOneClickReport } = await import('../../deploy/one-click-engine.js');
      const runner = options.runOneClick ?? runOneClickDeploy;
      const dryRun = opts.apply !== true || opts.dryRun === true;
      const report = await runner({
        projectRoot: dir,
        apply: !dryRun,
        dryRun,
      });
      if (opts.json) {
        write(JSON.stringify(report, null, 2));
      } else {
        write(formatOneClickReport(report));
      }
      if (!report.ok) {
        writeErr(report.error ?? 'Deploy failed');
        process.exitCode = 1;
      }
    });

  deploy
    .command('platforms')
    .description('List supported cloud platforms')
    .action(() => {
      write('\nOne-click web publish (buddy deploy run) — target in .codebuddy/deploy.json:\n');
      write('  cloudflare-pages   Cloudflare Pages via wrangler (if already installed)');
      write('  netlify            Netlify via netlify-cli (if already installed)');
      write('\nConfig generators (buddy deploy init) — not an upload:\n');
      write('  fly         Fly.io — globally distributed apps');
      write('  railway     Railway — instant deployments');
      write('  render      Render — zero-config cloud');
      write('  hetzner     Hetzner Cloud — European VPS');
      write('  northflank  Northflank — Kubernetes PaaS');
      write('  gcp         Google Cloud Platform');
      write('  nix         Nix flake — declarative installation');
      write('\nUsage: buddy deploy run [--apply]   |   buddy deploy init <platform>');
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
