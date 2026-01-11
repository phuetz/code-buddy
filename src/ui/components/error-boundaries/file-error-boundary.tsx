/**
 * File Error Boundary Component
 *
 * Specialized error boundary for catching and handling file system errors.
 * Provides detailed error information, recovery actions for common file system issues,
 * and permission handling.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger.js';

interface FileErrorBoundaryProps {
  children: ReactNode;
  filePath?: string;
  onRetry?: () => void;
  onCreateDirectory?: (dirPath: string) => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  autoCreateDirectories?: boolean;
}

interface FileErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  fileErrorType: FileErrorType;
  suggestedAction: string | null;
  isRecovering: boolean;
}

/**
 * File system error types
 */
export enum FileErrorType {
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  IS_DIRECTORY = 'IS_DIRECTORY',
  NOT_DIRECTORY = 'NOT_DIRECTORY',
  DISK_FULL = 'DISK_FULL',
  READ_ONLY = 'READ_ONLY',
  INVALID_PATH = 'INVALID_PATH',
  SYMLINK_LOOP = 'SYMLINK_LOOP',
  TOO_MANY_OPEN = 'TOO_MANY_OPEN',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Detects the type of file system error based on error code and message
 */
function detectFileErrorType(error: Error): FileErrorType {
  const errorCode = (error as { code?: string }).code;
  const message = error.message.toLowerCase();

  // Check error codes (Node.js file system error codes)
  switch (errorCode) {
    case 'ENOENT':
      return FileErrorType.NOT_FOUND;
    case 'EACCES':
    case 'EPERM':
      return FileErrorType.PERMISSION_DENIED;
    case 'EEXIST':
      return FileErrorType.ALREADY_EXISTS;
    case 'EISDIR':
      return FileErrorType.IS_DIRECTORY;
    case 'ENOTDIR':
      return FileErrorType.NOT_DIRECTORY;
    case 'ENOSPC':
      return FileErrorType.DISK_FULL;
    case 'EROFS':
      return FileErrorType.READ_ONLY;
    case 'EINVAL':
      return FileErrorType.INVALID_PATH;
    case 'ELOOP':
      return FileErrorType.SYMLINK_LOOP;
    case 'EMFILE':
    case 'ENFILE':
      return FileErrorType.TOO_MANY_OPEN;
  }

  // Check message patterns as fallback
  if (message.includes('not found') || message.includes('no such file')) {
    return FileErrorType.NOT_FOUND;
  }
  if (message.includes('permission') || message.includes('access denied')) {
    return FileErrorType.PERMISSION_DENIED;
  }
  if (message.includes('already exists') || message.includes('file exists')) {
    return FileErrorType.ALREADY_EXISTS;
  }
  if (message.includes('is a directory')) {
    return FileErrorType.IS_DIRECTORY;
  }
  if (message.includes('not a directory')) {
    return FileErrorType.NOT_DIRECTORY;
  }
  if (message.includes('disk full') || message.includes('no space')) {
    return FileErrorType.DISK_FULL;
  }
  if (message.includes('read-only')) {
    return FileErrorType.READ_ONLY;
  }

  return FileErrorType.UNKNOWN;
}

/**
 * Extracts file path from error message or props
 */
function extractFilePath(error: Error, propsPath?: string): string | null {
  if (propsPath) {
    return propsPath;
  }

  const pathMatch = error.message.match(/'([^']+)'/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }

  return null;
}

/**
 * Suggests recovery action based on error type
 */
function getSuggestedAction(errorType: FileErrorType, filePath: string | null): string | null {
  switch (errorType) {
    case FileErrorType.NOT_FOUND:
      if (filePath) {
        const dir = path.dirname(filePath);
        return `Create missing directory: ${dir}`;
      }
      return 'Check if the file path is correct';

    case FileErrorType.PERMISSION_DENIED:
      return 'Check file permissions or run with appropriate privileges';

    case FileErrorType.ALREADY_EXISTS:
      return 'Use a different file name or remove the existing file';

    case FileErrorType.IS_DIRECTORY:
      return 'The path points to a directory, not a file';

    case FileErrorType.NOT_DIRECTORY:
      return 'The path component is not a directory';

    case FileErrorType.DISK_FULL:
      return 'Free up disk space and try again';

    case FileErrorType.READ_ONLY:
      return 'The file system is read-only';

    case FileErrorType.INVALID_PATH:
      return 'The file path contains invalid characters';

    case FileErrorType.SYMLINK_LOOP:
      return 'The path contains a symbolic link loop';

    case FileErrorType.TOO_MANY_OPEN:
      return 'Too many files are open. Close some files and try again';

    default:
      return null;
  }
}

/**
 * File Error Boundary for handling file system errors
 */
export class FileErrorBoundary extends Component<
  FileErrorBoundaryProps,
  FileErrorBoundaryState
