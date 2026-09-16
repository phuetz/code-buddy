/**
 * Per-Platform Slash-Command Parity Manifest
 *
 * Defines the expected slash commands per messaging platform and
 * compares them against the actual registered commands per adapter.
 * Returns a machine-readable readiness report for each platform.
 */

import type { ChannelType, BaseChannel } from './core.js';
import { ChannelManager, getChannelManager } from './core.js';
import { CHANNEL_SLASH_SURFACES } from '../commands/slash/surfaces.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Describes a single expected slash command on a platform.
 */
export interface SlashCommandSpec {
  /** Command name (without leading /) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether this command is required for parity (default: true) */
  required?: boolean;
}

/**
 * Per-platform parity result for a single command.
 */
export interface SlashCommandParityEntry {
  /** Command name */
  name: string;
  /** Whether this command is present on the platform adapter */
  present: boolean;
  /** Whether this command is required */
  required: boolean;
}

/**
 * Per-platform parity report.
 */
export interface PlatformSlashParityReport {
  /** Platform identifier */
  platform: ChannelType;
  /** Whether the platform adapter is registered in the channel manager */
  adapterRegistered: boolean;
  /** Total expected commands */
  expectedCount: number;
  /** Number of commands present on the adapter */
  presentCount: number;
  /** Number of missing required commands */
  missingRequiredCount: number;
  /** Number of missing optional commands */
  missingOptionalCount: number;
  /** Per-command parity entries */
  commands: SlashCommandParityEntry[];
  /** Overall parity status */
  status: 'full' | 'partial' | 'none' | 'no-adapter';
}

/**
 * Full parity manifest across all platforms.
 */
export interface SlashParityManifest {
  /** Generation timestamp */
  generatedAt: string;
  /** Overall parity status */
  ok: boolean;
  /** Total platforms checked */
  totalPlatforms: number;
  /** Number of platforms with full parity */
  fullParityCount: number;
  /** Number of platforms with partial parity */
  partialParityCount: number;
  /** Number of platforms with no parity (missing adapter) */
  noAdapterCount: number;
  /** Per-platform reports */
  platforms: PlatformSlashParityReport[];
}

// ============================================================================
// Expected Commands Manifest
// ============================================================================

/**
 * The canonical set of slash commands expected on each platform, derived from
 * the single surface declaration `CHANNEL_SLASH_SURFACES`
 * (src/commands/slash/surfaces.ts) shared with the CLI catalog, Cowork and the
 * slash wiki. Platforms may support additional commands beyond this list.
 */
export const EXPECTED_SLASH_COMMANDS: Record<string, SlashCommandSpec[]> = Object.fromEntries(
  Object.entries(CHANNEL_SLASH_SURFACES).map(([platform, specs]) => [
    platform,
    specs.map(({ name, description, required }) => ({ name, description, ...(required === false ? { required } : {}) })),
  ]),
);

// ============================================================================
// Command Extraction
// ============================================================================

/**
 * Interface for adapters that expose their registered commands.
 *
 * Channel adapters can optionally implement this interface to
 * allow the parity checker to extract their actual registered
 * commands. Otherwise, fallback heuristics are used.
 */
export interface SlashCommandProvider {
  /** Return the list of registered slash command names (without leading /) */
  getRegisteredCommands(): string[];
}

/**
 * Check if a channel adapter implements SlashCommandProvider.
 */
function isSlashCommandProvider(channel: BaseChannel): channel is BaseChannel & SlashCommandProvider {
  return typeof (channel as unknown as SlashCommandProvider).getRegisteredCommands === 'function';
}

/**
 * Extract the actual registered commands from a channel adapter.
 *
 * Uses the SlashCommandProvider interface if available, otherwise
 * returns an empty array (no commands can be detected).
 */
export function extractActualCommands(channel: BaseChannel): string[] {
  if (isSlashCommandProvider(channel)) {
    return channel.getRegisteredCommands();
  }
  return [];
}

// ============================================================================
// Parity Checking
// ============================================================================

