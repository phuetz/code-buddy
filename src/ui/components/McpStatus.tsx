import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { getMCPManager } from "../../codebuddy/tools.js";
import { MCPTool } from "../../mcp/client.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { logger } from "../../utils/logger.js";

// Memoized MCP status component to reduce unnecessary re-renders
const MCPStatusInner = React.memo(function MCPStatusInner() {
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  // Track available tools for potential future UI display
  const [, setAvailableTools] = useState<MCPTool[]>([]);
  const [hasError, setHasError] = useState(false);

  // Use refs to cache previous values and avoid unnecessary state updates
  const prevServersRef = useRef<string>("");
  const prevToolsRef = useRef<string>("");

  useEffect(() => {
    const updateStatus = () => {
      try {
        const manager = getMCPManager();
        const servers = manager.getServers();
        const tools = manager.getTools();

        // Only update state if values actually changed
        // This prevents unnecessary re-renders on each poll interval
        const serversStr = JSON.stringify(servers);
        const toolsStr = JSON.stringify(tools.map((t: MCPTool) => t.name));

        if (serversStr !== prevServersRef.current) {
          prevServersRef.current = serversStr;
          setConnectedServers(servers);
        }

        if (toolsStr !== prevToolsRef.current) {
          prevToolsRef.current = toolsStr;
          setAvailableTools(tools);
        }

        // Clear error state if successful
        if (hasError) {
          setHasError(false);
        }
      } catch (error) {
        // MCP manager error - log and set error state
        logger.error('MCP status update error', error as Error);
        setHasError(true);
        if (prevServersRef.current !== "[]") {
          prevServersRef.current = "[]";
          setConnectedServers([]);
          setAvailableTools([]);
        }
      }
    };

    // Initial update with a small delay to allow MCP initialization
    const initialTimer = setTimeout(updateStatus, 2000);

    // Set up polling to check for status changes (longer interval since we cache)
    const interval = setInterval(updateStatus, 3000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [hasError]);

  if (hasError) {
    return (
      <Box marginLeft={1}>
        <Text color="yellow">⚠ MCP error</Text>
      </Box>
    );
  }

  if (connectedServers.length === 0) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color="green">⚒ mcps: {connectedServers.length} </Text>
    </Box>
  );
});

// Export wrapped version with ErrorBoundary
export const MCPStatus = () => (
  <ErrorBoundary
    fallback={
      <Box marginLeft={1}>
        <Text color="yellow">⚠ MCP unavailable</Text>
      </Box>
    }
    showDetails={false}
  >
    <MCPStatusInner />
  </ErrorBoundary>
);
