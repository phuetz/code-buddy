/**
 * ModelSwitcher — Dropdown for quick model selection in the chat header
 */
import { ANTHROPIC_MODELS } from '../../shared/anthropic-models';
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';

interface ModelSwitcherProps {
  currentModel: string;
  onModelChange: (model: string) => void;
}

const POPULAR_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', provider: 'Google' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'grok-3-mini-fast', label: 'Grok 3 Mini Fast', provider: 'xAI' },
  { id: 'grok-3-mini', label: 'Grok 3 Mini', provider: 'xAI' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xAI' },
  ...ANTHROPIC_MODELS.map((id) => ({ id, label: id, provider: 'Anthropic' })),
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'o3-mini', label: 'o3-mini', provider: 'OpenAI' },
];

export const ModelSwitcher: React.FC<ModelSwitcherProps> = ({ currentModel, onModelChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayName = currentModel.length > 25 ? currentModel.slice(0, 22) + '...' : currentModel;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground bg-surface hover:bg-surface-hover hover:text-secondary transition-colors"
        title={`Model: ${currentModel}`}
      >
        <Cpu size={12} />
        <span className="font-mono">{displayName}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto">
          {POPULAR_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onModelChange(model.id);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-hover transition-colors ${
                model.id === currentModel ? 'bg-zinc-700/50' : ''
              }`}
            >
              <div>
                <div className="text-xs font-medium text-secondary">{model.label}</div>
                <div className="text-xs text-muted-foreground">{model.provider}</div>
              </div>
              {model.id === currentModel && (
                <span className="text-xs text-green-400">\u2713</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
