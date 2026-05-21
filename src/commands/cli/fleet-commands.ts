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
