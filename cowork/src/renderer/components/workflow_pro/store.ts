// @ts-nocheck
import { create } from 'zustand';
import { Edge, Node } from '@xyflow/react';

export const useWorkflowStore = create<any>((set) => ({
  nodes: [],
  edges: [],
  setNodes: (nodes: any) => set({ nodes }),
  setEdges: (edges: any) => set({ edges }),
  onNodesChange: () => {},
  onEdgesChange: () => {},
  onConnect: () => {},
  // Add more default mocked values as needed
}));
