/**
 * Sandbox module - Multi-backend sandboxed execution
 *
 * Supports:
 * - Docker containers (cross-platform)
 * - OS-level sandboxing (bubblewrap on Linux, seatbelt on macOS)
 * - Execpolicy framework for command authorization
 */

export * from "./docker-sandbox.js";
export * from "./os-sandbox.js";
export * from "./execpolicy.js";
