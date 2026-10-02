import { withCompactToolSurface } from '../../prompts/headless-compact.js';
import { WritePolicy } from '../../security/write-policy.js';
import type { OllamaNativeRequest } from './ollama-native-transport.js';

/** Independently written, inspired by OpenClaw's bounded bootstrap and
 * Hermes' assembled token accounting. Use progressive tool discovery and omit redundant schema aliases;
 * canonical arguments, required fields and executable guards are unchanged.
 */
export function compactOllamaRequest(request: OllamaNativeRequest): OllamaNativeRequest {
  const copy = structuredClone(request);
  // Progressive discovery keeps the search capability through tool_search.
  // Its full schema becomes visible as soon as discovery is actually used.
  const names = new Set(
    (copy.tools ?? []).map((value) => (value as { function?: { name?: string } }).function?.name)
  );
  const discovered = copy.messages.some((message) =>
    (message.tool_calls as Array<{ function?: { name?: string } }> | undefined)?.some(
      (call) => call.function?.name === 'tool_search' || call.function?.name === 'search'
    )
  );
  if (names.has('tool_search') && !discovered) {
    const creationRequest = copy.messages.some(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        /\b(?:create|scaffold|cre[eé]|ajoute|add)\b/i.test(message.content)
    );
    const patchRequired =
      WritePolicy.getInstance().getMode() === 'strict' ||
      creationRequest ||
      copy.messages.some(
        (message) =>
          message.role === 'user' &&
          typeof message.content === 'string' &&
          /\b(?:apply_patch|patch|diff)\b/i.test(message.content)
      );
    copy.tools = copy.tools?.filter((value) => {
      const name = (value as { function?: { name?: string } }).function?.name;
      return (
        name !== 'search' &&
        !(name === 'create_file' && names.has('apply_patch') && !creationRequest) &&
        !(name === 'apply_patch' && names.has('str_replace_editor') && !patchRequired)
      );
    });
  }
  for (const value of copy.tools ?? []) {
    const tool = value as {
      function?: {
        name?: string;
        description?: string;
        parameters?: { properties?: Record<string, { description?: string; maximum?: number }>; required?: string[] };
      };
    };
    const concise: Record<string, string> = {
      view_file: 'Read a file.',
      str_replace_editor: 'Edit a file using exact old_str/new_str.',
      apply_patch: 'Apply the patch grammar below.',
      bash: 'Execute a shell command.',
      tool_search: 'Discover tools and expose their schemas.',
      restore_context: 'Recover exact stored output by identifier.',
    };
    if (tool.function?.name && concise[tool.function.name])
      tool.function.description = concise[tool.function.name];
    else if (tool.function?.description) {
      // Keep complete opening instructions; schemas and host validators retain
      // constraints. Never cut a sentence into an invalid instruction fragment.
      const sentences = tool.function.description.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g);
      if (sentences?.length) tool.function.description = sentences[0]!.trim();
    }
    const schema = tool.function?.parameters;
    if (!schema?.properties) continue;
    if (tool.function?.name === 'restore_context' && schema.properties.max_chars) schema.properties.max_chars.maximum = 320;
    for (const [name, property] of Object.entries(schema.properties)) {
      const alias = property.description?.match(/^Alias for (\w+)\.?$/)?.[1];
      if (alias && schema.properties[alias] && !schema.required?.includes(name))
        delete schema.properties[name];
      // Parameter names/types/enums remain literal. The patch grammar is a
      // necessary protocol, so keep its description in full.
      else if (name !== 'patch') delete property.description;
    }
  }
  // Progressive discovery may have removed schemas after agent selection.
  // Describe the final wire surface, never tools absent from this request.
  const exposed = (copy.tools ?? []).filter((tool): tool is { function: { name: string } } =>
    typeof (tool as { function?: { name?: unknown } }).function?.name === 'string');
  for (const message of copy.messages) {
    if (message.role === 'system' && typeof message.content === 'string') {
      message.content = withCompactToolSurface(message.content, exposed);
    }
  }
  return copy;
}
