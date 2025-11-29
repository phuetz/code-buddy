/**
 * Advanced Tools Module
 *
 * Exports all advanced file operation tools including:
 * - Multi-file atomic editing with transactions
 * - Operation history with undo/redo capabilities
 *
 * Inspired by hurry-mode's advanced editing capabilities.
 */

// Types
export * from "./types.js";

// Multi-File Editor
export {
  MultiFileEditor,
  createMultiFileEditor,
  getMultiFileEditor,
  resetMultiFileEditor,
} from "./multi-file-editor.js";

// Operation History
export {
  OperationHistory,
  createOperationHistory,
  getOperationHistory,
  resetOperationHistory,
} from "./operation-history.js";
