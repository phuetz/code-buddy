/**
 * Fleet CLI diagnostics.
 *
 * These commands expose the same dispatch profile policy decisions used by
 * Cowork/Fleet so an operator can inspect a route before running it.
 */

import type { Command } from 'commander';

import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  FLEET_DISPATCH_PROFILES,
  FLEET_DISPATCH_PROFILE_GUIDANCE,
  buildHermesToolsetDescriptor,
  getDispatchToolPolicy,
  normalizeDispatchProfile,
  previewDispatchToolDecisions,
} from '../../fleet/dispatch-profile.js';

interface PolicyCommandOptions {
  json?: boolean;
}

interface FleetServerCommandOptions extends PolicyCommandOptions {
  serverUrl?: string;
  token?: string;
}

function resolveFleetServerUrl(serverUrl?: string): string {
  const configured = serverUrl ?? process.env.CODEBUDDY_SERVER_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, '');

  const host = process.env.CODEBUDDY_SERVER_HOST ?? '127.0.0.1';
  const port = process.env.CODEBUDDY_SERVER_PORT ?? process.env.PORT ?? '3000';
  return `http://${host}:${port}`;
}

async function fetchFleetEndpoint(
  endpoint: '/api/fleet/status' | '/api/fleet/describe',
  options: FleetServerCommandOptions,
): Promise<Record<string, unknown>> {
  const baseUrl = resolveFleetServerUrl(options.serverUrl);
  const token = options.token ?? process.env.CODEBUDDY_SERVER_TOKEN ?? process.env.CODEBUDDY_FLEET_TOKEN;

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    let payload: unknown;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      payload = { message: body };
    }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Réponse JSON Fleet invalide');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Serveur Fleet indisponible sur ${baseUrl} (${detail}). ` +
        'Lancez-le avec `buddy server` puis réessayez.',
    );
  }
}

function printFleetServerError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function formatGroups(groups: string[]): string {
  return groups.length > 0 ? groups.join(', ') : 'none';
}

function formatTools(tools: string[]): string {
  return tools.length > 0 ? tools.join(', ') : 'none';
}

