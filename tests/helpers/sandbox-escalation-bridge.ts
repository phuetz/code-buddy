/**
 * Test stand-in for the human who approves "run outside the workspace sandbox".
 *
 * On a host without any workspace sandbox backend (Windows without a Linux
 * Docker daemon, a locked-down Linux without bwrap/docker), an ALLOWED command
 * is escalated to an exact, human-approved grant — one the blanket
 * `bashCommands` session flag deliberately does not cover, and which fails
 * closed without a TTY ("Approval requires an interactive terminal"). Tests of
 * command-execution semantics install this bridge so that ONLY that
 * sandbox-unavailable escalation is approved; `ask`-policy commands (sudo, …)
 * and sandbox-boundary denials still go through the real fail-closed path.
 */
import type { ConfirmationService } from '../../src/utils/confirmation-service.js';

const SANDBOX_UNAVAILABLE = /\nBoundary: (No native or Docker workspace sandbox is available|Workspace sandbox unavailable)/;

/** What the service answers without a TTY — kept verbatim so `ask` commands still read "Approval requires…". */
const NO_TERMINAL_FEEDBACK = 'Approval requires an interactive terminal or configured remote approval channel';

export function approveSandboxUnavailableEscalations(service: ConfirmationService): void {
  service.setInteractiveBridge(async (options) =>
    SANDBOX_UNAVAILABLE.test(options.content ?? '')
      ? { confirmed: true }
      : { confirmed: false, feedback: NO_TERMINAL_FEEDBACK },
  );
}

export function clearSandboxEscalationBridge(service: ConfirmationService): void {
  service.setInteractiveBridge(null);
}
