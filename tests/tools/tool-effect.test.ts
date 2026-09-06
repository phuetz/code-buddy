import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../src/utils/logger.js';
import {
  TOOL_METADATA,
  resetToolEffectWarningLatch,
  resolveToolEffect,
} from '../../src/tools/metadata.js';
import { TOOL_EFFECT_CLASSES, type ToolEffectClass } from '../../src/tools/types.js';
import { ToolSearchTool, initToolSearchIndex } from '../../src/tools/tool-search.js';

const EMISSION_JUSTIFICATION: Record<string, string> = {
  bash: 'spawn shell',
  terminal: 'spawn shell',
  interactive_shell: 'PTY spawn',
  process: 'spawn or kill',
  app_server: 'spawn server',
  js_repl: 'eval runtime',
  execute_code: 'subprocess',
  code_exec: 'nested execution',
  git: 'remote push/fetch',
  docker: 'container spawn',
  kubernetes: 'cluster API',
  web_search: 'HTTP search',
  community_search: 'HTTP search',
  weather: 'HTTP weather',
  stock_quote: 'HTTP quote',
  deep_research: 'HTTP research',
  comfy_recipe: 'ComfyUI/GPU',
  web_fetch: 'HTTP fetch',
  web_scrape: 'HTTP scrape',
  web_extract: 'HTTP extract',
  internet_scout_run: 'live browse',
  browser_navigate: 'browser network',
  browser_click: 'browser input',
  browser_type: 'browser input',
  browser_scroll: 'browser input',
  browser_back: 'browser navigation',
  browser_press: 'browser input',
  browser_vision: 'browser capture',
  browser_dialog: 'browser UI',
  browser_get_images: 'browser fetch',
  browser_console: 'browser inspect',
  browser_snapshot: 'browser capture',
  lead_scout_run: 'outbound scout',
  firecrawl_search: 'HTTP firecrawl',
  firecrawl_scrape: 'HTTP firecrawl',
  browser: 'browser automation',
  web_test: 'browser + spawn',
  browser_operator: 'browser session',
  computer_control: 'OS input synthesis',
  office_macro_execute: 'macro execution',
  send_message: 'outbound message',
  discord: 'Discord API',
  discord_admin: 'Discord API',
  yb_query_group_info: 'Yuanbao API',
  yb_query_group_members: 'Yuanbao API',
  yb_send_dm: 'Yuanbao message',
  yb_search_sticker: 'Yuanbao API',
  yb_send_sticker: 'Yuanbao message',
  ha_list_entities: 'Home Assistant API',
  ha_get_state: 'Home Assistant API',
  ha_list_services: 'Home Assistant API',
  ha_call_service: 'Home Assistant call',
  mixture_of_agents: 'LLM fan-out',
  spotify_playback: 'Spotify API',
  spotify_devices: 'Spotify API',
  spotify_queue: 'Spotify API',
  spotify_search: 'Spotify API',
  spotify_playlists: 'Spotify API',
  spotify_albums: 'Spotify API',
  spotify_library: 'Spotify API',
  x_search: 'X API',
  feishu_doc_read: 'Feishu API',
  feishu_drive_list_comments: 'Feishu API',
  feishu_drive_list_comment_replies: 'Feishu API',
  feishu_drive_reply_comment: 'Feishu message',
  feishu_drive_add_comment: 'Feishu message',
  cronjob: 'schedules future work',
  spawn_subagent: 'spawn agent',
  audio: 'audio capture/out',
  text_to_speech: 'speech output',
  image_generate: 'generation API/GPU',
  lisa_selfie: 'generation API/GPU',
  image_edit: 'generation API/GPU',
  video: 'media pipeline',
  video_generate: 'generation API/GPU',
  video_stitch: 'ffmpeg spawn',
  video_quality_gate: 'ffmpeg spawn',
  video_flow_handoff: 'Flow API',
  gpu_media_job: 'GPU job',
  clipboard: 'lossy clipboard overwrite',
  run_script: 'script spawn',
  diagram: 'renderer spawn or remote Kroki',
  deploy: 'remote deploy',
  skill_discover: 'may fetch remote catalogs',
  device_manage: 'ssh/adb',
  spawn_parallel_agents: 'spawn agents',
  task_verify: 'may execute tests',
  terminate: 'process kill',
  verify: 'may execute tests',
  delegate_agent: 'spawn agent',
  peer_delegate: 'fleet network',
  peer_chain: 'fleet network',
  list_peers: 'fleet network',
  route_peer: 'peer.describe network',
  sessions_send: 'cross-session message',
  sessions_spawn: 'spawn session',
  lint_project: 'linter spawn',
  test_runner: 'test spawn',
  build_project: 'build spawn',
  http_probe: 'HTTP probe',
};

describe('C5 tool effect taxonomy', () => {
  beforeEach(() => {
    resetToolEffectWarningLatch();
  });

  afterEach(() => {
    resetToolEffectWarningLatch();
    vi.restoreAllMocks();
  });

  it('assigns every catalog tool a declared effect class', () => {
    const unnamed = TOOL_METADATA.filter((entry) => !entry.name);
    expect(unnamed).toEqual([]);
    const missing = TOOL_METADATA.filter(
      (entry) => !entry.effect || !TOOL_EFFECT_CLASSES.includes(entry.effect),
    ).map((entry) => entry.name);
    expect(missing, `tools without effect class: ${missing.join(', ')}`).toEqual([]);
  });

  it('classifies the audit sketch: view_file read, writes reversible, bash/stock_quote emission', () => {
    expect(resolveToolEffect('view_file')).toBe('read');
    expect(resolveToolEffect('create_file')).toBe('reversible');
    expect(resolveToolEffect('bash')).toBe('emission');
    expect(resolveToolEffect('stock_quote')).toBe('emission');
  });

  it('justifies every emission tool (no silent irreversible class)', () => {
    const emissions = TOOL_METADATA.filter((entry) => entry.effect === 'emission').map((entry) => entry.name);
    const unjustified = emissions.filter((name) => !EMISSION_JUSTIFICATION[name]);
    expect(unjustified, `emission without justification: ${unjustified.join(', ')}`).toEqual([]);
    const stale = Object.keys(EMISSION_JUSTIFICATION).filter((name) => !emissions.includes(name));
    expect(stale, `stale emission justification: ${stale.join(', ')}`).toEqual([]);
  });

  it('warns once for a write tool without a class, then treats it as unknown', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const nameless = { effect: undefined };
    expect(resolveToolEffect('authored__scratch_write', nameless)).toBe('unknown');
    expect(resolveToolEffect('authored__scratch_write', nameless)).toBe('unknown');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('missing effect class');
  });

  it('exposes effect in tool_search listings', async () => {
    initToolSearchIndex(
      TOOL_METADATA.filter((entry) => entry.name === 'view_file' || entry.name === 'stock_quote').map((entry) => ({
        name: entry.name,
        description: entry.description,
        keywords: entry.keywords,
      })),
    );
    const result = await new ToolSearchTool().execute({ query: 'stock quote' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('effect: emission');
    expect((result.data as { effects?: Record<string, ToolEffectClass> })?.effects?.stock_quote).toBe('emission');
  });
});
