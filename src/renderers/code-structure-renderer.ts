/**
 * CodeStructureRenderer - Render code file structure analysis
 *
 * Displays code structure in a tree format showing:
 * - Imports and exports
 * - Classes with methods and properties
 * - Functions with signatures
 * - Variables
 */

import stringWidth from 'string-width';
import {
  Renderer,
  RenderContext,
  CodeStructureData,
  CodeClass,
  CodeFunction,
  isCodeStructureData,
} from './types.js';

// ============================================================================
// Renderer Implementation
// ============================================================================

export const codeStructureRenderer: Renderer<CodeStructureData> = {
  id: 'code-structure',
  name: 'Code Structure Renderer',
  priority: 10,

  canRender(data: unknown): data is CodeStructureData {
    return isCodeStructureData(data);
  },

  render(data: CodeStructureData, ctx: RenderContext): string {
    if (ctx.mode === 'plain') {
      return renderPlain(data);
    }
    return renderFancy(data, ctx);
  },
};

// ============================================================================
// Plain Mode Rendering
// ============================================================================

function renderPlain(data: CodeStructureData): string {
  const lines: string[] = [];
  const { filePath, language, exports, imports, classes, functions, variables } = data;

  lines.push(`File: ${filePath}${language ? ` (${language})` : ''}`);
  lines.push('='.repeat(50));

  if (imports.length > 0) {
    lines.push('\nImports:');
    for (const imp of imports) {
      const names = imp.isDefault ? `default as ${imp.names[0]}` : imp.names.join(', ');
      lines.push(`  from "${imp.source}": ${names}`);
    }
  }

  if (exports.length > 0) {
    lines.push('\nExports:');
    for (const exp of exports) {
      lines.push(`  ${exp.kind}: ${exp.name}${exp.line ? ` (line ${exp.line})` : ''}`);
    }
  }

  if (classes.length > 0) {
    lines.push('\nClasses:');
    for (const cls of classes) {
      const ext = cls.extends ? ` extends ${cls.extends}` : '';
      const impl = cls.implements?.length ? ` implements ${cls.implements.join(', ')}` : '';
      lines.push(`  ${cls.name}${ext}${impl}`);
      if (cls.methods.length > 0) {
        lines.push(`    Methods: ${cls.methods.join(', ')}`);
      }
      if (cls.properties.length > 0) {
        lines.push(`    Properties: ${cls.properties.join(', ')}`);
      }
    }
  }

  if (functions.length > 0) {
    lines.push('\nFunctions:');
    for (const fn of functions) {
      const async = fn.async ? 'async ' : '';
      const params = fn.params.join(', ');
      const ret = fn.returnType ? `: ${fn.returnType}` : '';
      const exported = fn.exported ? ' (exported)' : '';
      lines.push(`  ${async}${fn.name}(${params})${ret}${exported}`);
    }
  }

  if (variables.length > 0) {
    lines.push('\nVariables:');
    for (const v of variables) {
      const type = v.type ? `: ${v.type}` : '';
      const exported = v.exported ? ' (exported)' : '';
      lines.push(`  ${v.kind} ${v.name}${type}${exported}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Fancy Mode Rendering
// ============================================================================

function renderFancy(data: CodeStructureData, ctx: RenderContext): string {
  const lines: string[] = [];
  const { filePath, language, exports, imports, classes, functions, variables } = data;

  // Icons
  const icons = ctx.emoji
    ? {
        file: '📄',
        import: '📥',
        export: '📤',
        class: '🏛️',
        function: '⚡',
        method: '🔧',
        property: '📌',
        variable: '📦',
        const: '🔒',
        let: '🔓',
      }
    : {
        file: '[F]',
        import: '[I]',
        export: '[E]',
        class: '[C]',
        function: '[fn]',
        method: '[m]',
        property: '[p]',
        variable: '[v]',
        const: '[c]',
        let: '[l]',
      };

  // Tree characters
  const tree = {
    branch: '├──',
    last: '└──',
    vertical: '│  ',
    space: '   ',
  };

  // Header
  const langTag = language ? ` (${language})` : '';
  lines.push(`${icons.file} ${filePath}${langTag}`);

  const sections: { title: string; icon: string; items: string[] }[] = [];

  // Imports section
  if (imports.length > 0) {
    const items: string[] = [];
    for (const imp of imports) {
      const names = imp.isDefault ? imp.names[0] : `{ ${imp.names.join(', ')} }`;
      items.push(`${names} from "${imp.source}"`);
    }
    sections.push({ title: 'Imports', icon: icons.import, items });
  }

  // Exports section
  if (exports.length > 0) {
    const items: string[] = [];
    for (const exp of exports) {
      const kindIcon = exp.kind === 'function' ? icons.function
        : exp.kind === 'class' ? icons.class
        : icons.variable;
      items.push(`${kindIcon} ${exp.name} (${exp.kind})`);
    }
    sections.push({ title: 'Exports', icon: icons.export, items });
  }

  // Classes section
  if (classes.length > 0) {
    const items: string[] = [];
    for (const cls of classes) {
      items.push(formatClass(cls, icons, tree, ctx));
    }
    sections.push({ title: 'Classes', icon: icons.class, items });
  }

  // Functions section
  if (functions.length > 0) {
    const items: string[] = [];
    for (const fn of functions) {
      items.push(formatFunction(fn, ctx));
    }
    sections.push({ title: 'Functions', icon: icons.function, items });
  }

  // Variables section
  if (variables.length > 0) {
    const items: string[] = [];
    for (const v of variables) {
      const icon = v.kind === 'const' ? icons.const : icons.let;
      const type = v.type ? `: ${v.type}` : '';
      const exported = v.exported ? ' ⬆' : '';
      items.push(`${icon} ${v.name}${type}${exported}`);
    }
    sections.push({ title: 'Variables', icon: icons.variable, items });
  }

  // Render sections
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const isLast = i === sections.length - 1;
    const prefix = isLast ? tree.last : tree.branch;
    const childPrefix = isLast ? tree.space : tree.vertical;

    lines.push(`${prefix} ${section.icon} ${section.title} (${section.items.length})`);

    for (let j = 0; j < section.items.length; j++) {
      const item = section.items[j];
      const itemIsLast = j === section.items.length - 1;
      const itemPrefix = itemIsLast ? tree.last : tree.branch;

      // Handle multi-line items (classes)
      const itemLines = item.split('\n');
      for (let k = 0; k < itemLines.length; k++) {
        if (k === 0) {
          lines.push(`${childPrefix}${itemPrefix} ${itemLines[k]}`);
        } else {
          const subPrefix = itemIsLast ? tree.space : tree.vertical;
          lines.push(`${childPrefix}${subPrefix}${itemLines[k]}`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatClass(
  cls: CodeClass,
  icons: Record<string, string>,
  tree: Record<string, string>,
  ctx: RenderContext
): string {
  const lines: string[] = [];

  // Class header
  let header = cls.name;
  if (cls.extends) {
    header += ctx.color ? ` \x1b[90mextends ${cls.extends}\x1b[0m` : ` extends ${cls.extends}`;
  }
  if (cls.implements?.length) {
    const impl = cls.implements.join(', ');
    header += ctx.color ? ` \x1b[90mimplements ${impl}\x1b[0m` : ` implements ${impl}`;
  }
  lines.push(header);

  // Methods
  if (cls.methods.length > 0) {
    for (let i = 0; i < cls.methods.length; i++) {
      const method = cls.methods[i];
      const isLast = i === cls.methods.length - 1 && cls.properties.length === 0;
      const prefix = isLast ? tree.last : tree.branch;
      lines.push(`   ${prefix} ${icons.method} ${method}()`);
    }
  }

  // Properties
  if (cls.properties.length > 0) {
    for (let i = 0; i < cls.properties.length; i++) {
      const prop = cls.properties[i];
      const isLast = i === cls.properties.length - 1;
      const prefix = isLast ? tree.last : tree.branch;
      lines.push(`   ${prefix} ${icons.property} ${prop}`);
    }
  }

  return lines.join('\n');
}

function formatFunction(fn: CodeFunction, ctx: RenderContext): string {
  const async = fn.async ? 'async ' : '';
  const params = fn.params.length > 0 ? fn.params.join(', ') : '';
  const ret = fn.returnType
    ? (ctx.color ? `\x1b[90m: ${fn.returnType}\x1b[0m` : `: ${fn.returnType}`)
    : '';
  const exported = fn.exported ? ' ⬆' : '';

  return `${async}${fn.name}(${params})${ret}${exported}`;
}

export default codeStructureRenderer;
