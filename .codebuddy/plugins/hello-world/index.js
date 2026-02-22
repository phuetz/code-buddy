export default class HelloWorldPlugin {
  activate(context) {
    context.logger.info('Hello World plugin activated!');

    // Register a slash command (prefixed with plugin ID)
    context.registerCommand({
      name: 'hello-world:hello',
      description: 'Say hello',
      prompt: 'Say hello to the user in a friendly way.',
      filePath: '',
      isBuiltin: false
    });

    // Register a tool (prefixed with plugin ID)
    // Note: the factory function stays in the worker — only serializable metadata crosses to the main thread.
    context.registerTool({
      name: 'hello-world:say_hello',
      description: 'Returns a hello message',
      factory: () => ({
        name: 'hello-world:say_hello',
        description: 'Returns a hello message',
        execute: async ({ name }) => {
          return {
            success: true,
            output: `Hello ${name || 'World'} from the plugin!`
          };
        }
      }),
      defaultPermission: 'always',
      defaultTimeout: 5,
      readOnly: true
    });
  }

  deactivate() {
    console.log('Hello World plugin deactivated');
  }
}
