// @ts-nocheck
/**
 * useConnectionHandlers
 *
 * Handles connection start/end events for proximity connect feature.
 * When a user drags a connection and drops it on empty space,
 * opens the quick search to create a connected node.
 */

import { useCallback } from 'react';
import type { OnConnectStart, OnConnectEnd } from '@xyflow/react';
import { usePanels } from '../../context';
import { notificationService } from '../../../service-mocks';

export interface UseConnectionHandlersOptions {
  /** Reference to pending connection state */
  pendingConnectionRef: React.MutableRefObject<{ nodeId: string; handleId: string | null } | null>;
  /** Reference to the ReactFlow wrapper */
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  /** Project screen coordinates to flow coordinates */
  project: (position: { x: number; y: number }) => { x: number; y: number };
}

export interface UseConnectionHandlersReturn {
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;
}

/**
 * Hook for handling connection events with proximity connect
 */
export function useConnectionHandlers(options: UseConnectionHandlersOptions): UseConnectionHandlersReturn {
  const { pendingConnectionRef, reactFlowWrapper: _reactFlowWrapper, project } = options;

  const { openPanel, setQuickSearchPosition } = usePanels();

  /**
   * Track where connection starts. v12 OnConnectStart receives a DOM
   * MouseEvent | TouchEvent and a params object that includes handleType.
   */
  const onConnectStart = useCallback<OnConnectStart>(
    (_event, { nodeId, handleId }) => {
      if (nodeId) {
        pendingConnectionRef.current = { nodeId, handleId };
      }
    },
    [pendingConnectionRef]
  );

  /**
   * Handle connection end - proximity connect. v12 provides a structured
   * `connectionState` so we don't have to inspect DOM classNames. When the
   * drop is not on a valid target, `connectionState.toNode` is null.
   */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const droppedOnEmpty = !connectionState.isValid && !connectionState.toNode;

      if (droppedOnEmpty && pendingConnectionRef.current) {
        const clientX = 'clientX' in event ? event.clientX : event.changedTouches[0].clientX;
        const clientY = 'clientY' in event ? event.clientY : event.changedTouches[0].clientY;

        // v12: screenToFlowPosition handles wrapper offset internally
        const position = project({ x: clientX, y: clientY });

        setQuickSearchPosition({ x: position.x, y: position.y });
        openPanel('nodeSearch');

        try {
          localStorage.setItem('pendingConnection', JSON.stringify(pendingConnectionRef.current));
        } catch { /* localStorage may be disabled */ }

        notificationService.info('Quick Connect', 'Select a node to connect');
      }

      pendingConnectionRef.current = null;
    },
    [project, pendingConnectionRef, setQuickSearchPosition, openPanel]
  );

  return {
    onConnectStart,
    onConnectEnd,
  };
}

export default useConnectionHandlers;
