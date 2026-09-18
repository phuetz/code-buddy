import type { FigmaImportIR } from './types.js';

export function renderImportReport(ir: FigmaImportIR): string {
  const lines: string[] = [
    `# Figma import report`,
    '',
    `- Source: ${ir.source.kind}${ir.source.fileKey ? ` (${ir.source.fileKey})` : ''}`,
    `- File name: ${ir.source.name}`,
    `- Screens: ${ir.screens.length}`,
    `- Recurring components: ${ir.components.length}`,
    `- Distinct colors: ${ir.colors.length}`,
    `- Spacing values: ${ir.spacings.length === 0 ? 'none' : ir.spacings.map((n) => `${n}px`).join(', ')}`,
    `- Skipped nodes: ${ir.skips.length}`,
    '',
    '## Covered',
    '',
    '- Frames (including auto-layout row/column and simple grids)',
    '- Text',
    '- Rectangles',
    '- Image fills (placeholder with `data-figma-image-ref`, no download)',
    '- Component definitions and instances',
    '',
    '## Not covered (listed, not approximated)',
    '',
  ];

  if (ir.skips.length === 0) {
    lines.push('_Nothing skipped._', '');
  } else {
    lines.push('| Node | Type | Reason |', '|---|---|---|');
    for (const skip of ir.skips) {
      lines.push(`| ${escapeCell(skip.name)} (\`${skip.nodeId}\`) | ${escapeCell(skip.type)} | ${escapeCell(skip.reason)} |`);
    }
    lines.push('');
  }

  lines.push('## Screens', '');
  if (ir.screens.length === 0) {
    lines.push('_No top-level frames found._', '');
  } else {
    for (const screen of ir.screens) {
      lines.push(`- **${screen.name}** → \`src/screens/${screen.componentName}.tsx\``);
    }
    lines.push('');
  }

  lines.push('## Components', '');
  if (ir.components.length === 0) {
    lines.push('_No Figma components extracted._', '');
  } else {
    for (const component of ir.components) {
      lines.push(
        `- **${component.name}** → \`src/components/${component.componentName}.tsx\` (${component.instanceCount} instance(s))`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Limits',
    '',
    '- Image bytes are never fetched; only the Figma `imageRef` is recorded.',
    '- Complex vectors, boolean ops, and layer effects are omitted.',
    '- A remote file key requires a token supplied at call time; the token is never written to disk.',
    '',
  );
  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