export function registerFleetCommands(program: Command): void {
  const fleet = program
    .command('fleet')
    .description('Inspect Fleet routing, toolsets, and dispatch policy decisions');

  fleet
    .command('status')
    .description('Show Fleet status from the configured Code Buddy server')
    .option('--server-url <url>', 'Code Buddy server URL', process.env.CODEBUDDY_SERVER_URL)
    .option('--token <token>', 'Bearer token for an authenticated server')
    .option('--json', 'output JSON')
    .action(async (options: FleetServerCommandOptions) => {
      try {
        const status = await fetchFleetEndpoint('/api/fleet/status', options);
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        const connections = (status.connections ?? {}) as Record<string, unknown>;
        console.log(`\nFleet server: ${String(status.status ?? 'unknown')}`);
        console.log(`  WebSocket connections: ${String(connections.total ?? 0)}`);
        console.log(`  Authenticated: ${String(connections.authenticated ?? 0)}`);
        console.log(`  Streaming: ${String(connections.streaming ?? 0)}`);
        console.log('');
      } catch (error) {
        printFleetServerError(error);
      }
    });

  fleet
    .command('describe')
    .description('Describe the Fleet peer exposed by the configured server')
    .option('--server-url <url>', 'Code Buddy server URL', process.env.CODEBUDDY_SERVER_URL)
    .option('--token <token>', 'Bearer token for an authenticated server')
    .option('--json', 'output JSON')
    .action(async (options: FleetServerCommandOptions) => {
      try {
        const description = await fetchFleetEndpoint('/api/fleet/describe', options);
        if (options.json) {
          console.log(JSON.stringify(description, null, 2));
          return;
        }
        console.log(`\nFleet peer: ${String(description.hostname ?? 'unknown')}`);
        console.log(`  API version: ${String(description.apiVersion ?? 'unknown')}`);
        console.log(`  Role: ${String(description.role ?? 'unknown')}`);
        const methods = Array.isArray(description.methods) ? description.methods.join(', ') : 'none';
        console.log(`  Methods: ${methods}`);
        console.log('');
      } catch (error) {
        printFleetServerError(error);
      }
    });

  fleet
    .command('profiles')
    .description('List available Fleet dispatch profiles')
    .option('--json', 'output JSON')
    .action((options: PolicyCommandOptions) => {
      const profiles = FLEET_DISPATCH_PROFILES.map((profile) => {
        const toolPolicy = getDispatchToolPolicy(profile);
        return {
          profile,
          policyProfile: toolPolicy.policyProfile,
          defaultAction: toolPolicy.defaultAction,
          summary: toolPolicy.summary,
          useWhen: FLEET_DISPATCH_PROFILE_GUIDANCE[profile].useWhen,
          allowGroups: toolPolicy.allowGroups,
          confirmGroups: toolPolicy.confirmGroups,
          denyGroups: toolPolicy.denyGroups,
        };
      });

      if (options.json) {
        console.log(JSON.stringify({ profiles }, null, 2));
        return;
      }

      console.log('\nFleet dispatch profiles:\n');
      for (const profile of profiles) {
        console.log(`  ${profile.profile}`);
        console.log(`    Policy: ${profile.policyProfile} / ${profile.defaultAction}`);
        console.log(`    Use when: ${profile.useWhen}`);
        console.log(`    ${profile.summary}`);
      }
      console.log('');
    });

  fleet
    .command('token')
    .description('Mint a fleet JWT (peer:invoke + fleet:listen) so another machine can join via /fleet listen --jwt')
    .option('--user <id>', 'token subject / user id', 'fleet-peer')
    .option('--ttl <dur>', 'expiry, e.g. 15m / 24h / 30d', '30d')
    .option('--scopes <csv>', 'override scopes', 'peer:invoke,fleet:listen,chat')
    .action(async (options: { user: string; ttl: string; scopes: string }) => {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error(
          'JWT_SECRET is required and must match the target server\'s JWT_SECRET.\n' +
            'The fleet requires a token: `--no-auth` does NOT grant peer:invoke. Set JWT_SECRET and retry.',
        );
        process.exitCode = 2;
        return;
      }
      const { generateToken } = await import('../../server/auth/jwt.js');
      const scopes = String(options.scopes)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const jwt = generateToken(
        { sub: options.user, userId: options.user, scopes: scopes as never },
        secret,
        options.ttl,
      );
      // Token to stdout (pipeable); the human recipe to stderr.
      console.log(jwt);
      console.error(
        `\n# Fleet token minted (scopes: ${scopes.join(', ')}; ttl: ${options.ttl}).\n` +
          '# On the OTHER machine, join this fleet with:\n' +
          '#   /fleet listen ws://THIS-HOST:PORT/ws --jwt <token>\n' +
          '# (the target server must run with the SAME JWT_SECRET and auth ENABLED — not --no-auth).',
      );
    });

  fleet
    .command('toolsets')
    .description('Inspect Hermes-style Fleet toolset descriptors')
    .argument('[profile]', `dispatch profile (${FLEET_DISPATCH_PROFILES.join(', ')})`)
    .argument('[tools...]', 'tool names to include in the descriptor')
    .option('--json', 'output JSON')
    .action((profileArg: string | undefined, tools: string[], options: PolicyCommandOptions) => {
      const toolNames = tools.length > 0
        ? tools
        : [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS];

      if (!profileArg) {
        const toolsets = FLEET_DISPATCH_PROFILES.map((profile) => (
          buildHermesToolsetDescriptor(profile, toolNames)
        ));

        if (options.json) {
          console.log(JSON.stringify({ toolsets }, null, 2));
          return;
        }

        console.log('\nHermes-style Fleet toolsets:\n');
        for (const toolset of toolsets) {
          console.log(`  ${toolset.toolsetId}`);
          console.log(`    Profile: ${toolset.profile}`);
          console.log(`    Policy: ${toolset.policyProfile} / ${toolset.defaultAction}`);
          console.log(`    ${toolset.summary}`);
        }
        console.log('');
        return;
      }

      const profile = normalizeDispatchProfile(profileArg);
      const toolset = buildHermesToolsetDescriptor(profile, toolNames);

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          toolset,
        }, null, 2));
        return;
      }

      console.log(`\nHermes-style Fleet toolset: ${toolset.toolsetId}`);
      if (profileArg !== profile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  Label: ${toolset.label}`);
      console.log(`  Intent: ${toolset.intent}`);
      console.log(`  Policy profile: ${toolset.policyProfile}`);
      console.log(`  Default action: ${toolset.defaultAction}`);
      console.log(`  Summary: ${toolset.summary}`);
      console.log(`  Allowed tools: ${formatTools(toolset.allowedTools)}`);
      console.log(`  Confirm tools: ${formatTools(toolset.confirmTools)}`);
      console.log(`  Denied tools: ${formatTools(toolset.deniedTools)}`);
      console.log('');
    });

  fleet
    .command('policy')
    .description('Preview tool policy decisions for a Fleet dispatch profile')
    .argument('[profile]', `dispatch profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .argument('[tools...]', 'tool names to evaluate')
    .option('--json', 'output JSON')
    .action((profileArg: string, tools: string[], options: PolicyCommandOptions) => {
      const profile = normalizeDispatchProfile(profileArg);
      const toolPolicy = getDispatchToolPolicy(profile);
      const toolNames = tools.length > 0
        ? tools
        : [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS];
      const decisions = previewDispatchToolDecisions(profile, toolNames);

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          profile,
          policyProfile: toolPolicy.policyProfile,
          defaultAction: toolPolicy.defaultAction,
          summary: toolPolicy.summary,
          allowGroups: toolPolicy.allowGroups,
          confirmGroups: toolPolicy.confirmGroups,
          denyGroups: toolPolicy.denyGroups,
          decisions,
        }, null, 2));
        return;
      }

      console.log(`\nFleet dispatch profile: ${profile}`);
      if (profileArg !== profile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  Policy profile: ${toolPolicy.policyProfile}`);
      console.log(`  Default action: ${toolPolicy.defaultAction}`);
      console.log(`  Summary: ${toolPolicy.summary}`);
      console.log(`  Allow groups: ${formatGroups(toolPolicy.allowGroups)}`);
      console.log(`  Confirm groups: ${formatGroups(toolPolicy.confirmGroups)}`);
      console.log(`  Deny groups: ${formatGroups(toolPolicy.denyGroups)}`);
      console.log('\nTool decisions:\n');

      for (const decision of decisions) {
        console.log(`  ${decision.tool}: ${decision.action}`);
        console.log(`    Groups: ${formatGroups(decision.groups)}`);
        console.log(`    Source: ${decision.source}`);
        if (decision.matchedGroup) {
          console.log(`    Matched group: ${decision.matchedGroup}`);
        }
        console.log(`    Reason: ${decision.reason}`);
      }
      console.log('');
    });
}
