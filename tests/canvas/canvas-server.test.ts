import { CanvasServer, CanvasContent } from '../../src/canvas/canvas-server.js';

describe('CanvasServer', () => {
  let server: CanvasServer;

  beforeEach(() => {
    server = new CanvasServer();
  });

  it('should set default port and maxHistory', () => {
    expect(server.isRunning()).toBe(false);
    expect(server.getClientCount()).toBe(0);
    expect(server.getHistory()).toEqual([]);
  });

  it('should accept custom port and maxHistory', () => {
    const custom = new CanvasServer(4000, 10);
    expect(custom.isRunning()).toBe(false);
  });

  it('should add entries to history on push', () => {
    server.push({ type: 'html', content: '<p>Hello</p>', title: 'Test' });
    const history = server.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe('html');
    expect(history[0].content).toBe('<p>Hello</p>');
    expect(history[0].title).toBe('Test');
    expect(typeof history[0].timestamp).toBe('number');
  });

  it('should trim history to maxHistory', () => {
    const small = new CanvasServer(3100, 3);
    for (let i = 0; i < 5; i++) {
      small.push({ type: 'html', content: `Entry ${i}` });
    }
    const history = small.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].content).toBe('Entry 2');
    expect(history[2].content).toBe('Entry 4');
  });

  it('should clear history on reset', () => {
    server.push({ type: 'html', content: 'test' });
    server.push({ type: 'markdown', content: '# test' });
    expect(server.getHistory()).toHaveLength(2);

    server.reset();
    expect(server.getHistory()).toEqual([]);
  });

  it('should return a copy of history', () => {
    server.push({ type: 'json', content: '{"a":1}' });
    const h1 = server.getHistory();
    const h2 = server.getHistory();
    expect(h1).toEqual(h2);
    expect(h1).not.toBe(h2);
  });

  it('should return 0 client count initially', () => {
    expect(server.getClientCount()).toBe(0);
  });

  it('should return false for isRunning before start', () => {
    expect(server.isRunning()).toBe(false);
  });

  it('should emit push event on push', () => {
    const handler = jest.fn();
    server.on('push', handler);
    server.push({ type: 'html', content: 'test' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].content).toBe('test');
  });

  it('should emit reset event on reset', () => {
    const handler = jest.fn();
    server.on('reset', handler);
    server.reset();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle push with all content types', () => {
    server.push({ type: 'html', content: '<b>bold</b>' });
    server.push({ type: 'markdown', content: '# Heading' });
    server.push({ type: 'json', content: '{"key":"value"}' });

    const history = server.getHistory();
    expect(history).toHaveLength(3);
    expect(history.map(h => h.type)).toEqual(['html', 'markdown', 'json']);
  });
});
