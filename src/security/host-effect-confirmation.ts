import { ConfirmationService } from '../utils/confirmation-service.js';
import { getPermissionModeManager } from './permission-modes.js';

/** No project configuration, session flag or automatic mode may grant this approval. */
export async function confirmHostEffect(toolName: string, application: string, content: string): Promise<boolean> {
  if (getPermissionModeManager().getMode() === 'plan') return false;
  const decision = await ConfirmationService.getInstance().requestConfirmation({
    operation: `${toolName} — risk: critical`,
    filename: application,
    content: `Application/process: ${application}\nRisk level: critical\n${content}`,
    toolName,
    riskLevel: 'critical',
    forcePrompt: true,
  }, 'tool');
  return decision.confirmed;
}

/** Recognized desktop command lines only; this is not a sandbox for arbitrary programs. */
export async function confirmDesktopCommand(command: string): Promise<boolean> {
  const desktopActor = /\b(?:xdotool|ydotool|dotool|wmctrl|cliclick|osascript|xte|wtype)\b/i;
  // Conservative literal normalization, not shell evaluation. Preserve the raw
  // match too so normalization cannot remove a previously guarded command.
  const literal = command.replace(/\\\r?\n/g, '').replace(/['"\\]/g, '');
  if (!desktopActor.test(command) && !desktopActor.test(literal)) return true;
  return confirmHostEffect('bash', 'Desktop command (target not verified)', command);
}

/** Show executable/arguments to the human without copying credential environment values. */
export function describeMCPConnection(config: unknown): string {
  return JSON.stringify(config, (key, value: unknown) =>
    /^(?:env|headers|authorization|.*token|.*secret|.*password|apiKey)$/i.test(key) ? '[redacted]' : value);
}
