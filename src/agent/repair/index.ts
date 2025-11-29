/**
 * Automated Program Repair Module
 *
 * Exports all components for intelligent automated program repair.
 */

// Types
export * from "./types.js";

// Fault Localization
export {
  FaultLocalizer,
  createFaultLocalizer,
} from "./fault-localization.js";

// Repair Templates
export {
  TemplateRepairEngine,
  createTemplateRepairEngine,
  REPAIR_TEMPLATES,
} from "./repair-templates.js";

// Main Repair Engine
export {
  RepairEngine,
  createRepairEngine,
  getRepairEngine,
  resetRepairEngine,
} from "./repair-engine.js";
