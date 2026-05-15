export const TOOL_COMPLETED_WITH_NO_OUTPUT = 'Tool completed successfully with no output.';
export const TOOL_FAILED_WITH_NO_DETAILS = 'Tool failed without error details.';

export interface ToolResultContentLike {
  success: boolean;
  output?: string;
  content?: string;
  error?: string;
}

export function formatToolResultContent(result: ToolResultContentLike | null | undefined): string {
  if (!result) return TOOL_FAILED_WITH_NO_DETAILS;
  if (result.success) {
    return result.output?.trim() || result.content?.trim() || TOOL_COMPLETED_WITH_NO_OUTPUT;
  }
  return result.error?.trim() || result.output?.trim() || result.content?.trim() || TOOL_FAILED_WITH_NO_DETAILS;
}
