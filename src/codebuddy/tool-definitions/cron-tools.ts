import type { CodeBuddyTool } from './types.js';

export const CRONJOB_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'cronjob',
    description:
      'Manage Code Buddy scheduled jobs through the real CronScheduler store: list, show, create, pause, resume, run, or remove jobs. Create message (agent), watchdog, no-agent script (command), or skill jobs, and chain jobs via then.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'show', 'create', 'pause', 'resume', 'run', 'remove'],
          description: 'Cron job action to perform.',
        },
        id: {
          type: 'string',
          description: 'Job id or unique id prefix for show, pause, resume, run, or remove.',
        },
        name: {
          type: 'string',
          description: 'Job name when creating a job.',
        },
        every: {
          type: 'number',
          description: 'Create an interval job that runs every N milliseconds.',
        },
        cron: {
          type: 'string',
          description: 'Create a cron-expression job using a 5-field cron expression.',
        },
        at: {
          type: 'string',
          description: 'Create a one-shot job for an ISO 8601 timestamp.',
        },
        message: {
          type: 'string',
          description: 'Agent message task for create. Provide exactly one of message, watchdog, command, or skill.',
        },
        watchdog: {
          type: 'object',
          description: 'No-LLM watchdog task config for create, for example disk/http/repo/build checks.',
        },
        command: {
          type: 'object',
          description:
            'No-agent script task for create: { executable, args?, cwd?, allowedExecutables?, timeoutMs? }. Runs an allowlisted command without an LLM.',
          properties: {
            executable: { type: 'string', description: 'Allowlisted executable to run (no shell).' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
            cwd: { type: 'string', description: 'Working directory.' },
            allowedExecutables: {
              type: 'array',
              items: { type: 'string' },
              description: 'Extra allowed executables (basename match), merged with defaults.',
            },
            timeoutMs: { type: 'number', description: 'Command timeout in ms (clamped to [100, 600000]).' },
          },
          required: ['executable'],
        },
        skill: {
          type: 'string',
          description: 'No-agent skill task for create: name of a registered skill to run without an LLM.',
        },
        skillRequest: {
          type: 'string',
          description: 'Optional request string passed to the skill executor when using skill.',
        },
        then: {
          type: 'string',
          description: 'Chain target: job id (or unique id prefix) to run on successful completion of this job.',
        },
        continuity: {
          type: 'object',
          description: 'Opt-in per-job memory: {enabled: true, notes: {key: value}}. Bounded notes and the last successful output persist across runs. Default off.',
          properties: { enabled: { type: 'boolean' }, notes: { type: 'object', additionalProperties: { type: 'string' } } },
          additionalProperties: false,
        },
        preCheck: {
          type: 'object',
          description: 'Optional file_changed or command pre-check gate for create.',
        },
        deliver: {
          type: 'array',
          description: 'Optional delivery targets such as telegram:123 or discord:channel.',
          items: {
            type: 'string',
            description: 'Delivery target in type:id form.',
          },
        },
        format: {
          type: 'string',
          enum: ['full', 'summary'],
          description: 'Optional delivery body format for created jobs.',
        },
      },
      required: ['action'],
    },
  },
};

export const CRON_TOOLS = [CRONJOB_TOOL];
