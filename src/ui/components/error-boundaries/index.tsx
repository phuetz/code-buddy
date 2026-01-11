/**
 * Error Boundaries Index
 *
 * Centralized exports for all specialized error boundary components.
 * These components provide robust error handling for different failure scenarios
 * in the React/Ink terminal UI.
 */

import React, { ReactNode } from 'react';

// Import all error boundaries and their utilities
import {
  ToolErrorBoundary,
  withToolErrorBoundary,
  ToolErrorType,
} from './tool-error-boundary';

import {
  NetworkErrorBoundary,
  withNetworkErrorBoundary,
  NetworkErrorType,
  ConnectionStatus,
} from './network-error-boundary';

import {
  FileErrorBoundary,
  withFileErrorBoundary,
  FileErrorType,
} from './file-error-boundary';

// Re-export all components and utilities
export { ToolErrorBoundary, withToolErrorBoundary, ToolErrorType };
export { NetworkErrorBoundary, withNetworkErrorBoundary, NetworkErrorType, ConnectionStatus };
export { FileErrorBoundary, withFileErrorBoundary, FileErrorType };

// Re-export base error boundary for convenience
export { ErrorBoundary, withErrorBoundary, StreamingErrorBoundary } from '../ErrorBoundary';

/**
 * Composite error boundary that combines all specialized boundaries
 *
 * Usage:
 * ```tsx
 * <CompositeErrorBoundary>
 *   <YourComponent />
 * </CompositeErrorBoundary>
 * ```
 */
interface CompositeErrorBoundaryProps {
  children: ReactNode;
  toolName?: string;
  apiEndpoint?: string;
  filePath?: string;
  showDetails?: boolean;
  onError?: (error: Error, source: 'tool' | 'network' | 'file') => void;
}

export const CompositeErrorBoundary: React.FC<CompositeErrorBoundaryProps> = ({
  children,
  toolName,
  apiEndpoint,
  filePath,
  showDetails = false,
  onError,
}) => {
  return (
    <NetworkErrorBoundary
      apiEndpoint={apiEndpoint}
      showDetails={showDetails}
      onError={(error) => onError?.(error, 'network')}
    >
      <FileErrorBoundary
        filePath={filePath}
        showDetails={showDetails}
        onError={(error) => onError?.(error, 'file')}
        autoCreateDirectories={true}
      >
        <ToolErrorBoundary
          toolName={toolName}
          showDetails={showDetails}
          onError={(error) => onError?.(error, 'tool')}
        >
          {children}
        </ToolErrorBoundary>
      </FileErrorBoundary>
    </NetworkErrorBoundary>
  );
};

/**
 * Error boundary selector - automatically chooses the appropriate boundary based on error type
 */
export function createErrorBoundary(type: 'tool' | 'network' | 'file' | 'composite') {
  switch (type) {
    case 'tool':
      return ToolErrorBoundary;
    case 'network':
      return NetworkErrorBoundary;
    case 'file':
      return FileErrorBoundary;
    case 'composite':
      return CompositeErrorBoundary;
    default:
      return ToolErrorBoundary;
  }
}

/**
 * Helper to detect error type from error object
 */
export function detectErrorBoundaryType(
  error: Error
): 'tool' | 'network' | 'file' | 'unknown' {
  const message = error.message.toLowerCase();
  const errorCode = (error as { code?: string }).code;

  // Check for file system errors
  const fileCodes = [
    'ENOENT',
    'EACCES',
    'EPERM',
    'EEXIST',
    'EISDIR',
    'ENOTDIR',
    'ENOSPC',
    'EROFS',
  ];
  if (errorCode && fileCodes.includes(errorCode)) {
    return 'file';
  }

  // Check for network errors
  const networkCodes = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ];
  if (errorCode && networkCodes.includes(errorCode)) {
    return 'network';
  }

  // Check message patterns
  if (
    message.includes('file') ||
    message.includes('directory') ||
    message.includes('path')
  ) {
    return 'file';
  }

  if (
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes('api')
  ) {
    return 'network';
  }

  if (message.includes('tool') || message.includes('execution')) {
    return 'tool';
  }

  return 'unknown';
}

// Default export for convenience
export default {
  ToolErrorBoundary,
  NetworkErrorBoundary,
  FileErrorBoundary,
  CompositeErrorBoundary,
  withToolErrorBoundary,
  withNetworkErrorBoundary,
  withFileErrorBoundary,
  createErrorBoundary,
  detectErrorBoundaryType,
};
