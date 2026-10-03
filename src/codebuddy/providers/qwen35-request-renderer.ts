/**
 * Adapted from Ollama v0.30.7 model/renderers/qwen35.go and api/types.go.
 * https://github.com/ollama/ollama/tree/v0.30.7/model/renderers
 *
 * MIT License
 *
 * Copyright (c) Ollama
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { OllamaNativeRequest } from './ollama-native-transport.js';

const TOOL_POSTAMBLE = "\n</tools>\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported native JSON object');
  return value as ObjectValue;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
  return value;
}
function marshal(value: unknown, spaced = false): string {
  let text = JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (!spaced) return text;
  let quoted = false; let escaped = false; let output = '';
  for (const char of text) {
    output += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',' || char === ':') output += ' ';
  }
  text = output;
  return text;
}
function properties(value: unknown): unknown {
  return value == null ? null : Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, property(object(item))]));
}
function property(value: ObjectValue): ObjectValue {
  const out: ObjectValue = {};
  // Native API structs discard unknown schema members and preserve this order.
  for (const key of ['anyOf', 'type', 'items', 'description', 'enum', 'properties', 'required']) {
    const item = value[key];
    if (item === undefined || item === '' || Array.isArray(item) && !item.length) continue;
    out[key] = key === 'type' && Array.isArray(item) && item.length === 1 ? item[0]
      : key === 'properties' ? properties(item)
      : key === 'anyOf' && Array.isArray(item) ? item.map(v => property(object(v))) : sorted(item);
  }
  return out;
}
function definition(value: unknown): ObjectValue {
  const tool = object(value); const fn = object(tool.function); const params = object(fn.parameters);
  const out: ObjectValue = { type: tool.type };
  if (tool.items != null) out.items = sorted(tool.items);
  const func: ObjectValue = { name: fn.name };
  if (fn.description) func.description = fn.description;
  const parameters: ObjectValue = { type: params.type ?? '' };
  for (const key of ['$defs', 'items', 'required']) {
    const item = params[key];
    if (item !== undefined && (!Array.isArray(item) || item.length)) parameters[key] = sorted(item);
  }
  parameters.properties = properties(params.properties);
  func.parameters = parameters; out.function = func;
  return out;
}
// Go strings.TrimSpace follows Unicode White_Space: it trims NEL but keeps
// BOM, unlike JavaScript trim(). Token admission must render the same bytes.
function trimNative(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
function content(message: ObjectValue): string {
  if (Array.isArray(message.images) && message.images.length) throw new Error('Native prompt admission cannot count image tokens');
  if (typeof message.content !== 'string') throw new Error('Native prompt admission requires textual messages');
  return trimNative(message.content);
}

function argument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Go fmt's default float representation uses a two-digit exponent and
    // scientific notation outside [1e-4, 1e6), unlike JSON serialization.
    const absolute = Math.abs(value);
    if (absolute >= 1e6 || absolute > 0 && absolute < 1e-4)
      return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
    return String(value);
  }
  return marshal(sorted(value));
}

/** Text-only Qwen 3.5 native rendering, including tool schema and reply prefix. */
export function renderQwen35Request(body: OllamaNativeRequest): string {
  const messages = body.messages; const tools = body.tools ?? [];
  const thinking = body.think !== false;
  const start = '<|im_start|>'; const end = '<|im_end|>\n';
  let output = '';
  if (tools.length) {
    output = start + 'system\n# Tools\n\nYou have access to the following functions:\n\n<tools>'
      + tools.map(tool => '\n' + marshal(definition(tool), true)).join('') + TOOL_POSTAMBLE;
    if (messages[0]?.role === 'system' && content(messages[0])) output += '\n\n' + content(messages[0]);
    output += end;
  } else if (messages[0]?.role === 'system') output = start + 'system\n' + content(messages[0]) + end;
  const lastUser = messages.findLastIndex(message => message.role === 'user'
    && !(content(message).startsWith('<tool_response>') && content(message).endsWith('</tool_response>')));
  for (const [index, message] of messages.entries()) {
    let text = content(message);
    const last = index === messages.length - 1;
    const prefill = last && message.role === 'assistant';
    if (message.role === 'user' || message.role === 'system' && index !== 0) {
      output += start + String(message.role) + '\n' + text + end;
    } else if (message.role === 'assistant') {
      let reasoning = '';
      if (thinking && typeof message.thinking === 'string' && message.thinking) reasoning = trimNative(message.thinking);
      else if (text.includes('</think>')) {
        const offset = text.indexOf('</think>');
        reasoning = trimNative(text.slice(0, offset).split('<think>').at(-1)!);
        text = text.slice(offset + 8).replace(/^\n+/, '');
      }
      output += start + 'assistant\n' + (thinking && index > lastUser ? '<think>\n' + reasoning + '\n</think>\n\n' : '') + text;
      if (Array.isArray(message.tool_calls)) for (const [callIndex, value] of message.tool_calls.entries()) {
        const call = object(object(value).function);
        output += (callIndex ? '\n' : trimNative(text) ? '\n\n' : '') + '<tool_call>\n<function=' + String(call.name) + '>\n';
        for (const [key, item] of Object.entries(object(call.arguments))) {
          output += '<parameter=' + key + '>\n' + argument(item) + '\n</parameter>\n';
        }
        output += '</function>\n</tool_call>';
      }
      if (!prefill) output += end;
    } else if (message.role === 'tool') {
      if (messages[index - 1]?.role !== 'tool') output += start + 'user';
      output += '\n<tool_response>\n' + text + '\n</tool_response>';
      if (messages[index + 1]?.role !== 'tool') output += end;
    } else if (message.role !== 'system') throw new Error('Unsupported native message role');
    if (last && !prefill) output += start + 'assistant\n' + (thinking ? '<think>\n' : '<think>\n\n</think>\n\n');
  }
  return output;
}
