---
name: figma
version: 1.0.0
description: Automate Figma design workflows via REST API, Plugin API, and MCP integration
author: Code Buddy
tags: design, ui, prototyping, collaboration, figma, mcp
env:
  FIGMA_ACCESS_TOKEN: ""
  FIGMA_FILE_KEY: ""
---

# Figma Design Automation

Automate Figma design workflows, export assets, sync design tokens, and integrate design-to-code pipelines using the Figma REST API, Plugin API, and official Figma MCP server.

## Direct Control (CLI / API / Scripting)

### REST API Authentication

```bash
# Set your Figma Personal Access Token
export FIGMA_ACCESS_TOKEN="figd_your_token_here"

# Test authentication
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  https://api.figma.com/v1/me
```

### Get File Data

```bash
# Get file metadata and document structure
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY"

# Get specific nodes
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=123:456,789:012"
```

### Export Assets

```bash
# Export as PNG (scale 2x for retina)
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=123:456&format=png&scale=2" \
  -o exports.json

# Export as SVG
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=123:456&format=svg" \
  -o exports.json

# Export as PDF
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=123:456&format=pdf" \
  -o exports.json
```

### Comments and Collaboration

```bash
# Get all comments
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/comments"

# Post a comment
curl -X POST -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Design looks great!",
    "client_meta": {
      "x": 100,
      "y": 200,
      "node_id": "123:456"
    }
  }' \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/comments"
```

### Design Tokens Extraction (Node.js Script)

```javascript
const axios = require('axios');
const fs = require('fs');

const FIGMA_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;

async function extractDesignTokens() {
  const response = await axios.get(
    `https://api.figma.com/v1/files/${FILE_KEY}`,
    { headers: { 'X-Figma-Token': FIGMA_TOKEN } }
  );

  const styles = response.data.styles || {};
  const tokens = {
    colors: {},
    typography: {},
    spacing: {}
  };

  // Extract color styles
  for (const [id, style] of Object.entries(styles)) {
    if (style.styleType === 'FILL') {
      const node = findNodeById(response.data.document, style.node_id);
      if (node?.fills?.[0]) {
        const fill = node.fills[0];
        tokens.colors[style.name] = rgbToHex(fill.color);
      }
    }
  }

  fs.writeFileSync('design-tokens.json', JSON.stringify(tokens, null, 2));
}

function rgbToHex(color) {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

extractDesignTokens();
```

### Figma Plugin API (Plugin Development)

```typescript
// plugin.ts - Simple export plugin
figma.showUI(__html__, { width: 300, height: 200 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export-selection') {
    const selection = figma.currentPage.selection;

    for (const node of selection) {
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 }
      });

      figma.ui.postMessage({
        type: 'export-complete',
        name: node.name,
        data: bytes
      });
    }
  }

  if (msg.type === 'sync-to-code') {
    // Generate React components from Figma frames
    const frame = figma.currentPage.selection[0] as FrameNode;
    const code = generateReactComponent(frame);
    figma.ui.postMessage({ type: 'code-generated', code });
  }
};

function generateReactComponent(node: FrameNode): string {
  return `
export const ${node.name} = () => {
  return (
    <div style={{
      width: '${node.width}px',
      height: '${node.height}px',
      backgroundColor: '${getFillColor(node)}'
    }}>
      {/* Component content */}
    </div>
  );
};
  `.trim();
}
```

## MCP Server Integration

The official Figma MCP server provides tool-based access to the Figma API with authentication and file management.

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-figma"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "${FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}
```

### Available MCP Tools

1. **get_file** - Retrieve file metadata and document tree
   - Input: `file_key` (string)
   - Returns: Full file object with all nodes and styles

2. **get_file_nodes** - Get specific nodes from a file
   - Input: `file_key` (string), `node_ids` (array)
   - Returns: Node data for requested IDs

3. **export_images** - Export nodes as images
   - Input: `file_key` (string), `node_ids` (array), `format` (png/svg/jpg/pdf), `scale` (number)
   - Returns: URLs to download exported images

4. **get_comments** - Retrieve all comments on a file
   - Input: `file_key` (string)
   - Returns: Array of comment objects

5. **post_comment** - Add a comment to a file
   - Input: `file_key` (string), `message` (string), `node_id` (optional), `x` (number), `y` (number)
   - Returns: Created comment object

6. **get_team_projects** - List all projects in a team
   - Input: `team_id` (string)
   - Returns: Array of project objects

7. **get_project_files** - List files in a project
   - Input: `project_id` (string)
   - Returns: Array of file metadata

