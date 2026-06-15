const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workflowProDir = path.join(__dirname, 'cowork/src/renderer/components/workflow_pro');

function walk(dir, callback) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      walk(p, callback);
    } else if (p.endsWith('.tsx') || p.endsWith('.ts')) {
      callback(p);
    }
  }
}

walk(workflowProDir, (file) => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const replaceMap = {
    'store/workflowStore': 'store',
    'data/nodeTypes': 'data-mocks',
    'services/UpdateTimestampService': 'service-mocks',
    'services/NotificationService': 'service-mocks',
    'services/SimpleLogger': 'service-mocks',
    'services/SubWorkflowService': 'service-mocks',
    'services/WorkflowAPI': 'service-mocks',
    'services/WorkflowDebuggerService': 'service-mocks',
    'nlp/WorkflowGenerator': 'service-mocks',
    'core/UnifiedSidebar': 'ui-mocks',
    'core/UnifiedHeader': 'ui-mocks',
    'nodes/CustomNode': 'ui-mocks',
    'nodes/N8NStyleNode': 'ui-mocks',
    'nodes/N8NStyleNodePanel': 'ui-mocks',
    'nodes/NodeConfigPanel': 'ui-mocks',
    'nodes/SubworkflowNode': 'ui-mocks',
    'canvas/StickyNoteNode': 'ui-mocks',
    'edges/N8NStyleEdge': 'ui-mocks',
    'canvas/CanvasSelectionToolbar': 'ui-mocks',
    'nodes/NodePinButton': 'ui-mocks',
    'ui/FocusTrapWrapper': 'ui-mocks',
    'error-handling/NodeErrorDetail': 'ui-mocks',
    'nodes/FocusPanel': 'ui-mocks',
    'nodes/NodeRunDataInspector': 'ui-mocks',
    'execution/ExecutionRetriever': 'ui-mocks',
    'hooks/useKeyboardShortcuts': 'hook-mocks',
    'utils/nodePositioning': 'hook-mocks',
    'types/common-types': 'type-mocks',
    'types/debugging': 'type-mocks',
    'types/execution': 'type-mocks',
    'types/nlp': 'type-mocks',
    'types/streaming': 'type-mocks',
    'types/subworkflows': 'type-mocks',
    'types/workflow': 'type-mocks',
    'workflow/ConnectionValidator': 'data-mocks'
  };

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('import ') || line.startsWith('export ') || line.includes('import(')) {
      for (const [target, mockFile] of Object.entries(replaceMap)) {
        if (line.includes(target)) {
          // Compute relative path to the mock file
          const mockPathAbs = path.join(workflowProDir, mockFile);
          let relPath = path.relative(path.dirname(file), mockPathAbs);
          if (!relPath.startsWith('.')) relPath = './' + relPath;

          // Replace the import string
          // Matches from ... 'something/target' or "something/target"
          const regex = new RegExp(`['"\`][^'"\`]*${target}['"\`]`, 'g');
          const newLine = line.replace(regex, `'${relPath}'`);
          if (newLine !== line) {
            lines[i] = newLine;
            changed = true;
          }
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  }
});
