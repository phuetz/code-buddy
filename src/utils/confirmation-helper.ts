/**
 * Shared confirmation helper utility
 *
 * This module provides a unified way to request user confirmation
 * for various operations (file edits, bash commands, etc.).
 *
 * It reduces code duplication across tools by centralizing the
 * confirmation logic pattern.
 */

import { ToolResult } from '../types/index.js';
import { ConfirmationService } from './confirmation-service.js';

/**
 * Operation type for confirmations
 */
export type OperationType = 'file' | 'bash';

export interface ConfirmationRequest {
  /** Type of operation (file, bash, etc.) */
  operationType: OperationType;
  /** Description of the operation */
  operationDescription: string;
  /** File or target name */
  targetName: string;
  /** Detailed content/preview of the operation */
  content?: string;
  /** Whether to show VSCode open button */
  showVSCodeOpen?: boolean;
}

export interface ConfirmationCheckResult {
  /** Whether confirmation was obtained or not required */
  confirmed: boolean;
  /** Error message if not confirmed */
  error?: string;
  /** User feedback if any */
  feedback?: string;
}

/**
 * Check if confirmation is needed and request it if so
 *
 * @param request - The confirmation request details
 * @returns ConfirmationCheckResult indicating if operation can proceed
 *
 * @example
 * ```typescript
 * const check = await checkConfirmation({
 *   operationType: 'file',
 *   operationDescription: 'Edit file',
 *   targetName: 'example.ts',
 *   content: diffPreview
 * });
 *
 * if (!check.confirmed) {
 *   return { success: false, error: check.error };
 * }
 * ```
 */
export async function checkConfirmation(request: ConfirmationRequest): Promise<ConfirmationCheckResult> {
  const confirmationService = ConfirmationService.getInstance();
  const sessionFlags = confirmationService.getSessionFlags();

  // Determine which flag to check based on operation type
  const skipConfirmation =
    sessionFlags.allOperations ||
    (request.operationType === 'file' && sessionFlags.fileOperations) ||
    (request.operationType === 'bash' && sessionFlags.bashCommands);

  if (skipConfirmation) {
    return { confirmed: true };
  }

  // Request confirmation
  const confirmationResult = await confirmationService.requestConfirmation(
    {
      operation: request.operationDescription,
      filename: request.targetName,
      showVSCodeOpen: request.showVSCodeOpen ?? false,
      content: request.content,
    },
    request.operationType
  );

  if (!confirmationResult.confirmed) {
    return {
      confirmed: false,
      error: confirmationResult.feedback || `${request.operationDescription} cancelled by user`,
      feedback: confirmationResult.feedback,
    };
  }

  return { confirmed: true };
}

/**
 * Wrap an async operation with confirmation check
 *
 * @param request - The confirmation request details
 * @param operation - The async operation to execute if confirmed
 * @returns ToolResult from the operation or cancellation error
 *
 * @example
 * ```typescript
 * return withConfirmation(
 *   {
 *     operationType: 'file',
 *     operationDescription: 'Write file',
 *     targetName: filePath,
 *     content: contentPreview
 *   },
 *   async () => {
 *     await fs.writeFile(filePath, content);
 *     return { success: true, output: 'File written' };
 *   }
 * );
 * ```
 */
export async function withConfirmation(
  request: ConfirmationRequest,
  operation: () => Promise<ToolResult>
): Promise<ToolResult> {
  const check = await checkConfirmation(request);

  if (!check.confirmed) {
    return {
      success: false,
      error: check.error,
    };
  }

  return operation();
}

/**
 * Create a reusable confirmation checker for a specific operation type
 *
 * @param operationType - The type of operations this checker handles
 * @returns A function that checks confirmation for this operation type
 *
 * @example
 * ```typescript
 * const checkFileConfirmation = createConfirmationChecker('file');
 *
 * // Later in code:
 * const check = await checkFileConfirmation('Edit file', 'example.ts', diff);
 * if (!check.confirmed) return { success: false, error: check.error };
 * ```
 */
export function createConfirmationChecker(operationType: OperationType) {
  return async (
    operationDescription: string,
    targetName: string,
    content?: string
  ): Promise<ConfirmationCheckResult> => {
    return checkConfirmation({
      operationType,
      operationDescription,
      targetName,
      content,
    });
  };
}

/**
 * Pre-configured confirmation checker for file operations
 */
export const checkFileConfirmation = createConfirmationChecker('file');

/**
 * Pre-configured confirmation checker for bash operations
 */
export const checkBashConfirmation = createConfirmationChecker('bash');

/**
 * Helper to check if confirmation is currently required for an operation type
 *
 * @param operationType - The operation type to check
 * @returns true if confirmation is required, false if skipped
 */
export function isConfirmationRequired(operationType: OperationType): boolean {
  const confirmationService = ConfirmationService.getInstance();
  const sessionFlags = confirmationService.getSessionFlags();

  if (sessionFlags.allOperations) {
    return false;
  }

  switch (operationType) {
    case 'file':
      return !sessionFlags.fileOperations;
    case 'bash':
      return !sessionFlags.bashCommands;
    default:
      return true;
  }
}

/**
 * Get a descriptive error message for cancelled operations
 *
 * @param operationDescription - Description of the cancelled operation
 * @param feedback - Optional user feedback
 * @returns Formatted error message
 */
export function getCancellationError(operationDescription: string, feedback?: string): string {
  if (feedback) {
    return feedback;
  }
  return `${operationDescription} cancelled by user`;
}
