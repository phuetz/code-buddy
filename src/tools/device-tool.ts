/**
 * Device Tool
 *
 * Tool for the agent to interact with paired devices.
 * Actions: list, pair, remove, snap, screenshot, record, location, run
 */

import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const DEVICE_COMMAND_COMPLETED_WITH_NO_OUTPUT = 'Command completed successfully with no output.';
export const DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT = 'Device command failed without stdout or stderr.';

// ============================================================================
// Types
// ============================================================================

export interface DeviceToolInput {
  action: 'list' | 'pair' | 'remove' | 'snap' | 'screenshot' | 'record' | 'location' | 'run';
  deviceId?: string;
  name?: string;
  transport?: 'ssh' | 'adb' | 'local';
  address?: string;
  port?: number;
  username?: string;
  keyPath?: string;
  command?: string;
  duration?: number;
}

// ============================================================================
// Device Tool
// ============================================================================

export class DeviceTool {
  async execute(input: DeviceToolInput): Promise<ToolResult> {
    try {
      const { DeviceNodeManager } = await import('../nodes/device-node.js');
      const manager = DeviceNodeManager.getInstance();

      switch (input.action) {
        case 'list': {
          const devices = manager.listDevices();
          if (devices.length === 0) {
            return { success: true, output: 'No devices paired. Use action "pair" to add a device.' };
          }
          const lines = devices.map(d =>
            `  ${d.id} (${d.name}) — ${d.type} via ${d.transportType} [${d.capabilities.join(', ')}]`
          );
          return { success: true, output: `Paired devices:\n${lines.join('\n')}` };
        }

        case 'pair': {
          if (!input.deviceId || !input.name || !input.transport) {
            return { success: false, error: 'deviceId, name, and transport are required for pairing' };
          }
          const device = await manager.pairDevice(input.deviceId, input.name, input.transport, {
            address: input.address,
            port: input.port,
            username: input.username,
            keyPath: input.keyPath,
          });
          return {
            success: true,
            output: `Device paired: ${device.name} (${device.id}) via ${device.transportType}\nCapabilities: ${device.capabilities.join(', ')}`,
          };
        }

        case 'remove': {
          if (!input.deviceId) {
            return { success: false, error: 'deviceId is required' };
          }
          const removed = manager.unpairDevice(input.deviceId);
          return {
            success: removed,
            output: removed ? `Device ${input.deviceId} removed` : `Device ${input.deviceId} not found`,
          };
        }

        case 'snap': {
          if (!input.deviceId) {
            return { success: false, error: 'deviceId is required' };
          }
          const snapPath = await manager.cameraSnap(input.deviceId);
          return snapPath
            ? { success: true, output: `Camera snap saved to: ${snapPath}` }
            : { success: false, error: `Camera snap failed on device ${input.deviceId}` };
        }

        case 'screenshot': {
          if (!input.deviceId) {
            return { success: false, error: 'deviceId is required' };
          }
          const ssPath = await manager.screenshot(input.deviceId);
          return ssPath
            ? { success: true, output: `Screenshot saved to: ${ssPath}` }
            : { success: false, error: `Screenshot failed on device ${input.deviceId}` };
        }

        case 'record': {
          if (!input.deviceId) {
            return { success: false, error: 'deviceId is required' };
          }
          const recPath = await manager.screenRecord(input.deviceId, input.duration);
          return recPath
            ? { success: true, output: `Screen recording saved to: ${recPath}` }
            : { success: false, error: `Screen recording failed on device ${input.deviceId}` };
        }

        case 'location': {
          if (!input.deviceId) {
            return { success: false, error: 'deviceId is required' };
          }
          const coords = await manager.getLocation(input.deviceId);
          return coords
            ? { success: true, output: `Location: lat=${coords.lat}, lon=${coords.lon}` }
            : { success: false, error: `Location unavailable for device ${input.deviceId}` };
        }

        case 'run': {
          if (!input.deviceId || !input.command) {
            return { success: false, error: 'deviceId and command are required' };
          }
          const result = await manager.systemRun(input.deviceId, input.command);
          if (!result) {
            return { success: false, error: `Command execution failed on device ${input.deviceId}` };
          }
          const output = result.stdout || (result.exitCode === 0
            ? DEVICE_COMMAND_COMPLETED_WITH_NO_OUTPUT
            : result.stderr || DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT);
          return {
            success: result.exitCode === 0,
            output,
            error: result.exitCode !== 0 ? result.stderr || DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT : undefined,
          };
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Device tool error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
