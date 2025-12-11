/**
 * Integrations module - External service integrations (GitHub, IDE)
 */

export * from "./github-integration.js";
export * from "./github-actions.js";

// IDE Protocol exports (primary definitions)
export {
  JSONRPCMessage,
  JSONRPCError,
  IDECapabilities,
  IDEState,
  Selection,
  Diagnostic as ProtocolDiagnostic,
  CodeAction as ProtocolCodeAction,
  CompletionItem as ProtocolCompletionItem,
  CompletionItemKind,
  TextEdit,
  WorkspaceEdit,
  Command,
  HoverInfo,
  MarkupContent,
  ErrorCodes,
  IDEProtocolServer,
  IDEProtocolClient,
  createIDEServer,
  createIDEClient,
} from "./ide-protocol.js";

// IDE Extensions exports (with renamed conflicting types)
export {
  IDEType,
  IDEConnection,
  IDERequest,
  IDEResponse,
  CompletionRequest,
  CompletionItem as ExtensionCompletionItem,
  DiagnosticRequest,
  Diagnostic as ExtensionDiagnostic,
  HoverRequest,
  HoverResult,
  CodeActionRequest,
  CodeAction as ExtensionCodeAction,
  IDEExtensionsConfig,
  IDEExtensionsServer,
  getIDEExtensionsServer,
  resetIDEExtensionsServer,
} from "./ide-extensions.js";
