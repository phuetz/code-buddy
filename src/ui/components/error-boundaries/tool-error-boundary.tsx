/**
 * Tool Error Boundary Component
 *
 * Specialized error boundary for catching and handling tool execution errors.
 * Provides detailed error information and retry capabilities for tool failures.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { logger } from '../../../utils/logger.js';

interface ToolErrorBoundaryProps {
  children: ReactNode;
  toolName?: string;
  onRetry?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  maxRetries?: number;
  showDetails?: boolean;
}

interface ToolErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
  isRetrying: boolean;
}

/**
 * Error types specific to tool execution
 */
export enum ToolErrorType {
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  TIMEOUT = 'TIMEOUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Detects the type of tool error based on error message and properties
 */
function detectToolErrorType(error: Error): ToolErrorType {
  const message = error.message.toLowerCase();

  if (message.includes('timeout') || message.includes('timed out')) {
    return ToolErrorType.TIMEOUT;
  }
  if (message.includes('permission') || message.includes('eacces')) {
    return ToolErrorType.PERMISSION_DENIED;
  }
  if (message.includes('not found') || message.includes('enoent')) {
    return ToolErrorType.RESOURCE_NOT_FOUND;
  }
  if (message.includes('invalid') || message.includes('parameter')) {
    return ToolErrorType.INVALID_PARAMETERS;
  }
  if (message.includes('failed') || message.includes('error')) {
    return ToolErrorType.EXECUTION_FAILED;
  }

  return ToolErrorType.UNKNOWN;
}

/**
 * Tool Error Boundary for handling tool execution errors
 */
export class ToolErrorBoundary extends Component<
  ToolErrorBoundaryProps,
  ToolErrorBoundaryState
> {
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor(props: ToolErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRetrying: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ToolErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error details
    const toolName = this.props.toolName || 'Unknown Tool';
    const errorType = detectToolErrorType(error);

    logger.error(`[ToolErrorBoundary] Tool execution error in ${toolName}`, error, {
      toolName,
      errorType,
      componentStack: errorInfo.componentStack
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  handleRetry = (): void => {
    const maxRetries = this.props.maxRetries || 3;

    if (this.state.retryCount >= maxRetries) {
      return;
    }

    this.setState({ isRetrying: true });

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, this.state.retryCount) * 1000;

    this.retryTimeout = setTimeout(() => {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prev.retryCount + 1,
        isRetrying: false,
      }));

      // Call retry callback if provided
      if (this.props.onRetry) {
        this.props.onRetry();
      }
    }, delay);
  };

  getErrorMessage(): string {
    if (!this.state.error) {
      return 'An unexpected error occurred';
    }

    const errorType = detectToolErrorType(this.state.error);
    const toolName = this.props.toolName || 'tool';

    switch (errorType) {
      case ToolErrorType.TIMEOUT:
        return `Tool execution timed out. The ${toolName} took too long to complete.`;
      case ToolErrorType.PERMISSION_DENIED:
        return `Permission denied. The ${toolName} does not have the necessary permissions.`;
      case ToolErrorType.RESOURCE_NOT_FOUND:
        return `Resource not found. The ${toolName} could not find the required resource.`;
      case ToolErrorType.INVALID_PARAMETERS:
        return `Invalid parameters. The ${toolName} received invalid input.`;
      case ToolErrorType.EXECUTION_FAILED:
        return `Execution failed. The ${toolName} encountered an error: ${this.state.error.message}`;
      default:
        return `The ${toolName} encountered an error: ${this.state.error.message}`;
    }
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const maxRetries = this.props.maxRetries || 3;
      const canRetry = this.state.retryCount < maxRetries && this.props.onRetry;
      const errorType = detectToolErrorType(this.state.error);

      return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
          <Box marginBottom={1}>
            <Text color="red" bold>
              Tool Execution Error
            </Text>
            {this.props.toolName && (
              <Text color="gray"> ({this.props.toolName})</Text>
            )}
          </Box>

          <Box marginBottom={1}>
            <Text color="yellow">{this.getErrorMessage()}</Text>
          </Box>

          {this.props.showDetails && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="gray" dimColor>
                Error Type: {errorType}
              </Text>
              <Text color="gray" dimColor>
                Error Name: {this.state.error.name}
              </Text>
              {this.state.error.stack && (
                <Text color="gray" dimColor>
                  {this.state.error.stack.slice(0, 200)}...
                </Text>
              )}
            </Box>
          )}

          {canRetry && (
            <Box flexDirection="column" marginTop={1}>
              {this.state.isRetrying ? (
                <Text color="cyan">Retrying...</Text>
              ) : (
                <Box>
                  <Text color="green">
                    Retry available ({this.state.retryCount}/{maxRetries})
                  </Text>
                  <Text color="gray"> - Will auto-retry in {Math.pow(2, this.state.retryCount)}s</Text>
                </Box>
              )}
            </Box>
          )}

          {!canRetry && this.state.retryCount >= maxRetries && (
            <Box marginTop={1}>
              <Text color="red">
                Maximum retry attempts reached. Please check the error and try again manually.
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press Ctrl+C to exit
            </Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook to wrap components with Tool Error Boundary
 */
interface WithToolErrorBoundaryOptions {
  toolName?: string;
  onRetry?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  maxRetries?: number;
  showDetails?: boolean;
}

export function withToolErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithToolErrorBoundaryOptions = {}
): React.FC<P> {
  const WithToolErrorBoundaryComponent: React.FC<P> = (props) => (
    <ToolErrorBoundary
      toolName={options.toolName}
      onRetry={options.onRetry}
      onError={options.onError}
      maxRetries={options.maxRetries}
      showDetails={options.showDetails}
    >
      <WrappedComponent {...props} />
    </ToolErrorBoundary>
  );

  WithToolErrorBoundaryComponent.displayName = `WithToolErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithToolErrorBoundaryComponent;
}

export default ToolErrorBoundary;
