/**
 * Daemon Module - Barrel Export
 */

export {
  DaemonManager,
  getDaemonManager,
  resetDaemonManager,
  type DaemonConfig,
  type DaemonStatus,
  type ServiceStatus,
} from './daemon-manager.js';

export {
  DaemonLifecycle,
  getDaemonLifecycle,
  resetDaemonLifecycle,
  type DaemonService,
  type LifecycleConfig,
} from './daemon-lifecycle.js';

export {
  CronAgentBridge,
  getCronAgentBridge,
  resetCronAgentBridge,
  type BridgeConfig,
  type JobExecutionResult,
} from './cron-agent-bridge.js';

export {
  HealthMonitor,
  getHealthMonitor,
  resetHealthMonitor,
  type HealthMetrics,
  type HealthMonitorConfig,
} from './health-monitor.js';

export {
  DailyResetManager,
  getDailyResetManager,
  resetDailyResetManager,
  type DailyResetConfig,
  type ResetResult,
} from './daily-reset.js';
