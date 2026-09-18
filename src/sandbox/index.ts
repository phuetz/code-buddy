/**
 * Sandbox module - Multi-backend sandboxed execution
 *
 * Supports:
 * - Docker containers (cross-platform)
 * - OS-level sandboxing (bubblewrap on Linux, seatbelt on macOS)
 * - OpenShell (NVIDIA OpenShell-compatible backend)
 * - Execpolicy framework for command authorization
 * - Pluggable backend registry (Strategy pattern)
 */

export * from "./sandbox-backend.js";
export * from "./sandbox-registry.js";
export * from "./openshell-backend.js";
export * from "./docker-sandbox.js";
export * from "./e2b-sandbox.js";
export * from "./os-sandbox.js";
export * from "./execpolicy.js";
export * from "./safe-eval.js";
export * from "./ssh-hosts.js";
export * from "./ssh-sandbox.js";
