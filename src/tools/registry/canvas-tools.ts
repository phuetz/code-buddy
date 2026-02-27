/**
 * Canvas Tool Adapters
 *
 * ITool-compliant adapters for A2UI and Visual Canvas tools.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

// ============================================================================
// Lazy-loaded instances
// ============================================================================

let a2uiToolInstance: InstanceType<typeof import('../../canvas/a2ui-tool.js').A2UITool> | null = null;
let visualWorkspaceInstance: InstanceType<typeof import('../../canvas/visual-workspace.js').VisualWorkspaceManager> | null = null;

async function getA2UITool() {
  if (!a2uiToolInstance) {
    const { A2UITool } = await import('../../canvas/a2ui-tool.js');
    a2uiToolInstance = new A2UITool();
  }
  return a2uiToolInstance;
}

async function getVisualWorkspace() {
  if (!visualWorkspaceInstance) {
    const { getVisualWorkspaceManager } = await import('../../canvas/visual-workspace.js');
    visualWorkspaceInstance = getVisualWorkspaceManager();
  }
  return visualWorkspaceInstance;
}

/**
 * Reset all shared instances (for testing)
 */
export function resetCanvasInstances(): void {
  a2uiToolInstance = null;
  visualWorkspaceInstance = null;
}

// ============================================================================
// A2UIExecuteTool — adapter for A2UITool
// ============================================================================

