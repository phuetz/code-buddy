/**
 * Node Commands
 *
 * CLI commands for managing companion app nodes.
 * Inspired by OpenClaw's `openclaw nodes` command.
 *
 * Usage:
 *   buddy nodes list [--platform <platform>]
 *   buddy nodes pair <platform> <name>
 *   buddy nodes approve <code>
 *   buddy nodes describe <nodeId>
 *   buddy nodes remove <nodeId>
 *   buddy nodes invoke <nodeId> <capability> [--params <json>]
 */

import { Command } from 'commander';

export function registerNodeCommands(program: Command): void {
  const nodes = program
    .command('nodes')
    .description('Manage companion app nodes (macOS, iOS, Android)');

  nodes
    .command('list')
    .description('List paired nodes')
    .option('--platform <platform>', 'Filter by platform (macos, ios, android, linux, windows)')
    .option('--status <status>', 'Filter by status (online, offline, pairing)')
    .action(async (opts) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();
      const nodeList = mgr.listNodes({
        platform: opts.platform,
        status: opts.status,
      });

      if (nodeList.length === 0) {
        console.log('No nodes paired. Use `buddy nodes pair <platform> <name>` to add one.');
        return;
      }

      console.log(`\nPaired Nodes (${nodeList.length}):\n`);
      for (const node of nodeList) {
        const battery = node.batteryLevel !== undefined ? ` 🔋${node.batteryLevel}%` : '';
        console.log(`  ${node.status === 'online' ? '●' : '○'} ${node.name} (${node.platform})${battery}`);
        console.log(`    ID: ${node.id}`);
        console.log(`    Capabilities: ${node.capabilities.length}`);
        console.log(`    Last seen: ${node.lastSeen.toISOString()}`);
        console.log();
      }
    });

  nodes
    .command('pair')
    .description('Request pairing with a new companion node')
    .argument('<platform>', 'Node platform (macos, ios, android, linux, windows)')
    .argument('<name>', 'Node display name')
    .action(async (platform, name) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();

      try {
        const req = mgr.requestPairing(platform, name);
        console.log(`\nPairing Code: ${req.code}`);
        console.log(`Platform: ${req.platform}`);
        console.log(`Expires: ${req.expiresAt.toISOString()}`);
        console.log(`\nEnter this code in your companion app to complete pairing.`);
        console.log(`Then run: buddy nodes approve ${req.code}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  nodes
    .command('approve')
    .description('Approve a pending pairing request')
    .argument('<code>', 'Pairing code')
    .action(async (code) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();

      try {
        const node = mgr.approvePairing(code);
        console.log(`\nNode paired successfully!`);
        console.log(`  Name: ${node.name}`);
        console.log(`  Platform: ${node.platform}`);
        console.log(`  ID: ${node.id}`);
        console.log(`  Capabilities: ${node.capabilities.join(', ')}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  nodes
    .command('describe')
    .description('Show detailed info about a node')
    .argument('<nodeId>', 'Node ID')
    .action(async (nodeId) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();
      const info = mgr.describeNode(nodeId);

      if (!info) {
        console.error(`Node not found: ${nodeId}`);
        process.exit(1);
      }

      console.log(`\nNode: ${info.info.name}`);
      console.log(`  ID: ${info.info.id}`);
      console.log(`  Platform: ${info.info.platform}`);
      console.log(`  Status: ${info.info.status}`);
      console.log(`  Paired: ${info.info.pairedAt.toISOString()}`);
      console.log(`  Last seen: ${info.info.lastSeen.toISOString()}`);
      if (info.info.version) console.log(`  Version: ${info.info.version}`);
      if (info.info.batteryLevel !== undefined) console.log(`  Battery: ${info.info.batteryLevel}%`);
      console.log(`\n  Capabilities:`);
      for (const cap of info.capabilities) {
        console.log(`    - ${cap}`);
      }
    });

  nodes
    .command('remove')
    .description('Remove a paired node')
    .argument('<nodeId>', 'Node ID')
    .action(async (nodeId) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();
      const removed = mgr.removeNode(nodeId);
      if (removed) {
        console.log(`Node ${nodeId} removed.`);
      } else {
        console.error(`Node not found: ${nodeId}`);
        process.exit(1);
      }
    });

  nodes
    .command('invoke')
    .description('Invoke a capability on a node')
    .argument('<nodeId>', 'Node ID')
    .argument('<capability>', 'Capability to invoke (e.g., camera.snap, location.get)')
    .option('--params <json>', 'JSON parameters')
    .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
    .action(async (nodeId, capability, opts) => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();

      let params: Record<string, unknown> | undefined;
      if (opts.params) {
        try {
          params = JSON.parse(opts.params);
        } catch {
          console.error('Invalid JSON in --params');
          process.exit(1);
        }
      }

      const result = await mgr.invoke({
        nodeId,
        capability: capability as import('../../nodes/index.js').NodeCapability,
        params,
        timeoutMs: parseInt(opts.timeout, 10),
      });

      if (result.success) {
        console.log('Invocation successful.');
        if (result.data) console.log(JSON.stringify(result.data, null, 2));
        if (result.durationMs) console.log(`Duration: ${result.durationMs}ms`);
      } else {
        console.error(`Invocation failed: ${result.error}`);
        process.exit(1);
      }
    });

  nodes
    .command('pending')
    .description('List pending pairing requests')
    .action(async () => {
      const { NodeManager } = await import('../../nodes/index.js');
      const mgr = NodeManager.getInstance();
      const pending = mgr.getPendingPairings();

      if (pending.length === 0) {
        console.log('No pending pairing requests.');
        return;
      }

      console.log(`\nPending Pairings (${pending.length}):\n`);
      for (const req of pending) {
        console.log(`  Code: ${req.code}  Platform: ${req.platform}  Name: ${req.name}`);
        console.log(`  Expires: ${req.expiresAt.toISOString()}`);
        console.log();
      }
    });
}
