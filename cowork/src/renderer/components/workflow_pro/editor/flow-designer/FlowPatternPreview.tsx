import React from 'react';
import { useWorkflowStore } from '../../store';
import { FlowPattern } from './types';

interface FlowPatternPreviewProps {
  pattern: FlowPattern;
}

export const FlowPatternPreview: React.FC<FlowPatternPreviewProps> = ({ pattern }) => {
  const darkMode = useWorkflowStore(state => state.darkMode);

  return (
    <div className="w-full h-48 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-hidden relative">
      <svg viewBox="0 0 450 300" className="w-full h-full">
        {/* Render nodes */}
        {pattern.template.nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.position.x - 60}
              y={node.position.y - 20}
              width="120"
              height="40"
              rx="8"
              fill={darkMode ? '#374151' : '#f3f4f6'}
              stroke={darkMode ? '#6b7280' : '#d1d5db'}
              strokeWidth="2"
            />
            <text
              x={node.position.x}
              y={node.position.y + 5}
              textAnchor="middle"
              fontSize="12"
              fill={darkMode ? '#fff' : '#374151'}
            >
              {node.data.label}
            </text>
          </g>
        ))}

        {/* Render edges */}
        {pattern.template.edges.map((edge) => {
          const sourceNode = pattern.template.nodes.find(n => n.id === edge.source);
          const targetNode = pattern.template.nodes.find(n => n.id === edge.target);

          if (!sourceNode || !targetNode) return null;

          return (
            <g key={edge.id}>
              <line
                x1={sourceNode.position.x}
                y1={sourceNode.position.y + 20}
                x2={targetNode.position.x}
                y2={targetNode.position.y - 20}
                stroke={String(edge.style?.stroke || '#6b7280')}
                strokeWidth="2"
                strokeDasharray={edge.style?.strokeDasharray}
                markerEnd="url(#arrowhead)"
              />
              {edge.data?.condition && (
                <text
                  x={(sourceNode.position.x + targetNode.position.x) / 2}
                  y={(sourceNode.position.y + targetNode.position.y) / 2}
                  textAnchor="middle"
                  fontSize="10"
                  fill={String(edge.style?.stroke || '#6b7280')}
                  className="font-medium"
                >
                  {edge.data.condition}
                </text>
              )}
            </g>
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#6b7280"
            />
          </marker>
        </defs>
      </svg>
    </div>
  );
};
