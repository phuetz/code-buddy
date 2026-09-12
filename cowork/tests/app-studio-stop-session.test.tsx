/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioChatPanel } from '../src/renderer/components/studio-iterate/StudioChatPanel';
import { AppStudioView } from '../src/renderer/components/studio/AppStudioView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('B1: App Studio Stop button wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Stop button when busy is true in StudioChatPanel and triggers onStop callback on click', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();

    act(() => {
      root.render(
        <StudioChatPanel
          messages={[{ id: '1', role: 'user', text: 'Generate an app' }]}
          busy={true}
          onSend={onSend}
          onStop={onStop}
        />
      );
    });

    const stopButton = container.querySelector('[data-testid="studio-chat-stop"]');
    expect(stopButton).toBeTruthy();
    expect(stopButton?.textContent).toContain('Stop');

    act(() => {
      Simulate.click(stopButton!);
    });

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('transmits chat.onStop from AppStudioView to StudioChatPanel and triggers onStop', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();

    act(() => {
      root.render(
        <AppStudioView
          tree={[]}
          activeFile={null}
          fileContent=""
          previewUrl={null}
          previewStatus="idle"
          terminalOutput={[]}
          buildPhase="running"
          buildElapsedMs={1200}
          templates={[]}
          chat={{
            messages: [{ id: '1', role: 'user', text: 'Build dashboard' }],
            busy: true,
            onSend,
            onStop,
          }}
          onScaffold={() => {}}
          onPrompt={() => {}}
          onOpenFile={() => {}}
          onChangeFileContent={() => {}}
          onSaveFile={() => {}}
          onStartPreview={() => {}}
          onReloadPreview={() => {}}
          onStopBuild={() => {}}
        />
      );
    });

    const stopButton = container.querySelector('[data-testid="studio-chat-stop"]');
    expect(stopButton).toBeTruthy();

    act(() => {
      Simulate.click(stopButton!);
    });

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
