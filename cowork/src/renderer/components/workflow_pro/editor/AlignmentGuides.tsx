// @ts-nocheck
/**
 * Alignment Guides Component
 * Shows visual guides when nodes are aligned horizontally or vertically
 * Similar to design tools like Figma, Sketch, etc.
 */

import React, { useMemo, memo } from 'react';
import { useStore, ReactFlowState } from '@xyflow/react';
import { useWorkflowStore } from '../store';

// Alignment threshold in pixels
const ALIGNMENT_THRESHOLD = 10;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

interface AlignmentLine {
  type: 'horizontal' | 'vertical';
  position: number;
  start: number;
  end: number;
  alignedNodes: string[];
}

interface AlignmentGuidesProps {
  enabled?: boolean;
}

const AlignmentGuides: React.FC<AlignmentGuidesProps> = ({ enabled = true }) => {
  const transform = useStore((state: ReactFlowState) => state.transform);
  const nodes = useWorkflowStore((state) => state.nodes);
  const selectedNodes = useWorkflowStore((state) => state.selectedNodes);
  const selectedNode = useWorkflowStore((state) => state.selectedNode);

  // Calculate alignment lines
  const alignmentLines = useMemo<AlignmentLine[]>(() => {
    if (!enabled) return [];

    // Get currently selected/dragging nodes
    const draggingNodeIds = selectedNodes.length > 0
      ? selectedNodes
      : selectedNode
        ? [selectedNode.id]
        : [];

    if (draggingNodeIds.length === 0) return [];

    const lines: AlignmentLine[] = [];
    const otherNodes = nodes.filter(n => !draggingNodeIds.includes(n.id));
    const draggingNodes = nodes.filter(n => draggingNodeIds.includes(n.id));

    if (draggingNodes.length === 0 || otherNodes.length === 0) return [];

    // Calculate alignment for each dragging node
    for (const dragNode of draggingNodes) {
      const dragCenterX = dragNode.position.x + NODE_WIDTH / 2;
      const dragCenterY = dragNode.position.y + NODE_HEIGHT / 2;
      const dragLeft = dragNode.position.x;
      const dragRight = dragNode.position.x + NODE_WIDTH;
      const dragTop = dragNode.position.y;
      const dragBottom = dragNode.position.y + NODE_HEIGHT;

      for (const otherNode of otherNodes) {
        const otherCenterX = otherNode.position.x + NODE_WIDTH / 2;
        const otherCenterY = otherNode.position.y + NODE_HEIGHT / 2;
        const otherLeft = otherNode.position.x;
        const otherRight = otherNode.position.x + NODE_WIDTH;
        const otherTop = otherNode.position.y;
        const otherBottom = otherNode.position.y + NODE_HEIGHT;

        // Horizontal alignments (same Y)
        // Center to Center
        if (Math.abs(dragCenterY - otherCenterY) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'horizontal',
            position: otherCenterY,
            start: Math.min(dragLeft, otherLeft) - 20,
            end: Math.max(dragRight, otherRight) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Top to Top
        if (Math.abs(dragTop - otherTop) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'horizontal',
            position: otherTop,
            start: Math.min(dragLeft, otherLeft) - 20,
            end: Math.max(dragRight, otherRight) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Bottom to Bottom
        if (Math.abs(dragBottom - otherBottom) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'horizontal',
            position: otherBottom,
            start: Math.min(dragLeft, otherLeft) - 20,
            end: Math.max(dragRight, otherRight) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Top to Bottom (spacing)
        if (Math.abs(dragTop - otherBottom) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'horizontal',
            position: (dragTop + otherBottom) / 2,
            start: Math.min(dragLeft, otherLeft) - 20,
            end: Math.max(dragRight, otherRight) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }

        // Vertical alignments (same X)
        // Center to Center
        if (Math.abs(dragCenterX - otherCenterX) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'vertical',
            position: otherCenterX,
            start: Math.min(dragTop, otherTop) - 20,
            end: Math.max(dragBottom, otherBottom) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Left to Left
        if (Math.abs(dragLeft - otherLeft) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'vertical',
            position: otherLeft,
            start: Math.min(dragTop, otherTop) - 20,
            end: Math.max(dragBottom, otherBottom) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Right to Right
        if (Math.abs(dragRight - otherRight) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'vertical',
            position: otherRight,
            start: Math.min(dragTop, otherTop) - 20,
            end: Math.max(dragBottom, otherBottom) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
        // Left to Right (spacing)
        if (Math.abs(dragLeft - otherRight) < ALIGNMENT_THRESHOLD) {
          lines.push({
            type: 'vertical',
            position: (dragLeft + otherRight) / 2,
            start: Math.min(dragTop, otherTop) - 20,
            end: Math.max(dragBottom, otherBottom) + 20,
            alignedNodes: [dragNode.id, otherNode.id],
          });
        }
      }
    }

    // Deduplicate lines
    const uniqueLines = lines.reduce((acc: AlignmentLine[], line) => {
      const exists = acc.some(
        l => l.type === line.type && Math.abs(l.position - line.position) < 2
      );
      if (!exists) {
        acc.push(line);
      }
      return acc;
    }, []);

    return uniqueLines;
  }, [enabled, nodes, selectedNodes, selectedNode]);

  if (!enabled || alignmentLines.length === 0) return null;

  const [tx, ty, scale] = transform;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <defs>
        {/* Gradient for alignment lines */}
        <linearGradient id="alignmentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0" />
          <stop offset="20%" stopColor="#f43f5e" stopOpacity="1" />
          <stop offset="80%" stopColor="#f43f5e" stopOpacity="1" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="alignmentGradientV" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0" />
          <stop offset="20%" stopColor="#f43f5e" stopOpacity="1" />
          <stop offset="80%" stopColor="#f43f5e" stopOpacity="1" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {alignmentLines.map((line, index) => {
        if (line.type === 'horizontal') {
          const y = line.position * scale + ty;
          const x1 = line.start * scale + tx;
          const x2 = line.end * scale + tx;

          return (
            <g key={`h-${index}`}>
              {/* Glow effect */}
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="#f43f5e"
                strokeWidth={4}
                strokeOpacity={0.3}
                style={{ filter: 'blur(2px)' }}
              />
              {/* Main line */}
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="url(#alignmentGradient)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              {/* Circle markers at ends */}
              <circle cx={x1} cy={y} r={3} fill="#f43f5e" />
              <circle cx={x2} cy={y} r={3} fill="#f43f5e" />
            </g>
          );
        } else {
          const x = line.position * scale + tx;
          const y1 = line.start * scale + ty;
          const y2 = line.end * scale + ty;

          return (
            <g key={`v-${index}`}>
              {/* Glow effect */}
              <line
                x1={x}
                y1={y1}
                x2={x}
                y2={y2}
                stroke="#f43f5e"
                strokeWidth={4}
                strokeOpacity={0.3}
                style={{ filter: 'blur(2px)' }}
              />
              {/* Main line */}
              <line
                x1={x}
                y1={y1}
                x2={x}
                y2={y2}
                stroke="url(#alignmentGradientV)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              {/* Circle markers at ends */}
              <circle cx={x} cy={y1} r={3} fill="#f43f5e" />
              <circle cx={x} cy={y2} r={3} fill="#f43f5e" />
            </g>
          );
        }
      })}
    </svg>
  );
};

export default memo(AlignmentGuides);
