/**
 * Error Boundary Component for Ink/React
 *
 * Catches JavaScript errors in child components and displays
 * a fallback UI instead of crashing the entire CLI.
 *
 * Based on React error boundary pattern adapted for terminal UI.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { logger } from '../../utils/logger.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary for Ink components
 * Prevents the entire CLI from crashing on component errors
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log to console for debugging
    logger.error('ErrorBoundary caught an error', error, {
      componentStack: errorInfo.componentStack
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
          <Box marginBottom={1}>
            <Text color="red" bold>
              Something went wrong
            </Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="yellow">
              {this.state.error?.message || 'An unexpected error occurred'}
            </Text>
          </Box>

          {this.props.showDetails && this.state.error && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>
                Error: {this.state.error.name}
              </Text>
              {this.state.errorInfo?.componentStack && (
                <Text color="gray" dimColor>
                  {this.state.errorInfo.componentStack.slice(0, 500)}
                </Text>
              )}
            </Box>
          )}

          <Box marginTop={1}>
            <Text color="gray">
              Press Ctrl+C to exit or try again.
            </Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based error boundary wrapper for functional components
 */
interface WithErrorBoundaryOptions {
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithErrorBoundaryOptions = {}
): React.FC<P> {
  const WithErrorBoundaryComponent: React.FC<P> = (props) => (
    <ErrorBoundary
      fallback={options.fallback}
      onError={options.onError}
      showDetails={options.showDetails}
    >
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundaryComponent.displayName = `WithErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithErrorBoundaryComponent;
}

/**
 * Specialized error boundary for streaming content
 */
export class StreamingErrorBoundary extends Component<
  ErrorBoundaryProps & { retryCount?: number },
  ErrorBoundaryState & { retries: number }
> {
  constructor(props: ErrorBoundaryProps & { retryCount?: number }) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retries: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = (): void => {
    const maxRetries = this.props.retryCount || 3;
    if (this.state.retries < maxRetries) {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retries: prev.retries + 1,
      }));
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const maxRetries = this.props.retryCount || 3;
      const canRetry = this.state.retries < maxRetries;

      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">
            Streaming error: {this.state.error?.message || 'Unknown error'}
          </Text>
          {canRetry && (
            <Text color="gray" dimColor>
              Retry {this.state.retries + 1}/{maxRetries}...
            </Text>
          )}
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
