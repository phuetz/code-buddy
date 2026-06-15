/**
 * EditorHeader Component
 * Compact n8n-style header using UnifiedHeader in editor variant.
 */

import React from 'react';
import { UnifiedHeader } from '../../ui-mocks';

export type ViewMode = 'normal' | 'compact' | 'detailed';
export type ConnectionStyleType = 'bezier' | 'straight' | 'smoothstep';

export interface EditorHeaderProps {
  onExecute: () => void;
  onSave: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onDebug: () => void;
  isExecuting: boolean;
  // Remaining props kept for backward compat but no longer used by UnifiedHeader
  currentEnvironment?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  snapToGrid?: boolean;
  onSnapToGridChange?: (enabled: boolean) => void;
  showMiniMap?: boolean;
  onShowMiniMapChange?: (visible: boolean) => void;
  showGrid?: boolean;
  onShowGridChange?: (visible: boolean) => void;
  connectionStyle?: ConnectionStyleType;
  onConnectionStyleChange?: (style: ConnectionStyleType) => void;
  autoLayout?: boolean;
  onAutoLayoutChange?: (enabled: boolean) => void;
  onApplyAutoLayout?: () => void;
  onOpenAIBuilder?: () => void;
  onOpenVisualDesigner?: () => void;
  onN8nImport?: () => void;
}

/**
 * EditorHeader - Compact n8n-style header for the workflow editor.
 * Delegates to UnifiedHeader with variant="editor".
 */
export const EditorHeader: React.FC<EditorHeaderProps> = ({
  onExecute,
  onSave,
  onExport,
  onImport,
  onDebug,
  isExecuting,
}) => {
  return (
    <UnifiedHeader
      variant="editor"
      onExecute={onExecute}
      onSave={onSave}
      onExport={onExport}
      onImport={onImport}
      onDebug={onDebug}
      isExecuting={isExecuting}
    />
  );
};

export default EditorHeader;