8. **get_component_sets** - Get all component sets from a file
   - Input: `file_key` (string)
   - Returns: Component set definitions with variants

## Common Workflows

### 1. Export Design System Assets

```bash
# Step 1: Get file to find all components
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY" \
  -o file-data.json

# Step 2: Parse component node IDs
node_ids=$(jq -r '.document.children[].children[] | select(.type=="COMPONENT") | .id' file-data.json | paste -sd "," -)

# Step 3: Export all components as SVG
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=$node_ids&format=svg" \
  -o export-urls.json

# Step 4: Download all SVG files
jq -r '.images | to_entries[] | "\(.key) \(.value)"' export-urls.json | \
while read id url; do
  curl -o "components/${id}.svg" "$url"
done
```

### 2. Sync Design Tokens to Codebase

```javascript
// sync-tokens.js
const axios = require('axios');
const fs = require('fs');

async function syncTokens() {
  // Get file with styles
  const { data } = await axios.get(
    `https://api.figma.com/v1/files/${process.env.FIGMA_FILE_KEY}/styles`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN } }
  );

  const tokens = {
    colors: {},
    fonts: {},
    effects: {}
  };

  // Process each style
  for (const style of data.meta.styles) {
    const nodeData = await getNode(style.node_id);

    if (style.style_type === 'FILL') {
      tokens.colors[style.name] = extractColor(nodeData);
    } else if (style.style_type === 'TEXT') {
      tokens.fonts[style.name] = extractTypography(nodeData);
    } else if (style.style_type === 'EFFECT') {
      tokens.effects[style.name] = extractEffect(nodeData);
    }
  }

  // Write to CSS variables
  const css = generateCSSVariables(tokens);
  fs.writeFileSync('src/styles/design-tokens.css', css);

  // Write to JSON for JS consumption
  fs.writeFileSync('src/tokens.json', JSON.stringify(tokens, null, 2));
}

syncTokens();
```

### 3. Monitor Design Changes and Notify Team

```bash
#!/bin/bash
# figma-watch.sh - Monitor file changes

LAST_VERSION=""

while true; do
  CURRENT=$(curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
    "https://api.figma.com/v1/files/$FIGMA_FILE_KEY" | \
    jq -r '.version')

  if [ "$CURRENT" != "$LAST_VERSION" ] && [ -n "$LAST_VERSION" ]; then
    echo "Design updated! Version: $CURRENT"

    # Post to Slack
    curl -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"Figma design updated to version $CURRENT\"}"

    # Trigger CI/CD to regenerate assets
    curl -X POST "$CI_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d '{"event":"figma_update"}'
  fi

  LAST_VERSION=$CURRENT
  sleep 300  # Check every 5 minutes
done
```

### 4. Generate React Components from Frames

```typescript
// Using MCP via Code Buddy
// Ask: "Export the 'Button' frame from Figma and generate a React component"

// MCP will:
// 1. Use get_file_nodes to fetch the Button frame
// 2. Parse styles, dimensions, children
// 3. Agent generates TypeScript React component:

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children
}) => {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      style={{
        padding: size === 'sm' ? '8px 16px' : '12px 24px',
        borderRadius: '8px',
        backgroundColor: variant === 'primary' ? '#0066FF' : '#6C757D'
      }}
    >
      {children}
    </button>
  );
};
```

### 5. Automated Design QA Checks

```javascript
// design-qa.js - Check for common issues
const axios = require('axios');

async function runDesignQA() {
  const { data } = await axios.get(
    `https://api.figma.com/v1/files/${process.env.FIGMA_FILE_KEY}`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN } }
  );

  const issues = [];

  function traverse(node) {
    // Check for missing constraints
    if (node.type === 'FRAME' && !node.constraints) {
      issues.push(`${node.name}: Missing layout constraints`);
    }

    // Check for unnamed layers
    if (node.name.startsWith('Rectangle') || node.name.startsWith('Ellipse')) {
      issues.push(`${node.name}: Generic layer name at ${node.id}`);
    }

    // Check for oversized images
    if (node.type === 'IMAGE' && node.fills?.[0]?.imageRef) {
      // Would need to check actual image size
      issues.push(`${node.name}: Check image optimization`);
    }

    // Traverse children
    if (node.children) {
      node.children.forEach(traverse);
    }
  }

  traverse(data.document);

  console.log(`Found ${issues.length} potential issues:`);
  issues.forEach(issue => console.log(`- ${issue}`));
}

runDesignQA();
```
