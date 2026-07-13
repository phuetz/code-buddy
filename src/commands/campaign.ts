import fs from 'fs';
import { Command, InvalidArgumentError } from 'commander';
import {
  PubCommanderBridge,
  type PubCommanderModule,
} from '../integrations/pubcommander-bridge.js';

export interface CampaignToolCaller {
  call(module: PubCommanderModule, tool: string, args?: Record<string, unknown>): Promise<unknown>;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return parsed;
}

function csv(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function print(value: unknown, json: boolean = false): void {
  if (json || typeof value !== 'string') console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

export function createCampaignCommand(
  caller: CampaignToolCaller = new PubCommanderBridge(),
): Command {
  const command = new Command('campaign')
    .description('Native editorial, book-promotion and PubCommander campaign workspace');

  command
    .command('status')
    .description('Show every configured PubCommander capability module')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      const modules: PubCommanderModule[] = ['core', 'editorial', 'media', 'autoblog', 'analytics', 'automation'];
      const results = await Promise.all(modules.map(async module => {
        try {
          return { module, available: true, capabilities: await caller.call(module, 'get_pubcommander_capabilities') };
        } catch (error) {
          return { module, available: false, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      if (options.json) print({ modules: results }, true);
      else for (const result of results) {
        console.log(`${result.available ? '✓' : '○'} ${result.module}${result.error ? ` — ${result.error}` : ''}`);
      }
    });

  command
    .command('overview')
    .description('Aggregate the editorial queue, assets, blogs, performance and automations')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      const tasks = {
        editorial: caller.call('editorial', 'browse_editorial_library', { kind: 'pillars', limit: 10 }),
        media: caller.call('media', 'list_generated_media', { limit: 10 }),
        autoblog: caller.call('autoblog', 'list_autoblog_configs', {}),
        analytics: caller.call('analytics', 'get_publication_performance', { limit: 10 }),
        automations: caller.call('automation', 'list_automations', { includeRuns: true, limit: 10 }),
        queue: caller.call('core', 'get_analytics', {}),
      };
      const entries = await Promise.all(Object.entries(tasks).map(async ([name, task]) => {
        try { return [name, await task] as const; }
        catch (error) { return [name, { error: error instanceof Error ? error.message : String(error) }] as const; }
      }));
      print(Object.fromEntries(entries), options.json === true);
    });

  command
    .command('library <kind>')
    .description('Browse templates, styles, pillars or viral references')
    .option('--search <text>')
    .option('--limit <n>', 'Maximum results', positiveInteger, 20)
    .option('--json', 'Print structured JSON')
    .action(async (kind: string, options: { search?: string; limit: number; json?: boolean }) => {
      if (!['templates', 'styles', 'pillars', 'viral'].includes(kind)) {
        throw new InvalidArgumentError('kind must be templates, styles, pillars, or viral');
      }
      print(await caller.call('editorial', 'browse_editorial_library', {
        kind,
        limit: options.limit,
        ...(options.search ? { search: options.search } : {}),
      }), options.json === true);
    });

  command
    .command('transcribe <youtube-url>')
    .description('Extract a YouTube transcript for research or book-promotion inspiration')
    .option('--segments', 'Include timed segments')
    .option('-o, --output <file>', 'Write the transcript payload to a file')
    .action(async (url: string, options: { segments?: boolean; output?: string }) => {
      const result = await caller.call('media', 'transcribe_youtube', {
        url,
        includeSegments: options.segments === true,
      });
      const serialized = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, `${serialized}\n`, 'utf8');
        console.log(`Transcript written to ${options.output}`);
      } else console.log(serialized);
    });

  command
    .command('draft')
    .description('Create a guarded PubCommander draft directly from Code Buddy')
    .option('--content <text>')
    .option('--content-file <file>')
    .requiredOption('--platforms <csv>')
    .option('--hashtags <csv>')
    .option('--prompt <text>', 'Traceable source prompt')
    .action(async (options: {
      content?: string;
      contentFile?: string;
      platforms: string;
      hashtags?: string;
      prompt?: string;
    }) => {
      const content = options.contentFile ? fs.readFileSync(options.contentFile, 'utf8') : options.content;
      if (!content?.trim()) throw new InvalidArgumentError('--content or --content-file is required');
      print(await caller.call('core', 'create_draft_post', {
        content,
        platforms: csv(options.platforms),
        ...(options.hashtags ? { hashtags: csv(options.hashtags) } : {}),
        ...(options.prompt ? { originalPrompt: options.prompt } : {}),
      }));
    });

  command
    .command('submit <post-id>')
    .description('Send a draft to human approval; never self-approves or publishes')
    .action(async (postId: string) => {
      print(await caller.call('core', 'submit_post_for_approval', { postId }));
    });

  command
    .command('analytics')
    .description('Inspect real stored publication performance')
    .option('--post <id>')
    .option('--limit <n>', 'Maximum results', positiveInteger, 50)
    .option('--json', 'Print structured JSON')
    .action(async (options: { post?: string; limit: number; json?: boolean }) => {
      print(await caller.call('analytics', 'get_publication_performance', {
        limit: options.limit,
        ...(options.post ? { postId: options.post } : {}),
      }), options.json === true);
    });

  return command;
}