export class A2UIExecuteTool implements ITool {
  readonly name = 'a2ui';
  readonly description = 'Create and manage dynamic visual interfaces using the A2UI protocol';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getA2UITool();
    const result = await tool.execute(input as unknown as import('../../canvas/a2ui-tool.js').A2UIToolInput);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create_surface', 'delete_surface', 'add_component', 'add_components', 'update_data', 'begin_rendering', 'render_terminal', 'render_html', 'get_surface', 'list_surfaces', 'start_server', 'stop_server', 'server_status', 'get_data', 'get_component_state', 'canvas_snapshot'],
            description: 'The action to perform',
          },
          surfaceId: { type: 'string', description: 'Surface identifier' },
          component: { type: 'object', description: 'Component to add' },
          components: { type: 'array', description: 'Components to add' },
          data: { type: 'object', description: 'Data to update' },
          root: { type: 'string', description: 'Root component ID' },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.action !== 'string') return { valid: false, errors: ['action is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['a2ui', 'ui', 'surface', 'component', 'visual', 'interface'], priority: 3, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// CanvasExecuteTool — adapter for VisualWorkspaceManager
// ============================================================================

export class CanvasExecuteTool implements ITool {
  readonly name = 'canvas';
  readonly description = 'Create and manipulate visual canvases with positioned elements';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const mgr = await getVisualWorkspace();
    const action = input.action as string;
    const canvasId = input.canvasId as string | undefined;

    try {
      switch (action) {
        case 'create': {
          const ws = mgr.createWorkspace(input.config as Record<string, unknown> | undefined);
          return { success: true, output: `Canvas created: ${ws.id}` };
        }
        case 'delete': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const deleted = mgr.deleteWorkspace(canvasId);
          return deleted ? { success: true, output: `Canvas ${canvasId} deleted` } : { success: false, error: `Canvas ${canvasId} not found` };
        }
        case 'list': {
          const all = mgr.getAllWorkspaces();
          return { success: true, output: all.length > 0 ? all.map(w => `${w.id} (${w.elements.length} elements)`).join('\n') : 'No canvases' };
        }
        case 'add_element': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const el = input.element as Record<string, unknown> | undefined;
          if (!el) return { success: false, error: 'element is required' };
          const elem = mgr.addElement(
            canvasId,
            el.type as import('../../canvas/visual-workspace.js').VisualElementType,
            el.content,
            (el.position as { x: number; y: number }) || { x: 0, y: 0 },
            (el.size as { width: number; height: number }) || { width: 100, height: 50 },
            el.style as import('../../canvas/visual-workspace.js').VisualElementStyle | undefined,
          );
          return { success: true, output: `Element added: ${elem.id} (${elem.type})` };
        }
        case 'update_element': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const elementId = input.elementId as string;
          if (!elementId) return { success: false, error: 'elementId is required' };
          const updates = input.element as Record<string, unknown> || {};
          mgr.updateElement(canvasId, elementId, updates);
          return { success: true, output: `Element ${elementId} updated` };
        }
        case 'delete_element': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const delId = input.elementId as string;
          if (!delId) return { success: false, error: 'elementId is required' };
          mgr.deleteElement(canvasId, delId);
          return { success: true, output: `Element ${delId} removed` };
        }
        case 'move': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const moveId = input.elementId as string;
          const pos = input.position as { x: number; y: number };
          if (!moveId || !pos) return { success: false, error: 'elementId and position are required' };
          mgr.moveElement(canvasId, moveId, pos);
          return { success: true, output: `Element ${moveId} moved to (${pos.x}, ${pos.y})` };
        }
        case 'resize': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const resizeId = input.elementId as string;
          const size = input.size as { width: number; height: number };
          if (!resizeId || !size) return { success: false, error: 'elementId and size are required' };
          mgr.resizeElement(canvasId, resizeId, size);
          return { success: true, output: `Element ${resizeId} resized to ${size.width}x${size.height}` };
        }
        case 'render': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const rendered = mgr.renderToTerminal(canvasId);
          return { success: true, output: rendered };
        }
        case 'export': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const exported = mgr.exportToJSON(canvasId);
          return { success: true, output: exported };
        }
        case 'undo': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          mgr.undo(canvasId);
          return { success: true, output: 'Undo applied' };
        }
        case 'redo': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          mgr.redo(canvasId);
          return { success: true, output: 'Redo applied' };
        }
        case 'select': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const selId = input.elementId as string;
          if (!selId) return { success: false, error: 'elementId is required' };
          const selWs = mgr.getWorkspace(canvasId);
          if (!selWs) return { success: false, error: `Canvas ${canvasId} not found` };
          if (!selWs.selectedIds.includes(selId)) selWs.selectedIds.push(selId);
          return { success: true, output: `Selected ${selId}` };
        }
        case 'deselect': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const deselId = input.elementId as string;
          if (!deselId) return { success: false, error: 'elementId is required' };
          const deselWs = mgr.getWorkspace(canvasId);
          if (!deselWs) return { success: false, error: `Canvas ${canvasId} not found` };
          deselWs.selectedIds = deselWs.selectedIds.filter(id => id !== deselId);
          return { success: true, output: `Deselected ${deselId}` };
        }
        case 'clear_selection': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const clrWs = mgr.getWorkspace(canvasId);
          if (!clrWs) return { success: false, error: `Canvas ${canvasId} not found` };
          clrWs.selectedIds = [];
          return { success: true, output: 'Selection cleared' };
        }
        case 'bring_to_front': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const bfId = input.elementId as string;
          if (!bfId) return { success: false, error: 'elementId is required' };
          const bfWs = mgr.getWorkspace(canvasId);
          if (!bfWs) return { success: false, error: `Canvas ${canvasId} not found` };
          const bfEl = bfWs.elements.find(e => e.id === bfId);
          if (bfEl) bfEl.zIndex = Math.max(...bfWs.elements.map(e => e.zIndex)) + 1;
          return { success: true, output: `${bfId} brought to front` };
        }
        case 'send_to_back': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          const sbId = input.elementId as string;
          if (!sbId) return { success: false, error: 'elementId is required' };
          const sbWs = mgr.getWorkspace(canvasId);
          if (!sbWs) return { success: false, error: `Canvas ${canvasId} not found` };
          const sbEl = sbWs.elements.find(e => e.id === sbId);
          if (sbEl) sbEl.zIndex = Math.min(...sbWs.elements.map(e => e.zIndex)) - 1;
          return { success: true, output: `${sbId} sent to back` };
        }
        case 'import': {
          if (!canvasId) return { success: false, error: 'canvasId is required' };
          // Import is just loading JSON data
          return { success: true, output: 'Import not yet implemented' };
        }
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'delete', 'list', 'add_element', 'update_element', 'delete_element', 'move', 'resize', 'select', 'deselect', 'clear_selection', 'bring_to_front', 'send_to_back', 'undo', 'redo', 'render', 'export', 'import'],
            description: 'The action to perform',
          },
          canvasId: { type: 'string', description: 'Canvas identifier' },
          elementId: { type: 'string', description: 'Element identifier' },
          element: { type: 'object', description: 'Element definition' },
          position: { type: 'object', description: 'Position {x, y}' },
          size: { type: 'object', description: 'Size {width, height}' },
          format: { type: 'string', enum: ['terminal', 'html', 'json', 'svg'], description: 'Output format' },
          config: { type: 'object', description: 'Canvas configuration' },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.action !== 'string') return { valid: false, errors: ['action is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['canvas', 'visual', 'diagram', 'workspace', 'element', 'draw'], priority: 3, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all canvas tool instances
 */
export function createCanvasTools(): ITool[] {
  return [
    new A2UIExecuteTool(),
    new CanvasExecuteTool(),
  ];
}
