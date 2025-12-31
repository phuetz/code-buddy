/**
 * Unit tests for CodeStructureRenderer Module
 *
 * Comprehensive tests covering:
 * - Plain mode rendering
 * - Fancy mode rendering with colors and emojis
 * - Imports rendering
 * - Exports rendering
 * - Classes rendering (with methods and properties)
 * - Functions rendering
 * - Variables rendering
 * - Tree structure formatting
 * - Edge cases and error handling
 */

import { codeStructureRenderer } from '../../src/renderers/code-structure-renderer';
import {
  CodeStructureData,
  CodeExport,
  CodeImport,
  CodeClass,
  CodeFunction,
  CodeVariable,
  RenderContext,
} from '../../src/renderers/types';

describe('CodeStructureRenderer Module', () => {
  // ==========================================================================
  // Test Data Fixtures
  // ==========================================================================

  const createRenderContext = (overrides: Partial<RenderContext> = {}): RenderContext => ({
    mode: 'fancy',
    color: true,
    emoji: true,
    width: 120,
    height: 24,
    piped: false,
    ...overrides,
  });

  const createCodeExport = (overrides: Partial<CodeExport> = {}): CodeExport => ({
    name: 'exportedFunction',
    kind: 'function',
    line: 10,
    ...overrides,
  });

  const createCodeImport = (overrides: Partial<CodeImport> = {}): CodeImport => ({
    source: 'react',
    names: ['React', 'useState'],
    isDefault: false,
    line: 1,
    ...overrides,
  });

  const createCodeClass = (overrides: Partial<CodeClass> = {}): CodeClass => ({
    name: 'MyClass',
    line: 20,
    methods: ['constructor', 'render', 'handleClick'],
    properties: ['state', 'props'],
    ...overrides,
  });

  const createCodeFunction = (overrides: Partial<CodeFunction> = {}): CodeFunction => ({
    name: 'myFunction',
    line: 50,
    params: ['arg1', 'arg2'],
    returnType: 'string',
    async: false,
    exported: true,
    ...overrides,
  });

  const createCodeVariable = (overrides: Partial<CodeVariable> = {}): CodeVariable => ({
    name: 'myVariable',
    line: 5,
    kind: 'const',
    type: 'string',
    exported: false,
    ...overrides,
  });

  const createCodeStructureData = (overrides: Partial<CodeStructureData> = {}): CodeStructureData => ({
    type: 'code-structure',
    filePath: 'src/components/MyComponent.tsx',
    language: 'typescript',
    exports: [createCodeExport()],
    imports: [createCodeImport()],
    classes: [createCodeClass()],
    functions: [createCodeFunction()],
    variables: [createCodeVariable()],
    ...overrides,
  });

  // ==========================================================================
  // Renderer Interface Tests
  // ==========================================================================

  describe('Renderer Interface', () => {
    it('should have correct id', () => {
      expect(codeStructureRenderer.id).toBe('code-structure');
    });

    it('should have correct name', () => {
      expect(codeStructureRenderer.name).toBe('Code Structure Renderer');
    });

    it('should have priority of 10', () => {
      expect(codeStructureRenderer.priority).toBe(10);
    });
  });

  // ==========================================================================
  // canRender Tests
  // ==========================================================================

  describe('canRender', () => {
    it('should return true for valid code structure data', () => {
      const data = createCodeStructureData();

      expect(codeStructureRenderer.canRender(data)).toBe(true);
    });

    it('should return false for null', () => {
      expect(codeStructureRenderer.canRender(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(codeStructureRenderer.canRender(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(codeStructureRenderer.canRender('string')).toBe(false);
      expect(codeStructureRenderer.canRender(123)).toBe(false);
      expect(codeStructureRenderer.canRender(true)).toBe(false);
    });

    it('should return false for object without type', () => {
      expect(codeStructureRenderer.canRender({ filePath: 'test.ts' })).toBe(false);
    });

    it('should return false for wrong type', () => {
      expect(codeStructureRenderer.canRender({ type: 'diff' })).toBe(false);
      expect(codeStructureRenderer.canRender({ type: 'table' })).toBe(false);
    });

    it('should return true for minimal code structure data', () => {
      const minimalData: CodeStructureData = {
        type: 'code-structure',
        filePath: 'test.ts',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        variables: [],
      };

      expect(codeStructureRenderer.canRender(minimalData)).toBe(true);
    });
  });

  // ==========================================================================
  // Plain Mode Rendering Tests
  // ==========================================================================

  describe('Plain Mode Rendering', () => {
    it('should render basic structure in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('File: src/components/MyComponent.tsx');
      expect(result).toContain('(typescript)');
      expect(result).toContain('='.repeat(50));
    });

    it('should render imports section in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('Imports:');
      expect(result).toContain('from "react": React, useState');
    });

    it('should render default imports differently', () => {
      const data = createCodeStructureData({
        imports: [
          createCodeImport({
            source: 'lodash',
            names: ['_'],
            isDefault: true,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('default as _');
    });

    it('should render exports section in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('Exports:');
      expect(result).toContain('function: exportedFunction (line 10)');
    });

    it('should render exports without line numbers', () => {
      const data = createCodeStructureData({
        exports: [createCodeExport({ line: undefined })],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('function: exportedFunction');
      expect(result).not.toContain('(line');
    });

    it('should render classes section in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('Classes:');
      expect(result).toContain('MyClass');
      expect(result).toContain('Methods: constructor, render, handleClick');
      expect(result).toContain('Properties: state, props');
    });

    it('should render class extends in plain mode', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            extends: 'BaseClass',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('MyClass extends BaseClass');
    });

    it('should render class implements in plain mode', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            implements: ['Interface1', 'Interface2'],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('implements Interface1, Interface2');
    });

    it('should render functions section in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('Functions:');
      expect(result).toContain('myFunction(arg1, arg2): string (exported)');
    });

    it('should render async functions', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            async: true,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('async myFunction');
    });

    it('should render functions without return type', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            returnType: undefined,
          }),
        ],
        variables: [], // Clear variables to avoid ': string' from variable
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('myFunction(arg1, arg2)');
      // Function should not have return type annotation
      expect(result).not.toContain('myFunction(arg1, arg2): ');
    });

    it('should render non-exported functions', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            exported: false,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).not.toContain('(exported)');
    });

    it('should render variables section in plain mode', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('Variables:');
      expect(result).toContain('const myVariable: string');
    });

    it('should render exported variables', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({
            exported: true,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('(exported)');
    });

    it('should render let variables', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({
            kind: 'let',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('let myVariable');
    });

    it('should render var variables', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({
            kind: 'var',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('var myVariable');
    });

    it('should skip empty sections', () => {
      const data = createCodeStructureData({
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        variables: [],
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).not.toContain('Imports:');
      expect(result).not.toContain('Exports:');
      expect(result).not.toContain('Classes:');
      expect(result).not.toContain('Functions:');
      expect(result).not.toContain('Variables:');
    });

    it('should handle file without language', () => {
      const data = createCodeStructureData({
        language: undefined,
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('File: src/components/MyComponent.tsx');
      expect(result).not.toContain('(typescript)');
    });
  });

  // ==========================================================================
  // Fancy Mode Rendering Tests
  // ==========================================================================

  describe('Fancy Mode Rendering', () => {
    it('should render with emojis when enabled', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDCC4'); // File emoji
      expect(result).toContain('\uD83D\uDCE5'); // Import emoji
      expect(result).toContain('\uD83D\uDCE4'); // Export emoji
    });

    it('should render with text icons when emojis disabled', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: false });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('[F]');
      expect(result).toContain('[I]');
      expect(result).toContain('[E]');
    });

    it('should render tree structure with box characters', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\u251C\u2500\u2500'); // Branch
      expect(result).toContain('\u2514\u2500\u2500'); // Last branch
      expect(result).toContain('\u2502'); // Vertical line
    });

    it('should show section counts', () => {
      const data = createCodeStructureData({
        imports: [createCodeImport(), createCodeImport({ source: 'lodash' })],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('(2)'); // 2 imports
    });

    it('should render imports with curly braces for named imports', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('{ React, useState }');
    });

    it('should render default imports without curly braces', () => {
      const data = createCodeStructureData({
        imports: [
          createCodeImport({
            source: 'react',
            names: ['React'],
            isDefault: true,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('React from "react"');
      expect(result).not.toContain('{ React }');
    });

    it('should render exports with appropriate icons', () => {
      const data = createCodeStructureData({
        exports: [
          createCodeExport({ name: 'func', kind: 'function' }),
          createCodeExport({ name: 'Cls', kind: 'class' }),
          createCodeExport({ name: 'val', kind: 'variable' }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\u26A1'); // Function lightning bolt
      expect(result).toContain('\uD83C\uDFDB\uFE0F'); // Class building
    });

    it('should render class with extends in color', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            extends: 'BaseClass',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\x1b[90m'); // Gray color
      expect(result).toContain('extends BaseClass');
      expect(result).toContain('\x1b[0m'); // Reset
    });

    it('should render class with implements in color', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            implements: ['IClickable', 'IRenderable'],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('implements IClickable, IRenderable');
    });

    it('should render class without color when disabled', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            extends: 'BaseClass',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: false });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).not.toContain('\x1b[');
      expect(result).toContain('extends BaseClass');
    });

    it('should render class methods with icons', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDD27'); // Method wrench
      expect(result).toContain('constructor()');
      expect(result).toContain('render()');
    });

    it('should render class properties with icons', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDCCC'); // Property pushpin
      expect(result).toContain('state');
      expect(result).toContain('props');
    });

    it('should render functions with return type in color', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain(': string');
    });

    it('should render exported functions with arrow', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\u2B06'); // Up arrow for exported
    });

    it('should render async functions', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            async: true,
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('async myFunction');
    });

    it('should render const variables with lock icon', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({ kind: 'const' }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDD12'); // Lock for const
    });

    it('should render let variables with unlock icon', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({ kind: 'let' }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDD13'); // Unlock for let
    });

    it('should render exported variables with arrow', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({ exported: true }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('\u2B06'); // Up arrow
    });

    it('should handle multiple sections with proper tree structure', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      // All sections should be present
      expect(result).toContain('Imports');
      expect(result).toContain('Exports');
      expect(result).toContain('Classes');
      expect(result).toContain('Functions');
      expect(result).toContain('Variables');
    });

    it('should render last section with last branch character', () => {
      const data = createCodeStructureData({
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        variables: [createCodeVariable()],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      // Last section should use \u2514\u2500\u2500 (L-shaped)
      expect(result).toContain('\u2514\u2500\u2500');
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty arrays', () => {
      const data = createCodeStructureData({
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        variables: [],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('src/components/MyComponent.tsx');
    });

    it('should handle class without methods', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: [],
            properties: ['prop1'],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle class without properties', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: ['method1'],
            properties: [],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle class without methods or properties', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: [],
            properties: [],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle function with no params', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            params: [],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('myFunction()');
    });

    it('should handle very long file path', () => {
      const longPath = 'src/' + 'nested/'.repeat(20) + 'component.tsx';
      const data = createCodeStructureData({
        filePath: longPath,
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle special characters in names', () => {
      const data = createCodeStructureData({
        functions: [
          createCodeFunction({
            name: '$specialFunc_123',
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('$specialFunc_123');
    });

    it('should handle many imports', () => {
      const data = createCodeStructureData({
        imports: Array(20).fill(null).map((_, i) =>
          createCodeImport({ source: `module-${i}` })
        ),
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('(20)');
    });

    it('should handle class with many methods', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: Array(30).fill(null).map((_, i) => `method${i}`),
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle various export kinds', () => {
      const data = createCodeStructureData({
        exports: [
          createCodeExport({ kind: 'function' }),
          createCodeExport({ kind: 'class', name: 'MyExportedClass' }),
          createCodeExport({ kind: 'variable', name: 'MY_CONST' }),
          createCodeExport({ kind: 'type', name: 'MyType' }),
          createCodeExport({ kind: 'default', name: 'default' }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => codeStructureRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle variables without type', () => {
      const data = createCodeStructureData({
        variables: [
          createCodeVariable({ type: undefined }),
        ],
        functions: [], // Clear functions to avoid ': string' from function return type
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('myVariable');
      // Variable should not have type annotation
      expect(result).not.toContain('myVariable: ');
    });
  });

  // ==========================================================================
  // Multi-line Class Rendering Tests
  // ==========================================================================

  describe('Multi-line Class Rendering', () => {
    it('should render class as multi-line in tree', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: ['method1', 'method2'],
            properties: ['prop1'],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      // Methods and properties should be on separate lines
      const lines = result.split('\n');
      const methodLines = lines.filter(l => l.includes('method'));
      expect(methodLines.length).toBeGreaterThan(1);
    });

    it('should use proper indentation for class members', () => {
      const data = createCodeStructureData({
        classes: [
          createCodeClass({
            methods: ['m1'],
            properties: ['p1'],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      // Class members should be indented with tree chars
      expect(result).toContain('   \u251C\u2500\u2500'); // Indented branch
      expect(result).toContain('   \u2514\u2500\u2500'); // Indented last branch
    });
  });

  // ==========================================================================
  // Section Order Tests
  // ==========================================================================

  describe('Section Order', () => {
    it('should render sections in correct order', () => {
      const data = createCodeStructureData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      const importsIndex = result.indexOf('Imports');
      const exportsIndex = result.indexOf('Exports');
      const classesIndex = result.indexOf('Classes');
      const functionsIndex = result.indexOf('Functions');
      const variablesIndex = result.indexOf('Variables');

      expect(importsIndex).toBeLessThan(exportsIndex);
      expect(exportsIndex).toBeLessThan(classesIndex);
      expect(classesIndex).toBeLessThan(functionsIndex);
      expect(functionsIndex).toBeLessThan(variablesIndex);
    });
  });

  // ==========================================================================
  // Default Export Tests
  // ==========================================================================

  describe('Default Export', () => {
    it('should export renderer as default', async () => {
      const defaultExport = await import('../../src/renderers/code-structure-renderer');

      expect(defaultExport.default).toBe(codeStructureRenderer);
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete code structure with all features', () => {
      const data: CodeStructureData = {
        type: 'code-structure',
        filePath: 'src/utils/helpers.ts',
        language: 'typescript',
        imports: [
          { source: 'lodash', names: ['debounce', 'throttle'], line: 1 },
          { source: 'react', names: ['React'], isDefault: true, line: 2 },
        ],
        exports: [
          { name: 'formatDate', kind: 'function', line: 10 },
          { name: 'CONFIG', kind: 'variable', line: 5 },
        ],
        classes: [
          {
            name: 'DataProcessor',
            line: 20,
            extends: 'BaseProcessor',
            implements: ['IProcessor', 'ISerializable'],
            methods: ['process', 'serialize', 'validate'],
            properties: ['data', 'config'],
          },
        ],
        functions: [
          {
            name: 'formatDate',
            line: 10,
            params: ['date: Date', 'format: string'],
            returnType: 'string',
            async: false,
            exported: true,
          },
          {
            name: 'fetchData',
            line: 30,
            params: ['url: string'],
            returnType: 'Promise<Data>',
            async: true,
            exported: true,
          },
        ],
        variables: [
          { name: 'CONFIG', line: 5, kind: 'const', type: 'Config', exported: true },
          { name: 'cache', line: 8, kind: 'let', type: 'Map<string, any>', exported: false },
        ],
      };
      const ctx = createRenderContext({ mode: 'fancy', color: true, emoji: true });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('helpers.ts');
      expect(result).toContain('typescript');
      expect(result).toContain('debounce');
      expect(result).toContain('DataProcessor');
      expect(result).toContain('extends BaseProcessor');
      expect(result).toContain('IProcessor');
      expect(result).toContain('formatDate');
      expect(result).toContain('async fetchData');
      expect(result).toContain('CONFIG');
    });

    it('should handle minimal file with only one section', () => {
      const data: CodeStructureData = {
        type: 'code-structure',
        filePath: 'constants.ts',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        variables: [
          { name: 'VERSION', kind: 'const', type: 'string', exported: true },
        ],
      };
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = codeStructureRenderer.render(data, ctx);

      expect(result).toContain('constants.ts');
      expect(result).toContain('Variables');
      expect(result).toContain('VERSION');
    });
  });
});
