/**
 * YoloModeToggle — P2.3
 *
 * Compact YOLO toggle for the title bar. When ON:
 *   - Permission mode switches to `bypassPermissions`
 *   - A budget cap is applied (configured via the dialog)
 *
 * When OFF: permission mode returns to the previous value (default if unset).
 *
 * Persists via config.save({ yoloMode, yoloMaxCostUsd, yoloMaxRounds }).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../store';
import { DEFAULT_YOLO_SESSION_COST_USD, YOLO_SESSION_COST_HARD_CAP_USD } from '../../../../src/config/session-cost-defaults.js';

export function YoloModeToggle() {
  const { t } = useTranslation();
  const [yoloOn, setYoloOn] = useState(false);
  const [maxCost, setMaxCost] = useState(DEFAULT_YOLO_SESSION_COST_USD);
  const [maxRounds, setMaxRounds] = useState(400);
  const [showConfig, setShowConfig] = useState(false);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const previousMode = useRef(permissionMode);

  useEffect(() => {
    const api = window.electronAPI?.config?.get;
    if (!api) return;
    let cancelled = false;
    api().then((cfg) => {
      if (cancelled) return;
      const c = cfg as { yoloMode?: boolean; yoloMaxCostUsd?: number; yoloMaxRounds?: number };
      if (c.yoloMode) setYoloOn(true);
      if (typeof c.yoloMaxCostUsd === 'number' && Number.isFinite(c.yoloMaxCostUsd) && c.yoloMaxCostUsd >= 0) setMaxCost(Math.min(c.yoloMaxCostUsd, YOLO_SESSION_COST_HARD_CAP_USD));
      if (typeof c.yoloMaxRounds === 'number') setMaxRounds(c.yoloMaxRounds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: { yoloMode?: boolean; yoloMaxCostUsd?: number; yoloMaxRounds?: number }) => {
    const save = window.electronAPI?.config?.save;
    if (!save) return;
    try {
      await save(next as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  };

  const handleToggle = async () => {
    if (yoloOn) {
      // turning OFF — restore previous permission mode if it was set by us
      setYoloOn(false);
      const restore = previousMode.current === 'bypassPermissions' ? 'default' : previousMode.current;
      setPermissionMode(restore);
      window.electronAPI?.permission?.setMode(restore);
      await persist({ yoloMode: false });
    } else {
      // turning ON — capture current mode, switch to bypassPermissions
      const budget = Number.isFinite(maxCost)
        ? Math.min(Math.max(0, maxCost), YOLO_SESSION_COST_HARD_CAP_USD)
        : DEFAULT_YOLO_SESSION_COST_USD;
      setMaxCost(budget);
      previousMode.current = permissionMode;
      setYoloOn(true);
      setPermissionMode('bypassPermissions');
      window.electronAPI?.permission?.setMode('bypassPermissions');
      await persist({ yoloMode: true, yoloMaxCostUsd: budget, yoloMaxRounds: maxRounds });
    }
  };

  const handleSaveBudget = async () => {
    const budget = Number.isFinite(maxCost)
      ? Math.min(Math.max(0, maxCost), YOLO_SESSION_COST_HARD_CAP_USD)
      : DEFAULT_YOLO_SESSION_COST_USD;
    setMaxCost(budget);
    await persist({ yoloMaxCostUsd: budget, yoloMaxRounds: maxRounds });
    setShowConfig(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowConfig((v) => !v);
        }}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
          yoloOn
            ? 'bg-error/15 text-error border border-error/30 animate-pulse'
            : 'text-text-muted hover:bg-surface-hover border border-transparent'
        }`}
        title={
          yoloOn
            ? t('yolo.activeTitle', `YOLO active — auto-approving everything (cap: $${maxCost})`, {
                cap: maxCost,
              })
            : t('yolo.inactiveTitle', 'Click to enable YOLO mode (right-click for budget)')
        }
        data-testid="yolo-toggle"
      >
        {yoloOn ? <ShieldAlert size={12} /> : <Zap size={12} />}
        <span className="font-medium uppercase tracking-wide text-[10px]">YOLO</span>
        {yoloOn && <span className="text-[10px]">${maxCost}</span>}
      </button>
      {showConfig && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-xl p-3 w-64">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">{t('yolo.budgetTitle', 'YOLO budget')}</span>
            <button
              type="button"
              onClick={() => setShowConfig(false)}
              className="w-5 h-5 rounded hover:bg-surface-hover flex items-center justify-center"
            >
              <X size={12} />
            </button>
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] text-text-secondary">
              {t('yolo.maxCostLabel', 'Max session cost (USD)')}
              <input
                type="number"
                value={maxCost}
                onChange={(e) => setMaxCost(Number(e.target.value))}
                min={1}
                max={YOLO_SESSION_COST_HARD_CAP_USD}
                step={1}
                className="mt-0.5 w-full px-2 py-1 text-xs rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
                data-testid="yolo-max-cost"
              />
            </label>
            <label className="block text-[11px] text-text-secondary">
              {t('yolo.maxRoundsLabel', 'Max tool rounds')}
              <input
                type="number"
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
                min={10}
                max={400}
                step={10}
                className="mt-0.5 w-full px-2 py-1 text-xs rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
                data-testid="yolo-max-rounds"
              />
            </label>
            <button
              type="button"
              onClick={handleSaveBudget}
              className="w-full px-2.5 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover"
            >
              {t('common.save', 'Save')}
            </button>
          </div>
          <p className="text-[10px] text-text-muted mt-2 italic">
            {t(
              'yolo.warning',
              'YOLO bypasses all permission prompts. Use with care — set a budget cap.'
            )}
          </p>
        </div>
      )}
    </div>
  );
}
