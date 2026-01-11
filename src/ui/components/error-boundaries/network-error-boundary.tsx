/**
 * Network Error Boundary Component
 *
 * Specialized error boundary for catching and handling API and network errors.
 * Provides connection status, retry with exponential backoff, and offline mode options.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { logger } from '../../../utils/logger.js';

interface NetworkErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
  onOfflineMode?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  maxRetries?: number;
  showDetails?: boolean;
  apiEndpoint?: string;
}

interface NetworkErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
  isRetrying: boolean;
  connectionStatus: ConnectionStatus;
  nextRetryIn: number;
}

/**
 * Connection status types
 */
export enum ConnectionStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  DEGRADED = 'DEGRADED',
  CHECKING = 'CHECKING',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Network error types
 */
export enum NetworkErrorType {
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  TIMEOUT = 'TIMEOUT',
  DNS_FAILURE = 'DNS_FAILURE',
  SSL_ERROR = 'SSL_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER_ERROR = 'SERVER_ERROR',
  CLIENT_ERROR = 'CLIENT_ERROR',
  NETWORK_UNREACHABLE = 'NETWORK_UNREACHABLE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Detects the type of network error based on error message and properties
 */
function detectNetworkErrorType(error: Error): NetworkErrorType {
  const message = error.message.toLowerCase();
  const errorCode = (error as { code?: string }).code;

  // Check error codes first
  if (errorCode === 'ECONNREFUSED') {
    return NetworkErrorType.CONNECTION_REFUSED;
  }
  if (errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT') {
    return NetworkErrorType.TIMEOUT;
  }
  if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
    return NetworkErrorType.DNS_FAILURE;
  }
  if (errorCode === 'ENETUNREACH' || errorCode === 'EHOSTUNREACH') {
    return NetworkErrorType.NETWORK_UNREACHABLE;
  }

  // Check message patterns
  if (message.includes('timeout') || message.includes('timed out')) {
    return NetworkErrorType.TIMEOUT;
  }
  if (message.includes('connection refused') || message.includes('econnrefused')) {
    return NetworkErrorType.CONNECTION_REFUSED;
  }
  if (message.includes('dns') || message.includes('not found') || message.includes('enotfound')) {
    return NetworkErrorType.DNS_FAILURE;
  }
  if (message.includes('ssl') || message.includes('certificate') || message.includes('cert')) {
    return NetworkErrorType.SSL_ERROR;
  }
  if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
    return NetworkErrorType.RATE_LIMIT;
  }
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return NetworkErrorType.SERVER_ERROR;
  }
  if (message.includes('400') || message.includes('401') || message.includes('403') || message.includes('404')) {
    return NetworkErrorType.CLIENT_ERROR;
  }
  if (message.includes('network') || message.includes('unreachable')) {
    return NetworkErrorType.NETWORK_UNREACHABLE;
  }

  return NetworkErrorType.UNKNOWN;
}

/**
 * Determines connection status based on error type
 */
function getConnectionStatus(errorType: NetworkErrorType): ConnectionStatus {
  switch (errorType) {
    case NetworkErrorType.CONNECTION_REFUSED:
    case NetworkErrorType.NETWORK_UNREACHABLE:
    case NetworkErrorType.DNS_FAILURE:
      return ConnectionStatus.OFFLINE;
    case NetworkErrorType.TIMEOUT:
    case NetworkErrorType.RATE_LIMIT:
      return ConnectionStatus.DEGRADED;
    case NetworkErrorType.SERVER_ERROR:
      return ConnectionStatus.DEGRADED;
    default:
      return ConnectionStatus.UNKNOWN;
  }
}

/**
 * Network Error Boundary for handling API and network errors
 */
export class NetworkErrorBoundary extends Component<
  NetworkErrorBoundaryProps,
  NetworkErrorBoundaryState
