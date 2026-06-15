// @ts-nocheck
import { useCallback, useState } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { useReactFlow, Node } from '@xyflow/react';
import { useWorkflowStore } from '../../../store';
import { notificationService } from '../../../service-mocks';

const elk = new ELK();

// Default configuration for ELK
const elkOptions = {
  'elk.algorithm': 'layered',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100', // Vertical spacing
  'elk.spacing.nodeNode': '80', // Horizontal spacing
  'elk.direction': 'RIGHT', // Workflow flows Left to Right usually, or TOP to BOTTOM
  'elk.edgeRouting': 'SPLINES',
};

/**
 * useElkLayout Hook
 * Provides an advanced, extremely fluid auto-layout algorithm for nodes using ELK.js
 * Far superior to Dagre for complex graphs and handles port routing better.
 */
export function useElkLayout() {
  const { setNodes, setEdges, addToHistory } = useWorkflowStore();
  const { fitView } = useReactFlow();
  const [isLayingOut, setIsLayingOut] = useState(false);

  const performAutoLayout = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'RIGHT') => {
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      if (currentNodes.length === 0) return;

      setIsLayingOut(true);

      try {
        const graph = {
          id: 'root',
          layoutOptions: {
            ...elkOptions,
            'elk.direction': direction,
          },
          children: currentNodes.map((node) => ({
            id: node.id,
            width: 250, // Typical custom node width
            height: 100, // Typical custom node height
            // Pass current positions as a starting hint if desired
            x: node.position.x,
            y: node.position.y,
          })),
          edges: currentEdges.map((edge) => ({
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target],
          })),
        };

        const layoutedGraph = await elk.layout(graph);

        if (!layoutedGraph.children) return;

        // Map layouted positions back to ReactFlow nodes
        const layoutedNodes: Node[] = currentNodes.map((node) => {
          const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);
          if (!elkNode) return node;

          return {
            ...node,
            position: {
              x: elkNode.x || node.position.x,
              y: elkNode.y || node.position.y,
            },
            // Optional: We can add an animation flag that CustomNode consumes
            data: { ...node.data, _isAnimatingLayout: true }
          };
        });

        // Save history state before layout
        addToHistory(currentNodes, currentEdges);

        // Apply new layout
        setNodes(layoutedNodes);
        
        // Fluid camera zoom to fit new layout
        setTimeout(() => {
          fitView({ duration: 800, padding: 0.2 });
        }, 50);

        notificationService.success('Layout Optimized', 'Workflow organized successfully.');
      } catch (error) {
        console.error('ELK Layout Error:', error);
        notificationService.error('Layout Failed', 'Could not optimize workflow layout.');
      } finally {
        setIsLayingOut(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setNodes, setEdges, addToHistory, fitView]
  );

  return { performAutoLayout, isLayingOut };
}
