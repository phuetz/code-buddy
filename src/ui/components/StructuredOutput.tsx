/**
 * StructuredOutput - React component for rendering structured data
 *
 * Uses the RenderManager to automatically select the best renderer
 * for the given data type. Falls back to plain text for unknown types.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { getRenderManager, RenderContext } from '../../renderers/index.js';
import { useTheme } from '../context/theme-context.js';

// ============================================================================
// Props
// ============================================================================

interface StructuredOutputProps {
  /** Data to render - can be any RenderableData type or plain string */
  data: unknown;
  /** Optional title to display above the output */
  title?: string;
  /** Force plain mode regardless of global settings */
  plain?: boolean;
  /** Maximum width for the output */
  maxWidth?: number;
}

// ============================================================================
// Component
// ============================================================================

export function StructuredOutput({
  data,
  title,
  plain,
  maxWidth,
}: StructuredOutputProps): React.ReactElement {
  const { colors } = useTheme();
  const manager = getRenderManager();

  // Build render context
  const context = useMemo((): Partial<RenderContext> => {
    const ctx: Partial<RenderContext> = {};
    if (plain) ctx.mode = 'plain';
    if (maxWidth) ctx.width = maxWidth;
    return ctx;
  }, [plain, maxWidth]);

  // Render the data
  const rendered = useMemo(() => {
    if (typeof data === 'string') {
      return data;
    }
    return manager.render(data, context);
  }, [data, context, manager]);

  // Check if we have a specialized renderer for this data
  const _hasSpecialRenderer = useMemo(() => {
    return manager.canRender(data);
  }, [data, manager]);

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold color={colors.primary}>
            {title}
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {rendered.split('\n').map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

// ============================================================================
// Hook for programmatic rendering
// ============================================================================

/**
 * Hook to access the RenderManager for programmatic rendering
 */
export function useRenderManager() {
  const manager = getRenderManager();
  const globalContext = manager.getContext();

  return {
    /** Render data to string */
    render: (data: unknown, context?: Partial<RenderContext>) =>
      manager.render(data, context),

    /** Check if data can be rendered by a specialized renderer */
    canRender: (data: unknown) => manager.canRender(data),

    /** Get the current global render context */
    context: globalContext,

    /** Get all registered renderers */
    renderers: manager.getRenderers(),
  };
}

// ============================================================================
// Specialized Components
// ============================================================================

/**
 * TestResults - Render test execution results
 */
export function TestResults({
  results,
  plain,
}: {
  results: {
    summary: { total: number; passed: number; failed: number; skipped: number };
    tests: Array<{
      name: string;
      status: 'passed' | 'failed' | 'skipped' | 'pending';
      duration?: number;
      error?: string;
    }>;
    framework?: string;
    duration?: number;
  };
  plain?: boolean;
}): React.ReactElement {
  const data = {
    type: 'test-results' as const,
    ...results,
  };

  return <StructuredOutput data={data} plain={plain} />;
}

/**
 * Weather - Render weather information
 */
export function Weather({
  location,
  current,
  forecast,
  units = 'metric',
  plain,
}: {
  location: string;
  current: {
    temperature: number;
    condition: string;
    humidity?: number;
    windSpeed?: number;
  };
  forecast?: Array<{
    date: string;
    high: number;
    low: number;
    condition: string;
  }>;
  units?: 'metric' | 'imperial';
  plain?: boolean;
}): React.ReactElement {
  /* eslint-disable @typescript-eslint/no-explicit-any -- weather condition type conversion */
  const data = {
    type: 'weather' as const,
    location,
    current: {
      ...current,
      condition: current.condition as any,
    },
    forecast: forecast?.map((f) => ({
      ...f,
      condition: f.condition as any,
    })),
    /* eslint-enable @typescript-eslint/no-explicit-any */
    units,
  };

  return <StructuredOutput data={data} plain={plain} />;
}

/**
 * CodeStructure - Render code file analysis
 */
export function CodeStructure({
  filePath,
  language,
  classes,
  functions,
  imports,
  exports,
  variables,
  plain,
}: {
  filePath: string;
  language?: string;
  classes?: Array<{ name: string; methods: string[]; properties: string[] }>;
  functions?: Array<{ name: string; params: string[]; async?: boolean }>;
  imports?: Array<{ source: string; names: string[] }>;
  exports?: Array<{ name: string; kind: string }>;
  variables?: Array<{ name: string; kind: string }>;
  plain?: boolean;
}): React.ReactElement {
  const data = {
    type: 'code-structure' as const,
    filePath,
    language,
    classes: classes || [],
    functions: (functions || []).map((f) => ({
      ...f,
      returnType: undefined,
      line: undefined,
      exported: false,
    })),
    imports: (imports || []).map((i) => ({
      ...i,
      isDefault: false,
      line: undefined,
    })),
    exports: (exports || []).map((e) => ({
      ...e,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- export kind type conversion
      kind: e.kind as any,
      line: undefined,
    })),
    variables: (variables || []).map((v) => ({
      ...v,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variable kind type conversion
      kind: v.kind as any,
      type: undefined,
      line: undefined,
      exported: false,
    })),
  };

  return <StructuredOutput data={data} plain={plain} />;
}

export default StructuredOutput;
