import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface TerminalPaneProps {
  output: string[];
  onInput?: (line: string) => void;
  onClear?: () => void;
}

export function TerminalPane({ output, onInput, onClear }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenLinesRef = useRef(0);
  const onInputRef = useRef(onInput);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: !prefersReducedMotion,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#111318',
        foreground: '#e5e7eb',
        cursor: '#f9fafb',
        selectionBackground: '#334155',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();

    let inputBuffer = '';
    const dataDisposable = terminal.onData((data) => {
      if (!onInputRef.current) return;
      for (const char of data) {
        if (char === '\r') {
          const line = inputBuffer;
          inputBuffer = '';
          terminal.write('\r\n');
          onInputRef.current(line);
        } else if (char === '\u007F') {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            terminal.write('\b \b');
          }
        } else if (char >= ' ') {
          inputBuffer += char;
          terminal.write(char);
        }
      }
    });

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (output.length < writtenLinesRef.current) {
      terminal.clear();
      writtenLinesRef.current = 0;
    }
    for (const line of output.slice(writtenLinesRef.current)) {
      terminal.writeln(line);
    }
    writtenLinesRef.current = output.length;
  }, [output]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-surface">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted px-3">
        <span className="text-xs font-medium text-muted-foreground">Terminal</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground"
            title="Effacer"
            aria-label="Effacer le terminal"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      <div ref={hostRef} className="min-h-0 flex-1 bg-background p-2" />
    </section>
  );
}
