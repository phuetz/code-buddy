/**
 * Daemon and Trigger CLI commands
 *
 * Extracted from index.ts for modularity.
 */

import type { Command } from 'commander';

/**
 * Register daemon subcommands on the given program
 */
export function registerDaemonCommands(program: Command): void {
  const daemonCommand = program
    .command("daemon")
    .description("Manage the Code Buddy daemon (background process)");

  daemonCommand
    .command("start")
    .description("Start the daemon")
    .option("--detach", "run daemon in background", true)
    .option("--port <port>", "server port", "3000")
    .action(async (options) => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager({ port: parseInt(options.port) });
      try {
        await manager.start(options.detach);
        const status = await manager.status();
        console.log(`Daemon started (PID: ${status.pid})`);
      } catch (error) {
        console.error(`Failed to start daemon: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  daemonCommand
    .command("stop")
    .description("Stop the daemon")
    .action(async () => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager();
      try {
        await manager.stop();
        console.log("Daemon stopped");
      } catch (error) {
        console.error(`Failed to stop daemon: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  daemonCommand
    .command("restart")
    .description("Restart the daemon")
    .action(async () => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager();
      try {
        await manager.restart();
        console.log("Daemon restarted");
      } catch (error) {
        console.error(`Failed to restart daemon: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  daemonCommand
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager();
      const status = await manager.status();
      if (status.running) {
        console.log(`Daemon: RUNNING (PID: ${status.pid})`);
        if (status.uptime) {
          console.log(`Uptime: ${Math.round(status.uptime / 1000)}s`);
        }
        if (status.services.length > 0) {
          console.log("Services:");
          for (const svc of status.services) {
            console.log(`  ${svc.running ? "+" : "-"} ${svc.name}`);
          }
        }
      } else {
        console.log("Daemon: STOPPED");
      }
    });

  daemonCommand
    .command("logs")
    .description("Show daemon logs")
    .option("-n, --lines <count>", "number of lines", "50")
    .action(async (options) => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager();
      const logs = await manager.logs(parseInt(options.lines));
      console.log(logs);
    });

  // Hidden command used by daemon manager to fork the daemon process
  daemonCommand
    .command("__run__", { hidden: true })
    .option("--port <port>", "server port", "3000")
    .action(async (options) => {
      const { getDaemonManager } = await import("../../daemon/index.js");
      const manager = getDaemonManager({ port: parseInt(options.port) });
      await manager.start(false); // foreground mode (writes PID file)

      // Start the API server to keep the daemon alive
      try {
        const { startServer } = await import("../../server/index.js");
        await startServer({
          port: parseInt(options.port),
          host: '0.0.0.0',
          authEnabled: false,
        });
      } catch (error) {
        console.error('Daemon server failed:', error instanceof Error ? error.message : error);
      }

      process.on('SIGTERM', async () => {
        await manager.stop().catch(() => {});
        process.exit(0);
      });
    });
}

/**
 * Register trigger subcommands on the given program
 */
export function registerTriggerCommands(program: Command): void {
  const triggerCommand = program
    .command("trigger")
    .description("Manage event triggers for automated agent responses");

  triggerCommand
    .command("list")
    .description("List all triggers")
    .action(async () => {
      const { getEventTriggerManager } = await import("../../agent/observer/index.js");
      const { TriggerRegistry } = await import("../../agent/observer/trigger-registry.js");
      const manager = getEventTriggerManager();
      const registry = new TriggerRegistry(manager);
      await registry.load();
      const triggers = manager.listTriggers();
      if (triggers.length === 0) {
        console.log("No triggers configured.");
        console.log("Use 'codebuddy trigger add' to create one.");
      } else {
        for (const t of triggers) {
          const status = t.enabled ? "+" : "-";
          console.log(`  ${status} [${t.id.slice(0, 8)}] ${t.name} (${t.type}: ${t.condition})`);
        }
      }
    });

  triggerCommand
    .command("add <spec>")
    .description("Add a trigger (format: type:condition action:target)")
    .action(async (spec: string) => {
      const { getEventTriggerManager } = await import("../../agent/observer/index.js");
      const { TriggerRegistry } = await import("../../agent/observer/trigger-registry.js");
      const manager = getEventTriggerManager();
      const registry = new TriggerRegistry(manager);
      await registry.load();

      const parts = spec.split(/\s+/);
      const [typeCondition, actionTarget] = parts;
      const [type, ...condParts] = (typeCondition || '').split(':');
      const condition = condParts.join(':') || '*';
      const [actionType, target] = (actionTarget || 'notify:cli').split(':');

      const trigger = await registry.create({
        name: `${type} trigger`,
        type: type as 'file_change' | 'screen_change' | 'time' | 'webhook',
        condition,
        action: { type: (actionType || 'notify') as 'notify' | 'execute' | 'agent_message', target: target || 'cli' },
      });
      console.log(`Trigger created: ${trigger.id.slice(0, 8)} (${trigger.type}: ${trigger.condition})`);
    });

  triggerCommand
    .command("remove <id>")
    .description("Remove a trigger by ID")
    .action(async (id: string) => {
      const { getEventTriggerManager } = await import("../../agent/observer/index.js");
      const { TriggerRegistry } = await import("../../agent/observer/trigger-registry.js");
      const manager = getEventTriggerManager();
      const registry = new TriggerRegistry(manager);
      await registry.load();

      const triggers = manager.listTriggers();
      const match = triggers.find(t => t.id.startsWith(id));
      if (match) {
        await registry.delete(match.id);
        console.log(`Trigger removed: ${match.id.slice(0, 8)}`);
      } else {
        console.error(`Trigger not found: ${id}`);
        process.exit(1);
      }
    });
}
