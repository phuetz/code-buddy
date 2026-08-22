/**
 * dev-plan — real test (no mocks): derive a development plan from an app prompt
 * (stack detection, feature steps, theme, always-present scaffold/run bookends).
 */
import { describe, expect, it } from 'vitest';
import { buildDevPlan, advancePlan, parsePlanBlock, stripPlanBlocks, latestLlmPlan } from '../src/renderer/components/studio/dev-plan';

describe('buildDevPlan', () => {
  it('detects React by default and brackets the plan with scaffold + verify', () => {
    const plan = buildDevPlan('Une todo app avec thème sombre');
    expect(plan.stack).toBe('React + Vite');
    expect(plan.steps[0]!.id).toBe('scaffold');
    expect(plan.steps[plan.steps.length - 1]!.id).toBe('verify'); // Code Buddy web_test
    expect(plan.steps.some((s) => s.id === 'run')).toBe(true);
    expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('extracts features and a dark-theme step', () => {
    const plan = buildDevPlan('Un dashboard Next.js avec des graphiques et un thème sombre');
    expect(plan.stack).toBe('Next.js');
    const titles = plan.steps.map((s) => s.title);
    expect(titles.some((t) => /Dashboard/.test(t))).toBe(true);
    expect(titles.some((t) => /Charts/.test(t))).toBe(true);
    expect(plan.steps.some((s) => s.id === 'theme-dark')).toBe(true);
  });

  it('falls back to a core UI step when no known feature is named', () => {
    const plan = buildDevPlan('quelque chose de joli');
    expect(plan.steps.some((s) => s.id === 'feat-core')).toBe(true);
  });

  it('derives a readable title and never returns empty for a blank prompt', () => {
    expect(buildDevPlan('').title).toBe('New app');
    expect(buildDevPlan('Todo app pro. Avec du style').title).toBe('Todo app pro');
  });

  it('does not duplicate a feature mentioned twice', () => {
    const plan = buildDevPlan('un formulaire et encore un formulaire');
    const formSteps = plan.steps.filter((s) => /Form/.test(s.title));
    expect(formSteps).toHaveLength(1);
  });
});

describe('advancePlan', () => {
  const base = buildDevPlan('Une todo app avec thème sombre');

  it('marks scaffold active while building an empty project', () => {
    const p = advancePlan(base, { hasFiles: false, previewRunning: false, busy: true });
    expect(p.steps.find((s) => s.id === 'scaffold')!.status).toBe('active');
  });

  it('marks scaffold done and the next step active once files exist', () => {
    const p = advancePlan(base, { hasFiles: true, previewRunning: false, busy: true });
    expect(p.steps.find((s) => s.id === 'scaffold')!.status).toBe('done');
    expect(p.steps.some((s) => s.status === 'active')).toBe(true);
  });

  it('completes every step up to run once the preview is running, verify becomes active', () => {
    const p = advancePlan(base, { hasFiles: true, previewRunning: true, busy: false });
    expect(p.steps.filter((s) => s.id !== 'verify').every((s) => s.status === 'done')).toBe(true);
    expect(p.steps.find((s) => s.id === 'verify')!.status).toBe('active');
  });

  it('marks a feature step done when a changed path matches its keywords', () => {
    // base = "todo app avec thème sombre" → has a todo feature + theme-dark step
    const p = advancePlan(base, {
      hasFiles: true,
      previewRunning: false,
      busy: true,
      changedPaths: ['src/components/ThemeToggle.tsx', 'src/TodoList.tsx'],
    });
    expect(p.steps.find((s) => s.id === 'theme-dark')!.status).toBe('done');
    const todo = p.steps.find((s) => /Task list/i.test(s.title));
    expect(todo?.status).toBe('done');
  });

  it('is pure — does not mutate the input plan', () => {
    advancePlan(base, { hasFiles: true, previewRunning: true, busy: false });
    expect(base.steps.every((s) => s.status === 'pending')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LLM plan (```plan block emitted by the agent, parsed by parsePlanBlock)
// ---------------------------------------------------------------------------

describe('parsePlanBlock', () => {
  const block = (json: string) => 'Voici le plan :\n```plan\n' + json + '\n```\nJe construis maintenant.';

  it('parses a real agent-emitted plan and normalizes anchors', () => {
    const plan = parsePlanBlock(
      block(
        JSON.stringify({
          title: 'Pomodoro néon',
          stack: 'HTML/CSS/JS',
          steps: [
            { id: 'scaffold', title: 'Créer la structure' },
            { id: 'timer-core', title: 'Minuteur 25/5', detail: 'start/pause/reset', match: ['timer'] },
            { id: 'stats', title: 'Statistiques de sessions', match: ['stats', 'chart'] },
          ],
        }),
      ),
    )!;
    expect(plan.title).toBe('Pomodoro néon');
    expect(plan.stack).toBe('HTML/CSS/JS');
    expect(plan.steps.map((s) => s.id)).toEqual(['scaffold', 'timer-core', 'stats', 'run', 'verify']);
    expect(plan.steps[1]!.match).toEqual(['timer']);
    expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('anchors the first step as scaffold when the agent forgot the id', () => {
    const plan = parsePlanBlock(block('{"title":"App","steps":[{"title":"Créer les fichiers"},{"title":"Filtres"}]}'))!;
    expect(plan.steps[0]!.id).toBe('scaffold');
    expect(plan.steps.some((s) => s.id === 'run')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'verify')).toBe(true);
  });

  it('rejects malformed blocks (bad JSON, missing steps, no block)', () => {
    expect(parsePlanBlock(block('{not json'))).toBeNull();
    expect(parsePlanBlock(block('{"title":"x","steps":[]}'))).toBeNull();
    expect(parsePlanBlock(block('{"steps":[{"title":"a"}]}'))).toBeNull();
    expect(parsePlanBlock('Pas de plan ici.')).toBeNull();
  });

  it('feeds advancePlan like a deterministic plan (match keywords complete steps)', () => {
    const plan = parsePlanBlock(block('{"title":"Todo","steps":[{"title":"Structure"},{"id":"filtres","title":"Filtres","match":["filter"]}]}'))!;
    const advanced = advancePlan(plan, { hasFiles: true, previewRunning: false, busy: false, changedPaths: ['src/filter-bar.js'] });
    expect(advanced.steps.find((s) => s.id === 'scaffold')!.status).toBe('done');
    expect(advanced.steps.find((s) => s.id === 'filtres')!.status).toBe('done');
  });
});

describe('stripPlanBlocks', () => {
  it('removes the plan block from the visible reply', () => {
    const text = 'Je commence.\n```plan\n{"title":"x","steps":[{"title":"a"}]}\n```\nEt voilà le reste.';
    expect(stripPlanBlocks(text)).toBe('Je commence.\n\nEt voilà le reste.');
    expect(stripPlanBlocks('Rien à retirer.')).toBe('Rien à retirer.');
  });
});

describe('latestLlmPlan', () => {
  const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
  const planText = (title: string) => '```plan\n{"title":"' + title + '","steps":[{"title":"Structure"}]}\n```';

  it('prefers the streaming partial, else the newest assistant plan', () => {
    const messages = [msg('assistant', planText('Ancien')), msg('user', 'continue'), msg('assistant', planText('Récent'))];
    expect(latestLlmPlan(messages)!.title).toBe('Récent');
    expect(latestLlmPlan(messages, planText('Live'))!.title).toBe('Live');
  });

  it('returns null when no assistant message carries a plan', () => {
    expect(latestLlmPlan([msg('assistant', 'Bonjour'), msg('user', 'salut')])).toBeNull();
    expect(latestLlmPlan([])).toBeNull();
  });
});