> {
  constructor(props: FileErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      fileErrorType: FileErrorType.UNKNOWN,
      suggestedAction: null,
      isRecovering: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<FileErrorBoundaryState> {
    const fileErrorType = detectFileErrorType(error);
    return {
      hasError: true,
      error,
      fileErrorType,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const fileErrorType = detectFileErrorType(error);
    const filePath = extractFilePath(error, this.props.filePath);
    const suggestedAction = getSuggestedAction(fileErrorType, filePath);

    this.setState({ errorInfo, suggestedAction });

    // Log error details
    logger.error('[FileErrorBoundary] File system error', error, {
      filePath: filePath || 'Unknown',
      errorType: fileErrorType,
      errorCode: (error as { code?: string }).code || 'N/A'
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Auto-recover for certain error types
    if (
      this.props.autoCreateDirectories &&
      fileErrorType === FileErrorType.NOT_FOUND &&
      filePath
    ) {
      this.handleAutoCreateDirectory(filePath);
    }
  }

  handleAutoCreateDirectory = async (filePath: string): Promise<void> => {
    const dir = path.dirname(filePath);

    try {
      this.setState({ isRecovering: true });

      // Check if directory already exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`[FileErrorBoundary] Created directory: ${dir}`);

        // Notify callback
        if (this.props.onCreateDirectory) {
          this.props.onCreateDirectory(dir);
        }

        // Reset error state to retry
        setTimeout(() => {
          this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            isRecovering: false,
          });

          if (this.props.onRetry) {
            this.props.onRetry();
          }
        }, 1000);
      }
    } catch (recoveryError) {
      logger.error('[FileErrorBoundary] Failed to create directory', recoveryError as Error);
      this.setState({ isRecovering: false });
    }
  };

  handleManualRecovery = (): void => {
    const filePath = extractFilePath(this.state.error!, this.props.filePath);

    if (
      this.state.fileErrorType === FileErrorType.NOT_FOUND &&
      filePath &&
      this.props.onCreateDirectory
    ) {
      this.handleAutoCreateDirectory(filePath);
    }
  };

  getErrorMessage(): string {
    if (!this.state.error) {
      return 'An unexpected file system error occurred';
    }

    const filePath = extractFilePath(this.state.error, this.props.filePath);
    const fileDisplay = filePath ? ` '${filePath}'` : '';

    switch (this.state.fileErrorType) {
      case FileErrorType.NOT_FOUND:
        return `File or directory${fileDisplay} not found`;
      case FileErrorType.PERMISSION_DENIED:
        return `Permission denied accessing${fileDisplay}`;
      case FileErrorType.ALREADY_EXISTS:
        return `File${fileDisplay} already exists`;
      case FileErrorType.IS_DIRECTORY:
        return `Expected a file but found a directory${fileDisplay}`;
      case FileErrorType.NOT_DIRECTORY:
        return `Expected a directory but found a file${fileDisplay}`;
      case FileErrorType.DISK_FULL:
        return 'Disk is full - no space available';
      case FileErrorType.READ_ONLY:
        return `File system is read-only for${fileDisplay}`;
      case FileErrorType.INVALID_PATH:
        return `Invalid file path${fileDisplay}`;
      case FileErrorType.SYMLINK_LOOP:
        return `Symbolic link loop detected in${fileDisplay}`;
      case FileErrorType.TOO_MANY_OPEN:
        return 'Too many files are open';
      default:
        return `File system error: ${this.state.error.message}`;
    }
  }

  getErrorIcon(): string {
    switch (this.state.fileErrorType) {
      case FileErrorType.NOT_FOUND:
        return '📁';
      case FileErrorType.PERMISSION_DENIED:
        return '🔒';
      case FileErrorType.ALREADY_EXISTS:
        return '⚠️';
      case FileErrorType.DISK_FULL:
        return '💾';
      case FileErrorType.READ_ONLY:
        return '🔐';
      default:
        return '❌';
    }
  }

  canRecover(): boolean {
    return (
      this.state.fileErrorType === FileErrorType.NOT_FOUND &&
      this.props.onCreateDirectory !== undefined
    );
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const filePath = extractFilePath(this.state.error, this.props.filePath);
      const canRecover = this.canRecover();

      return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
          <Box marginBottom={1}>
            <Text color="red" bold>
              {this.getErrorIcon()} File System Error
            </Text>
          </Box>

          {filePath && (
            <Box marginBottom={1}>
              <Text color="cyan">Path: </Text>
              <Text color="white">{filePath}</Text>
            </Box>
          )}

          <Box marginBottom={1}>
            <Text color="yellow">{this.getErrorMessage()}</Text>
          </Box>

          {this.state.suggestedAction && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="green">Suggested action:</Text>
              <Text color="white">  {this.state.suggestedAction}</Text>
            </Box>
          )}

          {this.props.showDetails && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="gray" dimColor>
                Error Type: {this.state.fileErrorType}
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

          {this.state.isRecovering && (
            <Box marginTop={1}>
              <Text color="cyan">Attempting to recover...</Text>
            </Box>
          )}

          {canRecover && !this.state.isRecovering && (
            <Box marginTop={1}>
              <Text color="green">
                Recovery available - Press C to create missing directories
              </Text>
            </Box>
          )}

          {this.props.onRetry && !this.state.isRecovering && (
            <Box marginTop={1}>
              <Text color="cyan">Press R to retry</Text>
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
 * Hook to wrap components with File Error Boundary
 */
interface WithFileErrorBoundaryOptions {
  filePath?: string;
  onRetry?: () => void;
  onCreateDirectory?: (dirPath: string) => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  autoCreateDirectories?: boolean;
}

export function withFileErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithFileErrorBoundaryOptions = {}
): React.FC<P> {
  const WithFileErrorBoundaryComponent: React.FC<P> = (props) => (
    <FileErrorBoundary
      filePath={options.filePath}
      onRetry={options.onRetry}
      onCreateDirectory={options.onCreateDirectory}
      onError={options.onError}
      showDetails={options.showDetails}
      autoCreateDirectories={options.autoCreateDirectories}
    >
      <WrappedComponent {...props} />
    </FileErrorBoundary>
  );

  WithFileErrorBoundaryComponent.displayName = `WithFileErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithFileErrorBoundaryComponent;
}

export default FileErrorBoundary;
