/**
 * Canvas/A2UI Tool Definitions
 *
 * Tool definitions for AI agents to interact with visual canvases
 * and the A2UI protocol for dynamic UI generation.
 */

import { CodeBuddyTool } from './types.js';

/**
 * A2UI Canvas Tool
 *
 * Create dynamic visual interfaces using the A2UI protocol.
 * Supports surfaces with components, data binding, and real-time updates.
 */
export const A2UI_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'a2ui',
    description: `Create and manage dynamic visual interfaces using the A2UI protocol.

A2UI (Agent-to-UI) is a protocol for AI agents to create visual workspaces with interactive components.

WORKFLOW:
1. 'create_surface' to start a new UI surface
2. 'add_components' to add UI components (buttons, text fields, etc.)
3. 'update_data' to populate component values via data binding
4. 'begin_rendering' to display the interface
5. 'render_terminal' or 'render_html' to see the output

COMPONENT TYPES:
Layout: row, column, list, grid, stack
Display: text, heading, image, icon, markdown, code, divider, spacer
Interactive: button, textField, textArea, checkbox, radio, switch, slider, select
Containers: card, tabs, modal, accordion
Data: table, chart, progress, badge, avatar, chip

DATA BINDING:
Components can bind to data model values using 'path' in props:
- { type: 'text', props: { path: 'user.name' } } - binds to data.user.name
- Use 'update_data' action to set values

EXAMPLE - Simple Form:
1. create_surface: { surfaceId: 'login-form' }
2. add_components: { surfaceId: 'login-form', components: [
     { id: 'root', type: 'column', props: { children: ['title', 'email', 'submit'] } },
     { id: 'title', type: 'heading', props: { value: 'Login', level: 2 } },
     { id: 'email', type: 'textField', props: { label: 'Email', placeholder: 'you@example.com' } },
     { id: 'submit', type: 'button', props: { label: 'Sign In', variant: 'primary' } }
   ]}
3. begin_rendering: { surfaceId: 'login-form', root: 'root' }
4. render_terminal: { surfaceId: 'login-form' }`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create_surface',
            'delete_surface',
            'add_component',
            'add_components',
            'update_data',
            'begin_rendering',
            'render_terminal',
            'render_html',
            'get_surface',
            'list_surfaces',
            'start_server',
            'stop_server',
            'server_status',
            'get_data',
            'get_component_state',
            'canvas_snapshot',
          ],
          description: 'The action to perform',
        },
        surfaceId: {
          type: 'string',
          description: 'Unique identifier for the surface',
        },
        component: {
          type: 'object',
          description: 'Single component to add (for add_component action)',
          properties: {
            id: { type: 'string', description: 'Unique component ID' },
            type: {
              type: 'string',
              enum: [
                'row', 'column', 'list', 'grid', 'stack',
                'text', 'heading', 'image', 'icon', 'video', 'markdown', 'code', 'divider', 'spacer',
                'button', 'textField', 'textArea', 'checkbox', 'radio', 'switch', 'slider', 'select',
                'datePicker', 'timePicker', 'filePicker',
                'card', 'accordion', 'tabs', 'tabItem', 'modal', 'drawer', 'popover', 'tooltip',
                'table', 'chart', 'progress', 'badge', 'avatar', 'chip', 'custom',
              ],
              description: 'Component type',
            },
            props: {
              type: 'object',
              description: 'Component properties (varies by type)',
            },
          },
          required: ['id', 'type'],
        },
        components: {
          type: 'array',
          description: 'Array of components to add (for add_components action)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              props: { type: 'object' },
            },
            required: ['id', 'type'],
          },
        },
        data: {
          type: 'object',
          description: 'Data to set in the data model',
        },
        dataPath: {
          type: 'string',
          description: 'Dot-notation path for nested data updates (e.g., "user.profile")',
        },
        root: {
          type: 'string',
          description: 'ID of root component to render',
        },
        styles: {
          type: 'object',
          description: 'Global surface styles',
          properties: {
            backgroundColor: { type: 'string' },
            color: { type: 'string' },
            fontFamily: { type: 'string' },
            fontSize: { type: 'number' },
            padding: { type: 'number' },
          },
        },
        port: {
          type: 'number',
          description: 'Server port (default: 18790)',
        },
        host: {
          type: 'string',
          description: 'Server host (default: 127.0.0.1)',
        },
        componentId: {
          type: 'string',
          description: 'Component ID (for get_component_state action)',
        },
      },
      required: ['action'],
    },
  },
};

/**
 * Visual Canvas Tool
 *
 * Create and manipulate visual canvases with elements like text, code, images, charts.
 */
export const VISUAL_CANVAS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'canvas',
    description: `Create and manipulate visual canvases with positioned elements.

Use for creating diagrams, layouts, and visual presentations in the terminal.

ACTIONS:
- create: Create a new canvas
- delete: Delete a canvas
- add_element: Add an element (text, code, image, shape, etc.)
- update_element: Update an element's properties
- delete_element: Remove an element
- move: Move an element to new position
- resize: Resize an element
- render: Render canvas to terminal or HTML
- export: Export canvas as JSON, HTML, or SVG
- undo/redo: History navigation

ELEMENT TYPES:
- text: Plain or styled text
- code: Syntax-highlighted code block
- image: Image with URL or path
- shape: Rectangle, circle, arrow, line
- chart: Bar, line, pie charts
- markdown: Rendered markdown
- connection: Connect two elements`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create', 'delete', 'list',
            'add_element', 'update_element', 'delete_element',
            'move', 'resize',
            'select', 'deselect', 'clear_selection',
            'bring_to_front', 'send_to_back',
            'undo', 'redo',
            'render', 'export', 'import',
          ],
          description: 'The action to perform',
        },
        canvasId: {
          type: 'string',
          description: 'Canvas identifier',
        },
        elementId: {
          type: 'string',
          description: 'Element identifier',
        },
        element: {
          type: 'object',
          description: 'Element definition',
          properties: {
            type: {
              type: 'string',
              enum: ['text', 'code', 'image', 'shape', 'chart', 'markdown', 'connection'],
            },
            position: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
            },
            size: {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            content: { type: 'object' },
            style: { type: 'object' },
          },
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
        },
        size: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        format: {
          type: 'string',
          enum: ['terminal', 'html', 'json', 'svg'],
          description: 'Output format for render/export',
        },
        config: {
          type: 'object',
          description: 'Canvas configuration',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
            gridSize: { type: 'number' },
            snapToGrid: { type: 'boolean' },
            showGrid: { type: 'boolean' },
            backgroundColor: { type: 'string' },
          },
        },
      },
      required: ['action'],
    },
  },
};

/**
 * All canvas tools
 */
export const CANVAS_TOOLS: CodeBuddyTool[] = [
  A2UI_TOOL,
  VISUAL_CANVAS_TOOL,
];

export default CANVAS_TOOLS;
