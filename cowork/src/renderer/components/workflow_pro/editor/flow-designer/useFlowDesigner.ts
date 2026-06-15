import { useState, useCallback } from 'react';
import { useWorkflowStore } from '../../store';
import { FlowPattern, UseFlowDesignerReturn } from './types';
import { flowPatterns } from './flowPatterns';

export function useFlowDesigner(onClose: () => void): UseFlowDesignerReturn {
  const { setNodes, setEdges, addToHistory, nodes, edges } = useWorkflowStore();

  const [selectedPattern, setSelectedPattern] = useState<FlowPattern | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  const getFilteredPatterns = useCallback(() => {
    return flowPatterns.filter(pattern => {
      const matchesCategory = filterCategory === 'all' || pattern.category === filterCategory;
      const matchesSearch = !searchTerm ||
        pattern.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pattern.description.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [filterCategory, searchTerm]);

  const applyPattern = useCallback((pattern: FlowPattern) => {
    // Adjust positions to avoid conflicts
    const offsetX = Math.random() * 100;
    const offsetY = Math.random() * 100;

    const adjustedNodes = pattern.template.nodes.map(node => ({
      ...node,
      id: `${node.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      position: {
        x: node.position.x + offsetX,
        y: node.position.y + offsetY
      }
    }));

    const nodeIdMap = new Map(
      pattern.template.nodes.map((node, index) => [node.id, adjustedNodes[index].id])
    );

    const adjustedEdges = pattern.template.edges.map(edge => ({
      ...edge,
      id: `${edge.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      source: nodeIdMap.get(edge.source)!,
      target: nodeIdMap.get(edge.target)!
    }));

    // Save to history
    addToHistory(nodes, edges);

    // Add new nodes and edges
    setNodes([...nodes, ...adjustedNodes]);
    setEdges([...edges, ...adjustedEdges]);

    setSelectedPattern(pattern);
    onClose();
  }, [nodes, edges, addToHistory, setNodes, setEdges, onClose]);

  return {
    selectedPattern,
    filterCategory,
    searchTerm,
    previewMode,
    setSelectedPattern,
    setFilterCategory,
    setSearchTerm,
    setPreviewMode,
    applyPattern,
    getFilteredPatterns
  };
}
