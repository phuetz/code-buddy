/**
 * Analytics Module
 *
 * Comprehensive analytics and cost tracking.
 *
 * Features:
 * - Usage event recording
 * - Cost tracking with budgets
 * - Daily/weekly/monthly summaries
 * - Export to CSV
 * - Budget alerts
 * - Tool usage analytics
 */

export {
  PersistentAnalytics,
  CostBudget,
  UsageEvent,
  AnalyticsSummary,
  CostAlert,
  getPersistentAnalytics,
  resetPersistentAnalytics,
} from './persistent-analytics.js';

export {
  MetricsDashboard,
  getMetricsDashboard,
  resetMetricsDashboard,
  type DashboardMetrics,
  type TokenMetrics,
  type CostMetrics,
  type ToolMetrics,
  type SessionMetrics,
  type PerformanceMetrics,
} from './metrics-dashboard.js';

export {
  ToolAnalytics,
  getToolAnalytics,
  resetToolAnalytics,
  type ToolExecution,
  type ToolStats,
  type ToolChain,
  type ToolSuggestion,
  type ToolAnalyticsSnapshot,
} from './tool-analytics.js';

export {
  CostPredictor,
  type CostPrediction,
} from './cost-predictor.js';

export {
  BudgetAlertManager,
  type BudgetAlert,
  type BudgetAlertConfig,
} from './budget-alerts.js';
