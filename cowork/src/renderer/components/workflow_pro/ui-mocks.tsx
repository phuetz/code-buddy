// @ts-nocheck
import React from 'react';

export const UnifiedHeader = (props: any) => <div {...props} />;
export const UnifiedSidebar = (props: any) => <div {...props} />;
export const CustomNode = (props: any) => <div {...props} />;
export const N8NStyleNode = (props: any) => <div {...props} />;
export const N8NStyleNodePanel = (props: any) => <div {...props} />;
export const NodeConfigPanel = (props: any) => <div {...props} />;
export const SubworkflowNode = (props: any) => <div {...props} />;
export const StickyNoteNode = (props: any) => <div {...props} />;
export const N8NStyleEdge = (props: any) => <div {...props} />;
export const CanvasSelectionToolbar = (props: any) => <div {...props} />;
export const NodePinButton = (props: any) => <div {...props} />;
export const FocusTrapWrapper = (props: any) => <div {...props}>{props.children}</div>;
export const NodeErrorDetail = (props: any) => <div {...props} />;
export const FocusPanel = (props: any) => <div {...props} />;
export const NodeRunDataInspector = (props: any) => <div {...props} />;
export const ExecutionRetriever = { getExecutionHistory: async () => [] };

export default { NodeConfigPanel, CanvasSelectionToolbar, NodeRunDataInspector };
