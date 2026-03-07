import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChromeBridge } from '../../src/integrations/chrome-bridge.js';

describe('ChromeBridge stateful behavior', () => {
  beforeEach(() => {
    ChromeBridge.resetInstance();
  });

  afterEach(() => {
    ChromeBridge.resetInstance();
  });

  it('returns captured state from snapshots', async () => {
    const bridge = ChromeBridge.getInstance({ port: 9222 });
    await bridge.connect();

    bridge.ingestSnapshot({
      url: 'https://example.com',
      title: 'Example',
      consoleErrors: ['ReferenceError: boom'],
      networkRequests: [
        {
          url: 'https://example.com/api/items',
          method: 'GET',
          status: 200,
          type: 'xhr',
          timestamp: 123,
        },
      ],
      domState: {
        '#hero': {
          tagName: 'section',
          id: 'hero',
          textContent: 'Welcome',
          attributes: { role: 'banner' },
          children: 2,
        },
      },
    });

    expect(await bridge.getConsoleErrors()).toEqual(['ReferenceError: boom']);
    expect(await bridge.getNetworkRequests('api/items')).toHaveLength(1);
    expect(await bridge.getDOMState('#hero')).toEqual({
      tagName: 'section',
      id: 'hero',
      textContent: 'Welcome',
      attributes: { role: 'banner' },
      children: 2,
    });
  });

  it('executes scripts against the last captured snapshot', async () => {
    const bridge = ChromeBridge.getInstance();
    await bridge.connect();

    bridge.setPageInfo('https://example.com/products', 'Products');
    bridge.setDOMState('#hero', {
      tagName: 'div',
      id: 'hero',
      textContent: 'Featured',
      attributes: { class: 'hero' },
      children: 1,
    });

    const result = await bridge.executeScript(
      'document.title + " | " + document.querySelector("#hero")?.textContent + " | " + window.location.href'
    );

    expect(result).toBe('Products | Featured | https://example.com/products');
  });

  it('records actions ingested while recording is enabled', async () => {
    const bridge = ChromeBridge.getInstance();
    await bridge.connect();
    await bridge.startRecording();

    bridge.ingestMessage({
      type: 'action',
      payload: {
        type: 'click',
        target: '#submit',
        timestamp: 456,
      },
    });

    expect(bridge.getRecording()).toEqual([
      {
        type: 'click',
        target: '#submit',
        timestamp: 456,
      },
    ]);
  });
});
