export interface StudioWiring {
  mainServices: { file: string; registerFn: string; channels: string[] }[];
  preloadNamespace: {
    name: 'studio';
    methods: { key: string; channel: string; kind: 'invoke' | 'on' }[];
  };
  primaryView: { id: 'studio'; label: string; component: string };
  apiContract: string;
  notes: string[];
}

export const APP_STUDIO_WIRING: StudioWiring = {
  mainServices: [
    {
      file: 'cowork/src/main/studio/dev-server-ipc.ts',
      registerFn: 'registerDevServerIpc',
      channels: [
        'studio.dev.start',
        'studio.dev.stop',
        'studio.dev.status',
        'studio.dev.logs',
        'studio.dev.log',
      ],
    },
    {
      file: 'cowork/src/main/studio/studio-files-ipc.ts',
      registerFn: 'registerStudioFilesIpc',
      channels: [
        'studio.files.read',
        'studio.files.write',
        'studio.files.list',
        'studio.files.create',
        'studio.files.rename',
        'studio.files.delete',
      ],
    },
    {
      file: 'cowork/src/main/studio/command-runner-ipc.ts',
      registerFn: 'registerCommandRunnerIpc',
      channels: [
        'studio.cmd.run',
        'studio.cmd.kill',
        'studio.cmd.output',
      ],
    },
    {
      file: 'cowork/src/main/studio/scaffold-ipc.ts',
      registerFn: 'registerScaffoldIpc',
      channels: [
        'studio.scaffold.list',
        'studio.scaffold.generate',
      ],
    },
  ],
  preloadNamespace: {
    name: 'studio',
    methods: [
      { key: 'devServer.start', channel: 'studio.dev.start', kind: 'invoke' },
      { key: 'devServer.stop', channel: 'studio.dev.stop', kind: 'invoke' },
      { key: 'devServer.status', channel: 'studio.dev.status', kind: 'invoke' },
      { key: 'devServer.logs', channel: 'studio.dev.logs', kind: 'invoke' },
      { key: 'devServer.onLog', channel: 'studio.dev.log', kind: 'on' },
      { key: 'files.read', channel: 'studio.files.read', kind: 'invoke' },
      { key: 'files.write', channel: 'studio.files.write', kind: 'invoke' },
      { key: 'files.list', channel: 'studio.files.list', kind: 'invoke' },
      { key: 'files.create', channel: 'studio.files.create', kind: 'invoke' },
      { key: 'files.rename', channel: 'studio.files.rename', kind: 'invoke' },
      { key: 'files.delete', channel: 'studio.files.delete', kind: 'invoke' },
      { key: 'commands.run', channel: 'studio.cmd.run', kind: 'invoke' },
      { key: 'commands.kill', channel: 'studio.cmd.kill', kind: 'invoke' },
      { key: 'commands.onOutput', channel: 'studio.cmd.output', kind: 'on' },
      { key: 'scaffold.list', channel: 'studio.scaffold.list', kind: 'invoke' },
      { key: 'scaffold.generate', channel: 'studio.scaffold.generate', kind: 'invoke' },
    ],
  },
  primaryView: {
    id: 'studio',
    label: 'App Studio',
    component: 'cowork/src/renderer/components/studio/AppStudioView.tsx',
  },
  apiContract: 'cowork/src/renderer/components/studio/studio-api.ts',
  notes: [
    'Main: instantiate StudioDevServer, CommandRunner, and ScaffoldService, then call the listed register*Ipc functions from the existing composition root.',
    'Preload: expose window.electronAPI.studio methods matching studio-api.ts; keep invoke/on shapes aligned with the channel list above.',
    'Renderer: mount AppStudioView in NewShell with useAppStudio({ apis: window.electronAPI.studio, projectRoot }).',
    'Writes must still pass a user confirmation gate before files.write/create/rename/delete are invoked.',
    'All file operations require an explicit project root and are confined by safeJoin; do not pass arbitrary absolute paths from the renderer.',
    'CommandRunner is not a PTY or sandbox; bound cwd to the active project and add core command validation if user-entered commands are enabled.',
    'Dev server preview must come from app_server only; PreviewPane will refuse non-loopback URLs and uses sandbox=\"allow-scripts allow-same-origin\".',
    'Stop/death states from app_server should be reflected by refreshing devServer.status and clearing or marking previewStatus as dead.',
  ],
};