/**
 * Build a parity report for a single platform.
 *
 * @param platform - The platform channel type
 * @param expectedCommands - The expected slash commands
 * @param actualCommands - The actual registered commands
 * @param adapterRegistered - Whether the adapter is in the ChannelManager
 */
export function buildPlatformParityReport(
  platform: ChannelType,
  expectedCommands: SlashCommandSpec[],
  actualCommands: string[],
  adapterRegistered: boolean,
): PlatformSlashParityReport {
  if (!adapterRegistered) {
    return {
      platform,
      adapterRegistered: false,
      expectedCount: expectedCommands.length,
      presentCount: 0,
      missingRequiredCount: expectedCommands.filter((c) => c.required !== false).length,
      missingOptionalCount: expectedCommands.filter((c) => c.required === false).length,
      commands: expectedCommands.map((cmd) => ({
        name: cmd.name,
        present: false,
        required: cmd.required !== false,
      })),
      status: 'no-adapter',
    };
  }

  const actualSet = new Set(actualCommands.map((c) => c.toLowerCase()));

  const commands: SlashCommandParityEntry[] = expectedCommands.map((cmd) => ({
    name: cmd.name,
    present: actualSet.has(cmd.name.toLowerCase()),
    required: cmd.required !== false,
  }));

  const presentCount = commands.filter((c) => c.present).length;
  const missingRequiredCount = commands.filter((c) => !c.present && c.required).length;
  const missingOptionalCount = commands.filter((c) => !c.present && !c.required).length;

  let status: PlatformSlashParityReport['status'];
  if (presentCount === expectedCommands.length) {
    status = 'full';
  } else if (presentCount > 0) {
    status = 'partial';
  } else {
    status = 'none';
  }

  return {
    platform,
    adapterRegistered: true,
    expectedCount: expectedCommands.length,
    presentCount,
    missingRequiredCount,
    missingOptionalCount,
    commands,
    status,
  };
}

/**
 * Build the full slash-command parity manifest across all tracked platforms.
 *
 * @param manager - Optional ChannelManager instance (defaults to singleton)
 */
export function buildSlashParityManifest(manager?: ChannelManager): SlashParityManifest {
  const mgr = manager ?? getChannelManager();
  const reports: PlatformSlashParityReport[] = [];

  for (const [platformKey, expectedCmds] of Object.entries(EXPECTED_SLASH_COMMANDS)) {
    const platform = platformKey as ChannelType;
    const channel = mgr.getChannel(platform);
    const adapterRegistered = !!channel;
    const actualCommands = channel ? extractActualCommands(channel) : [];

    reports.push(
      buildPlatformParityReport(platform, expectedCmds, actualCommands, adapterRegistered),
    );
  }

  const fullParityCount = reports.filter((r) => r.status === 'full').length;
  const partialParityCount = reports.filter((r) => r.status === 'partial' || r.status === 'none').length;
  const noAdapterCount = reports.filter((r) => r.status === 'no-adapter').length;

  return {
    generatedAt: new Date().toISOString(),
    ok: reports.every((r) => r.missingRequiredCount === 0),
    totalPlatforms: reports.length,
    fullParityCount,
    partialParityCount,
    noAdapterCount,
    platforms: reports,
  };
}

/**
 * Render the parity manifest as a human-readable text report.
 */
export function renderSlashParityManifest(manifest: SlashParityManifest): string {
  const lines: string[] = [
    'Slash-command parity report:',
    `  Status: ${manifest.ok ? 'ok' : 'needs attention'}`,
    `  Platforms: ${manifest.totalPlatforms} (${manifest.fullParityCount} full, ${manifest.partialParityCount} partial, ${manifest.noAdapterCount} no-adapter)`,
    '',
  ];

  for (const report of manifest.platforms) {
    const missing = report.commands.filter((c) => !c.present);
    const present = report.commands.filter((c) => c.present);

    lines.push(`  ${report.platform}: ${report.status} (${report.presentCount}/${report.expectedCount})`);

    if (present.length > 0) {
      lines.push(`    Present: ${present.map((c) => c.name).join(', ')}`);
    }
    if (missing.length > 0) {
      lines.push(`    Missing: ${missing.map((c) => `${c.name}${c.required ? ' (required)' : ''}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}
