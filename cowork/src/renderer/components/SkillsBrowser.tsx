/**
 * SkillsBrowser — Claude Cowork parity Phase 2
 *
 * Grid view over the SKILL.md registry (`src/skills/`) exposed via the
 * skillMd IPC namespace. Complements the existing SettingsSkills plugin
 * catalog with natural-language skills.
 *
 * @module renderer/components/SkillsBrowser
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { Sparkles, Search, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface SkillMdSummary {
  name: string;
  description: string;
  tier: string;
  filePath?: string;
  tags?: string[];
  requires?: string[];
}

const TIER_LABELS: Record<string, string> = {
  bundled: 'Bundled',
  managed: 'Managed',
  workspace: 'Workspace',
};

const TIER_COLORS: Record<string, string> = {
  bundled: 'bg-accent-muted text-accent border-accent/30',
  managed: 'bg-warning/20 text-warning border-warning/30',
  workspace: 'bg-success/20 text-success border-success/30',
};

export const SkillsBrowser: React.FC = () => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillMdSummary[]>([]);
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState('');
  const workingDir = useAppStore((state) => state.workingDir);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<{
    skillName: string;
    success: boolean;
    message: string;
  } | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.skillMd) {
        setSkills([]);
        return;
      }
      
      const [result, hubList] = await Promise.all([
        api.skillMd.list(),
        api.skillsHub?.list ? api.skillsHub.list() as Promise<Array<{ name: string; enabled?: boolean }>> : Promise.resolve([]),
      ]);
      
      setSkills(result as SkillMdSummary[]);
      
      const disabledSet = new Set<string>();
      if (hubList && Array.isArray(hubList)) {
        for (const item of hubList) {
          if (item.enabled === false) {
            disabledSet.add(item.name);
          }
        }
      }
      setDisabledSkills(disabledSet);
    } catch (err) {
      console.error('[SkillsBrowser] Failed to load skills:', err);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const filtered = useMemo(() => {
    if (!query.trim()) return skills;
    const lower = query.trim().toLowerCase();
    return skills.filter(
      (s) =>
         s.name.toLowerCase().includes(lower) ||
         s.description.toLowerCase().includes(lower) ||
         (s.tags ?? []).some((tag) => tag.toLowerCase().includes(lower))
    );
  }, [skills, query]);

  const handleToggle = useCallback(async (skill: SkillMdSummary, enabled: boolean) => {
    const api = window.electronAPI;
    if (!api?.skillsHub) return;
    try {
      await api.skillsHub.setEnabled(skill.name, enabled, undefined, skill.filePath);
      setDisabledSkills((prev) => {
        const next = new Set(prev);
        if (enabled) {
          next.delete(skill.name);
        } else {
          next.add(skill.name);
        }
        return next;
      });
    } catch (err) {
      console.error('[SkillsBrowser] Failed to toggle skill:', err);
    }
  }, []);

  const handleExecute = useCallback(async (skill: SkillMdSummary) => {
    const api = window.electronAPI;
    if (!api?.skillMd) return;
    setExecuting(skill.name);
    try {
      const result = await api.skillMd.execute(skill.name, { userInput: request.trim() || skill.description, workspaceRoot: workingDir || undefined });
      setLastResult({
        skillName: skill.name,
        success: result.success,
        message: result.output ?? result.error ?? '',
      });
    } catch (err) {
      setLastResult({
        skillName: skill.name,
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExecuting(null);
    }
  }, [request, workingDir]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border-muted bg-background/40">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {t('skillsBrowser.title')}
          </h3>
          <span className="ml-auto text-[10px] text-text-muted">
            {filtered.length} / {skills.length}
          </span>
        </div>

        <label className="block text-xs text-text-muted mb-3">
          {t('skillsBrowser.request', { defaultValue: 'What should this skill help you do?' })}
          <input value={request} onChange={(event) => setRequest(event.target.value)}
            className="mt-1 w-full px-3 py-2 bg-surface border border-border rounded text-text-primary"
            placeholder={t('skillsBrowser.requestPlaceholder', { defaultValue: 'Optional task — otherwise use the skill description' })} />
        </label>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('skillsBrowser.search')}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-xs text-text-muted text-center py-6">
            {skills.length === 0
              ? t('skillsBrowser.noSkills')
              : t('skillsBrowser.noMatches')}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map((skill) => {
              const isExecuting = executing === skill.name;
              const isEnabled = !disabledSkills.has(skill.name);
              return (
                <div
                  key={skill.name}
                  className={`p-3 rounded-lg border transition-all flex flex-col ${
                    isEnabled
                      ? 'bg-surface/40 border-border-muted hover:bg-surface-hover'
                      : 'bg-surface/10 border-border-muted/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold truncate flex-1 ${isEnabled ? 'text-text-primary' : 'text-text-muted line-through'}`}>
                      {skill.name}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border ${
                        TIER_COLORS[skill.tier] ??
                        'bg-surface-active text-text-secondary border-border'
                      }`}
                    >
                      {TIER_LABELS[skill.tier] ?? skill.tier}
                    </span>
                    {typeof window.electronAPI?.skillsHub?.setEnabled === 'function' && (
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => void handleToggle(skill, e.target.checked)}
                        className="w-3.5 h-3.5 shrink-0 accent-accent cursor-pointer rounded border-border"
                        title={isEnabled ? t('skillsBrowser.disable', 'Disable skill') : t('skillsBrowser.enable', 'Enable skill')}
                      />
                    )}
                  </div>
                  <p className="text-[11px] text-text-secondary line-clamp-2 mb-2 flex-1">
                    {skill.description}
                  </p>
                  {skill.tags && skill.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {skill.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => void handleExecute(skill)}
                    disabled={isExecuting}
                    className="mt-auto flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {isExecuting ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Play size={10} />
                    )}
                    {t('skillsBrowser.run')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {lastResult && (
          <div
            className={`mt-3 p-3 rounded-lg border text-xs flex items-start gap-2 ${
              lastResult.success
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-error/10 border-error/30 text-error'
            }`}
          >
            {lastResult.success ? (
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            ) : (
              <XCircle size={14} className="shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-mono font-semibold">{lastResult.skillName}</div>
              {lastResult.message && (
                <div className="mt-1 whitespace-pre-wrap break-words">
                  {lastResult.message}
                </div>
              )}
            </div>
            <button
              onClick={() => setLastResult(null)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
