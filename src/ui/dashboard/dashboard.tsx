/**
 * Observability Dashboard
 *
 * Interactive terminal dashboard for monitoring:
 * - Agent costs and budget
 * - Latency and performance
 * - Tool usage statistics
 *
 * Keyboard navigation:
 * - Tab/1-4: Switch views
 * - q: Quit dashboard
 * - r: Refresh data
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useTheme, ThemeProvider } from '../context/theme-context.js';
import { useDashboardData } from './hooks/use-dashboard-data.js';
import { OverviewView } from './views/overview-view.js';
import { CostsView } from './views/costs-view.js';
import { LatencyView } from './views/latency-view.js';
import { ToolsView } from './views/tools-view.js';

export type DashboardTab = 'overview' | 'costs' | 'latency' | 'tools';

export interface ObservabilityDashboardProps {
  /** Initial tab to display */
  initialTab?: DashboardTab;
  /** Budget limit for cost tracking */
  budget?: number;
  /** Refresh interval in ms */
  refreshInterval?: number;
  /** Callback when dashboard is closed */
  onClose?: () => void;
}

const TABS: Array<{ id: DashboardTab; label: string; key: string; icon: string }> = [
  { id: 'overview', label: 'Overview', key: '1', icon: '📊' },
  { id: 'costs', label: 'Costs', key: '2', icon: '💰' },
  { id: 'latency', label: 'Latency', key: '3', icon: '⚡' },
  { id: 'tools', label: 'Tools', key: '4', icon: '🔧' },
];

/**
 * Dashboard Header with tab navigation
 */
function DashboardHeader({
  activeTab,
}: {
  activeTab: DashboardTab;
}) {
  const { colors } = useTheme();

  return (
    <Box
      borderStyle="double"
      borderColor={colors.primary}
      paddingX={1}
      flexDirection="column"
    >
      {/* Title */}
      <Box justifyContent="space-between">
        <Text bold color={colors.primary}>
          ╔═══ GROK CLI OBSERVABILITY DASHBOARD ═══╗
        </Text>
        <Text dimColor>Press [q] to quit • [r] to refresh</Text>
      </Box>

      {/* Tabs */}
      <Box marginTop={1}>
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Box key={tab.id} marginRight={2}>
              <Text
                color={isActive ? colors.primary : colors.textMuted}
                bold={isActive}
                inverse={isActive}
              >
                {` [${tab.key}] ${tab.icon} ${tab.label} `}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Dashboard Footer with help text
 */
function DashboardFooter({ lastUpdate }: { lastUpdate: number }) {
  const { colors } = useTheme();

  return (
    <Box
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text dimColor>
        Navigation: [1-4] Switch tabs • [↑↓] Scroll • [q] Quit
      </Text>
      <Text dimColor>
        Last update: {new Date(lastUpdate).toLocaleTimeString()}
      </Text>
    </Box>
  );
}

/**
 * Main Dashboard Content
 */
function DashboardContent({
  initialTab = 'overview',
  budget = 10,
  refreshInterval = 1000,
  onClose,
}: ObservabilityDashboardProps) {
  const { colors } = useTheme();
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);

  // Get real-time data
  const data = useDashboardData({ refreshInterval });

  // Handle keyboard input
  useInput(
    useCallback(
      (input, key) => {
        // Tab switching
        if (input === '1') setActiveTab('overview');
        else if (input === '2') setActiveTab('costs');
        else if (input === '3') setActiveTab('latency');
        else if (input === '4') setActiveTab('tools');
        else if (key.tab) {
          // Cycle through tabs
          const currentIndex = TABS.findIndex((t) => t.id === activeTab);
          const nextIndex = (currentIndex + 1) % TABS.length;
          setActiveTab(TABS[nextIndex].id);
        }
        // Quit
        else if (input === 'q' || input === 'Q') {
          if (onClose) onClose();
          exit();
        }
      },
      [activeTab, exit, onClose]
    )
  );

  // Render active view
  const renderView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewView data={data} />;
      case 'costs':
        return <CostsView data={data} budget={budget} />;
      case 'latency':
        return <LatencyView data={data} />;
      case 'tools':
        return <ToolsView data={data} />;
      default:
        return <OverviewView data={data} />;
    }
  };

  return (
    <Box flexDirection="column" width="100%">
      {/* Header with tabs */}
      <DashboardHeader activeTab={activeTab} />

      {/* Connection status */}
      {!data.isConnected && (
        <Box paddingX={1} marginY={1}>
          <Text color={colors.warning}>⚠ Connecting to metrics collector...</Text>
        </Box>
      )}

      {/* Main content area */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={colors.border}
        minHeight={20}
      >
        {renderView()}
      </Box>

      {/* Footer */}
      <DashboardFooter lastUpdate={data.lastUpdate} />
    </Box>
  );
}

/**
 * Observability Dashboard Component
 *
 * Full-screen interactive dashboard for monitoring agent performance.
 */
export function ObservabilityDashboard(props: ObservabilityDashboardProps) {
  return (
    <ThemeProvider>
      <DashboardContent {...props} />
    </ThemeProvider>
  );
}

/**
 * Standalone Dashboard (for direct rendering)
 */
export function StandaloneDashboard(props: ObservabilityDashboardProps) {
  return <ObservabilityDashboard {...props} />;
}

export default ObservabilityDashboard;
