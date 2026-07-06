import { KeyboardEvent, useEffect, useState } from 'react';
import { navigate } from './terminal-input-model';

export interface TerminalInputProps {
  onRun: (cmd: string) => void;
  busy?: boolean;
  history: string[];
}

export function TerminalInput({ onRun, busy = false, history }: TerminalInputProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(history.length);

  useEffect(() => {
    setCursor(history.length);
  }, [history]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = value.trim();
      if (!command || busy) return;
      onRun(command);
      setValue('');
      setCursor(history.length);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = navigate(history, cursor, event.key === 'ArrowUp' ? 'up' : 'down');
      setCursor(next.cursor);
      setValue(next.value);
    }
  }

  return (
    <label className="flex items-center gap-2 border-t border-border bg-surface px-3 py-2 font-mono text-sm text-foreground">
      <span className="text-muted-foreground" aria-hidden="true">
        $
      </span>
      <input
        data-testid="terminal-input"
        type="text"
        value={value}
        disabled={busy}
        onChange={(event) => {
          setValue(event.target.value);
          setCursor(history.length);
        }}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 border-0 bg-surface font-mono text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        placeholder={busy ? 'Commande en cours…' : 'Tape une commande'}
        aria-label="Commande terminal"
      />
    </label>
  );
}

export default TerminalInput;
