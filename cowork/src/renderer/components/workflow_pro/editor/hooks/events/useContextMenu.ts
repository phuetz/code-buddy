// @ts-nocheck
/**
 * useContextMenu
 *
 * Handles right-click context menu on nodes.
 */

import { useCallback } from 'react';
import { Node } from '@xyflow/react';
import { usePanels } from '../../context';

export interface UseContextMenuReturn {
  handleNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
}

/**
 * Hook for handling context menu events
 */
export function useContextMenu(): UseContextMenuReturn {
  const { setContextMenu } = usePanels();

  /**
   * Handle right-click on a node
   */
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({
        nodeId: node.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [setContextMenu]
  );

  return {
    handleNodeContextMenu,
  };
}

export default useContextMenu;