> {
  private retryTimeout: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;

  constructor(props: NetworkErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRetrying: false,
      connectionStatus: ConnectionStatus.ONLINE,
      nextRetryIn: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<NetworkErrorBoundaryState> {
    const errorType = detectNetworkErrorType(error);
    const connectionStatus = getConnectionStatus(errorType);

    return {
      hasError: true,
      error,
      connectionStatus,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error details
    const errorType = detectNetworkErrorType(error);
    const endpoint = this.props.apiEndpoint || 'Unknown endpoint';
    const errorCode = (error as { code?: string }).code;

    logger.error('[NetworkErrorBoundary] Network/API error', error, {
      endpoint,
      errorType,
      errorCode: errorCode || 'N/A',
      connectionStatus: this.state.connectionStatus,
      componentStack: errorInfo.componentStack
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Auto-retry for certain error types
    const autoRetryTypes = [
      NetworkErrorType.TIMEOUT,
      NetworkErrorType.SERVER_ERROR,
      NetworkErrorType.RATE_LIMIT,
    ];

    if (autoRetryTypes.includes(errorType)) {
      this.scheduleRetry();
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }

  scheduleRetry = (): void => {
    const maxRetries = this.props.maxRetries || 5;

    if (this.state.retryCount >= maxRetries) {
      return;
    }

    // Exponential backoff with jitter: base * 2^retry + random(0-1000ms)
    const baseDelay = 2000; // 2 seconds
    const exponentialDelay = baseDelay * Math.pow(2, this.state.retryCount);
    const jitter = Math.random() * 1000;
    const delay = Math.min(exponentialDelay + jitter, 60000); // Max 60 seconds

    this.setState({ isRetrying: true, nextRetryIn: Math.floor(delay / 1000) });

    // Update countdown
    this.countdownInterval = setInterval(() => {
      this.setState((prev) => ({
        nextRetryIn: Math.max(0, prev.nextRetryIn - 1),
      }));
    }, 1000);

    this.retryTimeout = setTimeout(() => {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }

      this.setState((prev) => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prev.retryCount + 1,
        isRetrying: false,
        connectionStatus: ConnectionStatus.CHECKING,
        nextRetryIn: 0,
      }));

      // Call retry callback if provided
      if (this.props.onRetry) {
        this.props.onRetry();
      }
    }, delay);
  };

  handleManualRetry = (): void => {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isRetrying: false,
      connectionStatus: ConnectionStatus.CHECKING,
      nextRetryIn: 0,
    });

    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  handleOfflineMode = (): void => {
    if (this.props.onOfflineMode) {
      this.props.onOfflineMode();
    }
  };

  getErrorMessage(): string {
    if (!this.state.error) {
      return 'An unexpected network error occurred';
    }

    const errorType = detectNetworkErrorType(this.state.error);

    switch (errorType) {
      case NetworkErrorType.CONNECTION_REFUSED:
        return 'Connection refused. The server is not accepting connections.';
      case NetworkErrorType.TIMEOUT:
        return 'Request timed out. The server took too long to respond.';
      case NetworkErrorType.DNS_FAILURE:
        return 'DNS lookup failed. Could not resolve the server address.';
      case NetworkErrorType.SSL_ERROR:
        return 'SSL/TLS error. There is a problem with the server certificate.';
      case NetworkErrorType.RATE_LIMIT:
        return 'Rate limit exceeded. Too many requests sent to the server.';
      case NetworkErrorType.SERVER_ERROR:
        return 'Server error. The server encountered an internal error.';
      case NetworkErrorType.CLIENT_ERROR:
        return `Client error: ${this.state.error.message}`;
      case NetworkErrorType.NETWORK_UNREACHABLE:
        return 'Network unreachable. Check your internet connection.';
      default:
        return `Network error: ${this.state.error.message}`;
    }
  }

  getConnectionStatusColor(): string {
    switch (this.state.connectionStatus) {
      case ConnectionStatus.ONLINE:
        return 'green';
      case ConnectionStatus.OFFLINE:
        return 'red';
      case ConnectionStatus.DEGRADED:
        return 'yellow';
      case ConnectionStatus.CHECKING:
        return 'cyan';
      default:
        return 'gray';
    }
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const maxRetries = this.props.maxRetries || 5;
      const canRetry = this.state.retryCount < maxRetries && this.props.onRetry;
      const errorType = detectNetworkErrorType(this.state.error);

      return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
          <Box marginBottom={1}>
            <Text color="red" bold>
              Network Error
            </Text>
            {this.props.apiEndpoint && (
              <Text color="gray"> ({this.props.apiEndpoint})</Text>
            )}
          </Box>

          <Box marginBottom={1}>
            <Text color={this.getConnectionStatusColor()}>
              Status: {this.state.connectionStatus}
            </Text>
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
                Error Code: {(this.state.error as { code?: string }).code || 'N/A'}
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
                <Box>
                  <Text color="cyan">
                    Retrying in {this.state.nextRetryIn}s...
                  </Text>
                  <Text color="gray">
                    {' '}(Attempt {this.state.retryCount + 1}/{maxRetries})
                  </Text>
                </Box>
              ) : (
                <Box>
                  <Text color="green">
                    Retry available ({this.state.retryCount}/{maxRetries})
                  </Text>
                  <Text color="gray"> - Press R to retry now</Text>
                </Box>
              )}
            </Box>
          )}

          {!canRetry && this.state.retryCount >= maxRetries && (
            <Box marginTop={1}>
              <Text color="red">
                Maximum retry attempts reached. Please check your connection and try again.
              </Text>
            </Box>
          )}

          {this.props.onOfflineMode && (
            <Box marginTop={1}>
              <Text color="cyan">
                Offline mode available - Press O to continue without network
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
 * Hook to wrap components with Network Error Boundary
 */
interface WithNetworkErrorBoundaryOptions {
  onRetry?: () => void;
  onOfflineMode?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  maxRetries?: number;
  showDetails?: boolean;
  apiEndpoint?: string;
}

export function withNetworkErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithNetworkErrorBoundaryOptions = {}
): React.FC<P> {
  const WithNetworkErrorBoundaryComponent: React.FC<P> = (props) => (
    <NetworkErrorBoundary
      onRetry={options.onRetry}
      onOfflineMode={options.onOfflineMode}
      onError={options.onError}
      maxRetries={options.maxRetries}
      showDetails={options.showDetails}
      apiEndpoint={options.apiEndpoint}
    >
      <WrappedComponent {...props} />
    </NetworkErrorBoundary>
  );

  WithNetworkErrorBoundaryComponent.displayName = `WithNetworkErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithNetworkErrorBoundaryComponent;
}

export default NetworkErrorBoundary;
