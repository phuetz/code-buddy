/**
 * Nix Configuration Generator
 *
 * Generates flake.nix and default.nix for declarative Nix-based installation.
 * Inspired by OpenClaw's Nix deployment support.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface NixConfig {
  packageName: string;
  version: string;
  description: string;
  nodeVersion?: string;
}

export function generateFlakeNix(config: NixConfig): string {
  const nodeVersion = config.nodeVersion || '22';

  return `{
  description = "${config.description}";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.\${system};
        nodejs = pkgs.nodejs_${nodeVersion};
      in {
        packages.default = pkgs.buildNpmPackage rec {
          pname = "${config.packageName}";
          version = "${config.version}";
          src = ./.;

          nativeBuildInputs = [ nodejs ];

          npmDepsHash = "sha256-PLACEHOLDER";
          npmBuild = "npm run build";

          installPhase = ''
            mkdir -p $out/bin $out/lib
            cp -r dist $out/lib/
            cp -r node_modules $out/lib/
            cp package.json $out/lib/

            cat > $out/bin/${config.packageName} << 'WRAPPER'
            #!/usr/bin/env bash
            exec \${nodejs}/bin/node $out/lib/dist/index.js "$@"
            WRAPPER
            chmod +x $out/bin/${config.packageName}
          '';

          meta = with pkgs.lib; {
            description = "${config.description}";
            license = licenses.mit;
            platforms = platforms.all;
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pkgs.nodePackages.npm
          ];
        };
      }
    );
}
`;
}

export function generateDefaultNix(config: NixConfig): string {
  return `{ pkgs ? import <nixpkgs> {} }:

pkgs.buildNpmPackage rec {
  pname = "${config.packageName}";
  version = "${config.version}";
  src = ./.;

  nativeBuildInputs = [ pkgs.nodejs_${config.nodeVersion || '22'} ];

  npmDepsHash = "sha256-PLACEHOLDER";
  npmBuild = "npm run build";

  meta = {
    description = "${config.description}";
    license = pkgs.lib.licenses.mit;
  };
}
`;
}

export async function writeNixConfigs(
  outputDir: string,
  config: NixConfig
): Promise<{ flake: string; defaultNix: string }> {
  const flakeContent = generateFlakeNix(config);
  const defaultContent = generateDefaultNix(config);

  const flakePath = path.join(outputDir, 'flake.nix');
  const defaultPath = path.join(outputDir, 'default.nix');

  await fs.writeFile(flakePath, flakeContent, 'utf8');
  await fs.writeFile(defaultPath, defaultContent, 'utf8');

  logger.info(`Wrote Nix configs to ${outputDir}`);

  return { flake: flakePath, defaultNix: defaultPath };
}
