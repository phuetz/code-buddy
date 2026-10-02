import { resolveToolPath } from '../utils/tool-execution-context.js';
import fs from 'fs/promises';

import type { ToolResult } from '../types/index.js';

export type YuanbaoToolName =
  | 'yb_query_group_info'
  | 'yb_query_group_members'
  | 'yb_send_dm'
  | 'yb_search_sticker'
  | 'yb_send_sticker';

export interface YuanbaoToolOptions {
  gatewayUrl?: string;
  token?: string;
  homeChatId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  env?: NodeJS.ProcessEnv;
}

export interface YuanbaoExecutionPayload {
  kind: 'yuanbao_result';
  ok: boolean;
  tool: YuanbaoToolName;
  data?: unknown;
  request?: {
    method: 'POST';
    path: string;
  };
  error?: string;
}

interface YuanbaoContext {
  gatewayUrl?: string;
  token?: string;
  homeChatId?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  userAgent: string;
  env: NodeJS.ProcessEnv;
}

interface YuanbaoRequest {
  path: string;
  body: Record<string, unknown>;
}

interface YuanbaoMember {
  user_id: string;
  nickname: string;
  role: string;
}

interface YuanbaoSticker {
  sticker_id: string;
  name: string;
  description: string;
  package_id: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MENTION_HINT =
  'To @mention a user, you MUST use the format: space + @ + nickname + space (e.g. " @Alice ").';
const USER_TYPE_LABEL: Record<number, string> = {
  0: 'unknown',
  1: 'user',
  2: 'yuanbao_ai',
  3: 'bot',
};
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const YUANBAO_MUTATING_TOOLS = new Set<YuanbaoToolName>(['yb_send_dm', 'yb_send_sticker']);
const FALLBACK_STICKERS: YuanbaoSticker[] = [
  { sticker_id: '1', name: 'ok', description: 'Affirmative OK gesture', package_id: 'codebuddy-default' },
  { sticker_id: '2', name: 'heart', description: 'Warm appreciation or agreement', package_id: 'codebuddy-default' },
  { sticker_id: '3', name: 'cool', description: 'Calm confident approval', package_id: 'codebuddy-default' },
  { sticker_id: '666', name: 'six-six-six', description: 'Strong praise or impressive result', package_id: 'codebuddy-default' },
  { sticker_id: '8', name: 'thinking', description: 'Thinking or considering the next move', package_id: 'codebuddy-default' },
];

export async function executeYuanbaoTool(
  toolName: YuanbaoToolName,
  input: Record<string, unknown>,
  options: YuanbaoToolOptions = {},
): Promise<ToolResult> {
  try {
    const context = resolveContext(options);
    if (YUANBAO_MUTATING_TOOLS.has(toolName)) {
      requireApproval(input, toolName, context.env);
    }

    const payload = await executeYuanbaoOperation(toolName, input, context);
    return {
      success: payload.ok,
      output: JSON.stringify(payload, null, 2),
      data: payload,
      ...(payload.error ? { error: payload.error } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload: YuanbaoExecutionPayload = {
      kind: 'yuanbao_result',
      ok: false,
      tool: toolName,
      error: message,
    };
    return {
      success: false,
      error: message,
      output: JSON.stringify(payload, null, 2),
      data: payload,
    };
  }
}

async function executeYuanbaoOperation(
  toolName: YuanbaoToolName,
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  switch (toolName) {
    case 'yb_query_group_info':
      return queryGroupInfo(input, context);
    case 'yb_query_group_members':
      return queryGroupMembers(input, context);
    case 'yb_search_sticker':
      return searchSticker(input, context);
    case 'yb_send_sticker':
      return sendSticker(input, context);
    case 'yb_send_dm':
      return sendDm(input, context);
  }
}

async function queryGroupInfo(
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  const groupCode = requiredString(input, 'group_code');
  const request = yuanbaoRequest('/yuanbao/query_group_info', { group_code: groupCode });
  const body = await requestGateway(context, request);
  const data = asRecord(unwrapData(body));
  const owner = asRecord(data.owner);
  return ok('yb_query_group_info', {
    success: true,
    group_code: stringField(data, 'group_code') || groupCode,
    group_name: stringField(data, 'group_name'),
    member_count: numberField(data, 'member_count'),
    owner: {
      user_id: stringField(owner, 'user_id') || stringField(data, 'owner_id'),
      nickname: stringField(owner, 'nickname') || stringField(data, 'owner_nickname'),
    },
    note: 'The group is called "Pai" in the app.',
  }, request);
}

async function queryGroupMembers(
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  const groupCode = requiredString(input, 'group_code');
  const action = parseMemberAction(input.action);
  const name = optionalString(input, 'name');
  const mention = coerceBoolean(input.mention);
  const members = await fetchMembers(groupCode, context);
  const hint = mention ? { mention_hint: MENTION_HINT } : {};

  if (members.length === 0) {
    return fail('yb_query_group_members', 'No members found in this group.');
  }

  if (action === 'list_bots') {
    const bots = members.filter((member) => member.role === 'yuanbao_ai' || member.role === 'bot');
    if (bots.length === 0) {
      return fail('yb_query_group_members', 'No bots found in this group.');
    }
    return ok('yb_query_group_members', {
      success: true,
      msg: `Found ${bots.length} bot(s).`,
      members: bots,
      ...hint,
    });
  }

  if (action === 'find' && name) {
    const needle = name.toLowerCase();
    const matched = members.filter((member) => member.nickname.toLowerCase().includes(needle));
    if (matched.length > 0) {
      return ok('yb_query_group_members', {
        success: true,
        msg: `Found ${matched.length} member(s) matching "${name}".`,
        members: matched,
        ...hint,
      });
    }
    return ok('yb_query_group_members', {
      success: false,
      msg: `No match for "${name}". All members listed below.`,
      members,
      ...hint,
    });
  }

  return ok('yb_query_group_members', {
    success: true,
    msg: `Found ${members.length} member(s).`,
    members,
    ...hint,
  });
}

async function searchSticker(
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  const query = optionalString(input, 'query') ?? '';
  const limit = normalizeLimit(input.limit, 10, 50);
  const request = yuanbaoRequest('/yuanbao/search_sticker', { query, limit });
  if (!context.gatewayUrl) {
    return ok('yb_search_sticker', stickerSearchPayload(query, limit, FALLBACK_STICKERS), request);
  }
  const body = await requestGateway(context, request);
  const data = unwrapData(body);
  const results = stickerResults(data);
  return ok('yb_search_sticker', stickerSearchPayload(query, limit, results), request);
}

async function sendSticker(
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  const chatId = optionalString(input, 'chat_id') ?? context.homeChatId ?? '';
  if (!chatId) {
    throw new Error('chat_id is required (no active Yuanbao session detected)');
  }
  const sticker = optionalString(input, 'sticker') ?? '';
  const replyTo = optionalString(input, 'reply_to') ?? '';
  const request = yuanbaoRequest('/yuanbao/send_sticker', {
    chat_id: chatId,
    sticker,
    reply_to: replyTo,
  });
  const body = await requestGateway(context, request);
  assertOperationOk(body, 'yb_send_sticker');
  const data = asRecord(unwrapData(body));
  const stickerRecord = asRecord(data.sticker);
  return ok('yb_send_sticker', {
    success: true,
    chat_id: stringField(data, 'chat_id') || chatId,
    sticker: {
      sticker_id: stringField(stickerRecord, 'sticker_id') || stringField(data, 'sticker_id') || sticker,
      name: stringField(stickerRecord, 'name') || stringField(data, 'sticker_name') || sticker,
    },
    message_id: stringField(data, 'message_id') || undefined,
    note:
      'Sticker delivered to the chat. If you have additional text to say, reply now; otherwise end your turn without generating text.',
  }, request);
}

async function sendDm(
  input: Record<string, unknown>,
  context: YuanbaoContext,
): Promise<YuanbaoExecutionPayload> {
  const mediaFiles = await normalizeMediaFiles(input.media_files);
  const extracted = extractMediaTags(optionalString(input, 'message') ?? '');
  const message = extracted.message;
  for (const media of extracted.mediaFiles) {
    await assertReadableFile(media.path);
    mediaFiles.push(media);
  }
  if (!message && mediaFiles.length === 0) {
    throw new Error('message or media_files is required');
  }

  const fallbackGroupCode = groupCodeFromChatId(context.homeChatId);
  const groupCode = optionalString(input, 'group_code') ?? fallbackGroupCode ?? '';
  const name = optionalString(input, 'name') ?? '';
  let userId = optionalString(input, 'user_id') ?? '';
  let nickname = name;

  if (!userId) {
    if (!groupCode) {
      throw new Error('group_code is required when user_id is not provided');
    }
    if (!name) {
      throw new Error('name is required when user_id is not provided');
    }
    const members = await fetchMembers(groupCode, context);
    const matches = members.filter((member) => member.nickname.toLowerCase().includes(name.toLowerCase()));
    if (matches.length === 0) {
      return fail('yb_send_dm', `No member matching "${name}" found in group ${groupCode}.`);
    }
    if (matches.length > 1) {
      return ok('yb_send_dm', {
        success: false,
        error: `Multiple members match "${name}". Please specify which one.`,
        candidates: matches.map((member) => ({ user_id: member.user_id, nickname: member.nickname })),
      });
    }
    const match = matches[0]!;
    userId = match.user_id;
    nickname = match.nickname;
  }

  if (!userId) {
    throw new Error('Could not resolve user_id');
  }

  const request = yuanbaoRequest('/yuanbao/send_dm', {
    group_code: groupCode,
    user_id: userId,
    name: nickname,
    message,
    media_files: mediaFiles,
  });
  const body = await requestGateway(context, request);
  assertOperationOk(body, 'yb_send_dm');
  const data = asRecord(unwrapData(body));
  return ok('yb_send_dm', {
    success: true,
    user_id: stringField(data, 'user_id') || userId,
    nickname: stringField(data, 'nickname') || nickname,
    message_id: stringField(data, 'message_id') || undefined,
    note: `DM sent to "${nickname}" successfully.`,
  }, request);
}

async function fetchMembers(groupCode: string, context: YuanbaoContext): Promise<YuanbaoMember[]> {
  const request = yuanbaoRequest('/yuanbao/get_group_member_list', { group_code: groupCode });
  const body = await requestGateway(context, request);
  const data = unwrapData(body);
  return memberResults(data);
}

function resolveContext(options: YuanbaoToolOptions): YuanbaoContext {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  return {
    gatewayUrl: normalizeBaseUrl(
      options.gatewayUrl
      ?? env.CODEBUDDY_YUANBAO_GATEWAY_URL
      ?? env.YUANBAO_GATEWAY_URL,
    ),
    token: trim(options.token ?? env.CODEBUDDY_YUANBAO_TOKEN ?? env.YUANBAO_TOKEN),
    homeChatId: trim(
      options.homeChatId
      ?? env.CODEBUDDY_YUANBAO_HOME_CHAT_ID
      ?? env.HERMES_SESSION_CHAT_ID,
    ),
    fetchImpl,
    timeoutMs: Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    userAgent: options.userAgent ?? `Code-Buddy/${env.npm_package_version ?? 'dev'}`,
    env,
  };
}

async function requestGateway(context: YuanbaoContext, request: YuanbaoRequest): Promise<unknown> {
  if (!context.gatewayUrl) {
    throw new Error('CODEBUDDY_YUANBAO_GATEWAY_URL or YUANBAO_GATEWAY_URL is required for Yuanbao adapter access');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  try {
    const response = await context.fetchImpl(joinUrl(context.gatewayUrl, request.path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': context.userAgent,
        ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}),
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) {
      throw new Error(httpErrorMessage(response.status, parsed));
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Yuanbao request timed out after ${context.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeMediaFiles(value: unknown): Promise<Array<{ path: string; is_voice: boolean; media_kind: string }>> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('media_files must be an array');
  }
  const mediaFiles: Array<{ path: string; is_voice: boolean; media_kind: string }> = [];
  for (const item of value) {
    const record = asRecord(item);
    const mediaPath = stringField(record, 'path');
    if (!mediaPath) {
      throw new Error('media_files entries require path');
    }
    await assertReadableFile(mediaPath);
    mediaFiles.push({
      path: mediaPath,
      is_voice: coerceBoolean(record.is_voice),
      media_kind: mediaKind(mediaPath),
    });
  }
  return mediaFiles;
}

function extractMediaTags(message: string): {
  message: string;
  mediaFiles: Array<{ path: string; is_voice: boolean; media_kind: string }>;
} {
  const mediaFiles: Array<{ path: string; is_voice: boolean; media_kind: string }> = [];
  const cleaned = message.replace(/MEDIA:([^\s]+)/g, (_full, mediaPath: string) => {
    mediaFiles.push({ path: mediaPath, is_voice: false, media_kind: mediaKind(mediaPath) });
    return '';
  }).trim();
  return { message: cleaned, mediaFiles };
}

function requireApproval(input: Record<string, unknown>, toolName: YuanbaoToolName, env: NodeJS.ProcessEnv): void {
  if (env.CODEBUDDY_YUANBAO_ALLOW_SENDS === 'true') {
    return;
  }
  const approvedBy = optionalString(input, 'approved_by');
  if (!approvedBy) {
    throw new Error(`${toolName} requires approved_by for external Yuanbao delivery`);
  }
}

function assertOperationOk(body: unknown, toolName: YuanbaoToolName): void {
  const record = asRecord(body);
  if (record.ok === false || record.success === false) {
    throw new Error(stringField(record, 'error') || `${toolName} failed`);
  }
  const data = asRecord(record.data);
  if (data.ok === false || data.success === false) {
    throw new Error(stringField(data, 'error') || `${toolName} failed`);
  }
}

function unwrapData(body: unknown): unknown {
  const record = asRecord(body);
  if (record.success === false || record.ok === false) {
    throw new Error(stringField(record, 'error') || 'Yuanbao adapter returned failure');
  }
  return record.data ?? record.result ?? body;
}

function memberResults(value: unknown): YuanbaoMember[] {
  const record = asRecord(value);
  const source = Array.isArray(record.members)
    ? record.members
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(value)
        ? value
        : [];
  return source.map((item) => {
    const member = asRecord(item);
    return {
      user_id: stringField(member, 'user_id') || stringField(member, 'account_id'),
      nickname: stringField(member, 'nickname') || stringField(member, 'nick_name') || stringField(member, 'name'),
      role: roleLabel(member.role ?? member.user_type),
    };
  }).filter((member) => member.user_id || member.nickname);
}

function stickerResults(value: unknown): YuanbaoSticker[] {
  const record = asRecord(value);
  const source = Array.isArray(record.results)
    ? record.results
    : Array.isArray(record.matches)
      ? record.matches
      : Array.isArray(record.stickers)
        ? record.stickers
        : Array.isArray(value)
          ? value
          : [];
  return source.map((item) => {
    const sticker = asRecord(item);
    return {
      sticker_id: stringField(sticker, 'sticker_id') || stringField(sticker, 'id'),
      name: stringField(sticker, 'name') || stringField(sticker, 'sticker_name'),
      description: stringField(sticker, 'description'),
      package_id: stringField(sticker, 'package_id'),
    };
  }).filter((sticker) => sticker.sticker_id || sticker.name);
}

function stickerSearchPayload(query: string, limit: number, stickers: YuanbaoSticker[]): {
  success: boolean;
  query: string;
  count: number;
  results: YuanbaoSticker[];
} {
  const needle = query.toLowerCase();
  const filtered = needle
    ? stickers.filter((sticker) => {
      return (
        sticker.sticker_id.toLowerCase().includes(needle)
        || sticker.name.toLowerCase().includes(needle)
        || sticker.description.toLowerCase().includes(needle)
      );
    })
    : stickers;
  const results = filtered.slice(0, limit);
  return {
    success: true,
    query,
    count: results.length,
    results,
  };
}

function ok(
  tool: YuanbaoToolName,
  data: unknown,
  request?: YuanbaoRequest,
): YuanbaoExecutionPayload {
  return {
    kind: 'yuanbao_result',
    ok: true,
    tool,
    data,
    ...(request ? { request: { method: 'POST', path: request.path } } : {}),
  };
}

function fail(tool: YuanbaoToolName, error: string): YuanbaoExecutionPayload {
  return {
    kind: 'yuanbao_result',
    ok: false,
    tool,
    error,
  };
}

function yuanbaoRequest(path: string, body: Record<string, unknown>): YuanbaoRequest {
  return { path, body };
}

function parseMemberAction(value: unknown): 'find' | 'list_bots' | 'list_all' {
  const action = typeof value === 'string' && value ? value : 'list_all';
  if (action === 'find' || action === 'list_bots' || action === 'list_all') {
    return action;
  }
  throw new Error('action must be one of: find, list_bots, list_all');
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = optionalString(input, field);
  if (!value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  return trim(input[field]);
}

function trim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(numeric)));
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeBaseUrl(value: unknown): string | undefined {
  const raw = trim(value);
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function httpErrorMessage(status: number, parsed: unknown): string {
  const record = asRecord(parsed);
  return stringField(record, 'error') || stringField(record, 'message') || `Yuanbao adapter HTTP ${status}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function roleLabel(value: unknown): string {
  if (typeof value === 'number') {
    return USER_TYPE_LABEL[value] ?? 'unknown';
  }
  if (typeof value === 'string') {
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric) && USER_TYPE_LABEL[numeric]) {
      return USER_TYPE_LABEL[numeric];
    }
    return value || 'unknown';
  }
  return 'unknown';
}

function groupCodeFromChatId(chatId: string | undefined): string | undefined {
  if (!chatId?.startsWith('group:')) {
    return undefined;
  }
  const code = chatId.slice('group:'.length).trim();
  return code || undefined;
}

async function assertReadableFile(mediaPath: string): Promise<void> {
  const stat = await fs.stat(resolveToolPath(mediaPath));
  if (!stat.isFile()) {
    throw new Error(`media file is not a file: ${mediaPath}`);
  }
}

function mediaKind(mediaPath: string): string {
  const dot = mediaPath.lastIndexOf('.');
  const ext = dot >= 0 ? mediaPath.slice(dot).toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'document';
}
