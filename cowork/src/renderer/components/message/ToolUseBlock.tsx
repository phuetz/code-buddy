// Tool use card — collapsible, merges matching tool_result from same/other messages
import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, Loader2, XCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { shouldUseScreenshotSummary } from '../../utils/tool-result-summary';
import type { ToolUseContent, ToolResultContent, ContentBlock, Message } from '../../types';
import { AskUserQuestionBlock } from './AskUserQuestionBlock';
import { TodoWriteBlock } from './TodoWriteBlock';
import { getToolIcon, getToolLabel } from './toolHelpers';
import { TerminalOutput } from './TerminalOutput';
import { DiffViewer } from '../DiffViewer';
import { WidgetBlock } from '../widgets/WidgetBlock';

const EDIT_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'create_file', 'write_file', 'edit_file', 'apply_patch']);
const BASH_TOOLS = new Set(['bash', 'execute_command', 'shell_exec', 'run_command']);

// Only allow safe image MIME types for data: URI rendering
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface ToolUseBlockProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ToolUseBlock = memo(function ToolUseBlock({
  block,
  allBlocks,
  message,
}: ToolUseBlockProps) {
  const traceSteps = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.traceSteps ?? []) : []
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.messages ?? []) : []
  );
  const activeTurn = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.activeTurn ?? null) : null
  );
  const [expanded, setExpanded] = useState(false);

  // Special-case tool UIs
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  // Find matching tool_result: first in same message, then across all session messages
  let toolResult = allBlocks?.find(
    (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
  ) as ToolResultContent | undefined;

  if (!toolResult && message?.sessionId) {
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const found = (msg.content as ContentBlock[]).find(
        (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
      );
      if (found) {
        toolResult = found as ToolResultContent;
        break;
      }
    }
  }

  // Determine state: running / success / error
  // Only show spinner if session still has an active turn; otherwise treat as done
  const hasActiveTurn = Boolean(activeTurn);
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;
  const isSuccess = Boolean(toolResult && !isError);
  const widgetData = toolResult && !isError ? toolResult.data : undefined;

  // Live output while running — tool_stream deltas accumulated on the trace
  // step by the store. The card streams instead of hiding behind the spinner.
  const liveOutput = isRunning
    ? traceSteps.find((s) => s.id === block.id)?.toolOutput
    : undefined;
  const liveLastLine = liveOutput
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  const label = getToolLabel(block.name, block.input);
  const isMCPTool = block.name.startsWith('mcp__');
  const mcpServerName = isMCPTool ? block.name.match(/^mcp__(.+?)__/)?.[1] : null;

  const getSummary = (): string => {
    if (!toolResult) return '';
    const content = typeof toolResult.content === 'string' ? toolResult.content : '';
    if (toolResult.isError) {
      const firstLine = content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(block.name, content)) return 'Screenshot captured';
    if (content.length < 60) return content.trim();
    const lines = content.trim().split(/\r?\n/);
    return `${lines.length} lines`;
  };

  const summary = getSummary();

  // Duration from trace steps
  let duration: number | undefined;
  if (message?.sessionId) {
    const resultStep = traceSteps.find((s) => s.id === block.id && s.type === 'tool_result');
    duration = resultStep?.duration;
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isError
          ? 'border-error/25 bg-error/5'
          : isRunning
            ? 'border-accent/15 bg-accent/5'
            : 'border-border-subtle bg-background/40'
      }`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {/* Status icon */}
        <div
          className={`flex-shrink-0 ${
            isError ? 'text-error' : isRunning ? 'text-accent' : 'text-text-muted'
          }`}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isError ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )}
        </div>

        {/* Tool icon */}
        <div className="flex-shrink-0 text-text-muted">{getToolIcon(block.name)}</div>

        {/* Label */}
        <span className="text-xs font-mono text-text-secondary truncate flex-1 min-w-0">
          {label}
        </span>

        {/* MCP badge */}
        {isMCPTool && mcpServerName && (
          <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-mcp/15 text-mcp flex-shrink-0 font-medium">
            {mcpServerName}
          </span>
        )}

        {/* Summary / duration */}
        {isSuccess && summary && !expanded && (
          <span className="text-[11px] text-text-muted truncate max-w-[180px] flex-shrink-0">
            {summary}
          </span>
        )}
        {isRunning && liveLastLine && !expanded && (
          <span className="text-[11px] font-mono text-text-muted truncate max-w-[180px] flex-shrink-0">
            {liveLastLine}
          </span>
        )}
        {duration !== undefined && (
          <span className="text-[10px] text-text-muted flex-shrink-0 tabular-nums">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Chevron */}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {widgetData !== undefined && <WidgetBlock data={widgetData} className="mb-2 mt-2" />}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 animate-fade-in bg-background/35">
          {/* Input section */}
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
              Input
            </div>
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-muted rounded-lg p-2.5 border border-border-subtle">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>

          {/* Live streaming output while the tool runs */}
          {!toolResult && liveOutput && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                Output (streaming…)
              </div>
              {BASH_TOOLS.has(block.name) ? (
                <TerminalOutput
                  command={typeof block.input?.command === 'string' ? block.input.command : undefined}
                  output={liveOutput}
                  isError={false}
                />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto text-text-secondary bg-surface-muted">
                  {liveOutput}
                </pre>
              )}
            </div>
          )}

          {/* Output section */}
          {toolResult && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                Output
              </div>

              {/* Terminal-style output for bash tools */}
              {BASH_TOOLS.has(block.name) ? (
                <TerminalOutput
                  command={typeof block.input?.command === 'string' ? block.input.command : undefined}
                  output={toolResult.content}
                  isError={isError}
                />
              ) : (
                <pre
                  className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto ${
                    isError ? 'text-error bg-error/5' : 'text-text-secondary bg-surface-muted'
                  }`}
                >
                  {toolResult.content}
                </pre>
              )}

              {/* Inline diff for edit tools */}
              {EDIT_TOOLS.has(block.name) && toolResult.content && !isError && (
                <DiffViewer
                  diff={{
                    path: typeof block.input?.file_path === 'string' ? block.input.file_path
                      : typeof block.input?.path === 'string' ? block.input.path
                      : typeof block.input?.filename === 'string' ? block.input.filename
                      : 'file',
                    action: block.name === 'create_file' || block.name === 'write_file' ? 'create' : 'modify',
                    linesAdded: (toolResult.content.match(/^\+/gm) || []).length,
                    linesRemoved: (toolResult.content.match(/^-/gm) || []).length,
                    excerpt: toolResult.content,
                  }}
                />
              )}

              {/* Images */}
              {Array.isArray(toolResult.images) &&
                toolResult.images.map((image, index) =>
                  image?.mimeType && image?.data && ALLOWED_IMAGE_TYPES.has(image.mimeType) ? (
                    <div
                      key={index}
                      className="mt-2 border border-border rounded-lg overflow-hidden"
                    >
                      <img
                        src={`data:${image.mimeType};base64,${image.data}`}
                        alt={`Output ${index + 1}`}
                        className="w-full h-auto"
                        style={{ maxHeight: '400px', objectFit: 'contain' }}
                      />
                    </div>
                  ) : null
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
