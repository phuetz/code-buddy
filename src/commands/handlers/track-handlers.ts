/**
 * Track Handlers - Command handlers for the track system
 * Implements Conductor-inspired spec-driven development workflow
 */

import { getTrackCommands } from "../../tracks/track-commands.js";
import type { CommandHandlerResult } from "./context-handlers.js";

/**
 * Handle /track command
 * Subcommands: new, implement, status, list, complete, setup, context, update
 */
export async function handleTrack(args: string[]): Promise<CommandHandlerResult> {
  const trackCommands = getTrackCommands(process.cwd());
  const argsString = args.join(" ");

  try {
    const result = await trackCommands.execute(argsString);

    // If there's a prompt, pass it to the AI
    if (result.prompt) {
      return {
        handled: true,
        passToAI: true,
        prompt: result.prompt,
        entry: {
          type: "assistant",
          content: result.message,
          timestamp: new Date(),
        },
      };
    }

    // Otherwise just display the result
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: result.success
          ? result.message
          : `Error: ${result.message}`,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Error executing track command: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      },
    };
  }
}
