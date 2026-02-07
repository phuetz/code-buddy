import { TypingIndicatorManager } from '../../src/presence/typing-indicator.js';

describe('TypingIndicatorManager', () => {
  let manager: TypingIndicatorManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new TypingIndicatorManager(4000);
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  it('should emit typing event immediately on startTyping', () => {
    const handler = jest.fn();
    manager.on('typing', handler);

    manager.startTyping('telegram', 'chat1');

    expect(handler).toHaveBeenCalledWith({ channel: 'telegram', chatId: 'chat1', typing: true });
  });

  it('should return session key in format channel:chatId', () => {
    const key = manager.startTyping('discord', 'room42');
    expect(key).toBe('discord:room42');
  });

  it('should return same key for duplicate startTyping on same channel:chatId', () => {
    const key1 = manager.startTyping('slack', 'ch1');
    const key2 = manager.startTyping('slack', 'ch1');
    expect(key1).toBe(key2);
  });

  it('should not emit duplicate typing event for same session', () => {
    const handler = jest.fn();
    manager.on('typing', handler);

    manager.startTyping('slack', 'ch1');
    manager.startTyping('slack', 'ch1');

    // Only 1 immediate emit, not 2
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should stop typing and emit typing:false', () => {
    const handler = jest.fn();
    manager.on('typing', handler);

    const key = manager.startTyping('telegram', 'chat1');
    handler.mockClear();

    manager.stopTyping(key);

    expect(handler).toHaveBeenCalledWith({ channel: 'telegram', chatId: 'chat1', typing: false });
  });

  it('should clear interval on stopTyping', () => {
    const key = manager.startTyping('terminal', 'local');
    const handler = jest.fn();
    manager.on('typing', handler);

    manager.stopTyping(key);
    handler.mockClear();

    jest.advanceTimersByTime(8000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop all sessions with stopAll', () => {
    manager.startTyping('telegram', 'a');
    manager.startTyping('discord', 'b');
    manager.startTyping('slack', 'c');

    expect(manager.getActiveCount()).toBe(3);

    manager.stopAll();

    expect(manager.getActiveCount()).toBe(0);
  });

  it('should set presence to busy when typing starts', () => {
    manager.startTyping('terminal', 'local');
    expect(manager.getPresence().status).toBe('busy');
  });

  it('should set presence to online when all typing stops', () => {
    const key = manager.startTyping('terminal', 'local');
    manager.stopTyping(key);
    expect(manager.getPresence().status).toBe('online');
  });

  it('should return correct active count', () => {
    expect(manager.getActiveCount()).toBe(0);
    manager.startTyping('telegram', '1');
    expect(manager.getActiveCount()).toBe(1);
    manager.startTyping('discord', '2');
    expect(manager.getActiveCount()).toBe(2);
  });

  it('should emit typing repeatedly at interval', () => {
    const handler = jest.fn();
    manager.on('typing', handler);

    manager.startTyping('telegram', 'chat1');
    expect(handler).toHaveBeenCalledTimes(1); // immediate

    jest.advanceTimersByTime(4000);
    expect(handler).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(4000);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should dispose and remove all listeners', () => {
    manager.startTyping('telegram', 'a');
    manager.startTyping('discord', 'b');

    manager.dispose();

    expect(manager.getActiveCount()).toBe(0);
    expect(manager.listenerCount('typing')).toBe(0);
    expect(manager.listenerCount('presence')).toBe(0);
  });

  it('should handle stopTyping with invalid key gracefully', () => {
    expect(() => manager.stopTyping('nonexistent:key')).not.toThrow();
  });

  it('should update presence with task', () => {
    manager.updatePresence('busy', 'processing query');
    const presence = manager.getPresence();
    expect(presence.status).toBe('busy');
    expect(presence.currentTask).toBe('processing query');
  });
});
