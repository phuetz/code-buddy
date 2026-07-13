import {
  buildBrowserOperatorSessionDraft,
  renderBrowserOperatorSessionDraft,
} from '../../src/browser-automation/browser-operator-session.js';
import { buildInternetScoutPlan } from '../../src/browser-automation/internet-scout-plan.js';

describe('buildBrowserOperatorSessionDraft', () => {
  it('builds an isolated public-browser draft without local consent', () => {
    const plan = buildInternetScoutPlan({
      goal: 'inspecter une page publique',
      sourceUrl: 'https://example.com',
    });

    const draft = buildBrowserOperatorSessionDraft(plan, {
      generatedAt: '2026-05-18T20:45:00.000Z',
    });

    expect(draft).toMatchObject({
      schemaVersion: 1,
      mode: 'isolated',
      sessionId: 'browser-operator-inspecter-une-page-publique-20260518204500',
      consent: {
        required: false,
        granted: false,
        scopes: [],
      },
      stopControl: {
        enabled: true,
        label: 'Stop browser operator',
      },
    });
    expect(draft.dedicatedTab.reason).toContain('isolated browser surface');
    expect(draft.actionLog.map((entry) => entry.id)).toEqual(['static-read', 'extract']);
    expect(draft.actionLog.every((entry) => entry.status === 'planned')).toBe(true);
    expect(draft.actionLog.every((entry) => entry.requiresConsent === false)).toBe(true);
    expect(draft.proofExport.includes).toContain('action log');
  });

  it('requires explicit consent for local browser sessions', () => {
    const plan = buildInternetScoutPlan({
      goal: 'verifier un espace client',
      sourceUrl: 'https://example.com/account',
      allowLoginPages: true,
    });

    const draft = buildBrowserOperatorSessionDraft(plan, {
      mode: 'local',
      consentGranted: true,
      grantedBy: 'operator',
      grantedAt: '2026-05-18T20:46:00.000Z',
      generatedAt: '2026-05-18T20:45:00.000Z',
    });

    expect(draft.consent).toMatchObject({
      required: true,
      granted: true,
      grantedBy: 'operator',
      grantedAt: '2026-05-18T20:46:00.000Z',
    });
    expect(draft.consent.scopes).toEqual([
      'local_browser',
      'public_web_read',
      'authenticated_tabs',
    ]);
    expect(draft.actionLog.filter((entry) => entry.requiresConsent).map((entry) => entry.id)).toEqual([
      'static-read',
      'extract',
    ]);
  });

  it('requires consent for interactive plans even in isolated mode', () => {
    const plan = buildInternetScoutPlan({
      goal: 'tester un formulaire',
      sourceUrl: 'https://example.com/form',
      requiresInteraction: true,
      expectedText: 'Merci',
    });

    const draft = buildBrowserOperatorSessionDraft(plan, {
      generatedAt: '2026-05-18T20:45:00.000Z',
    });

    expect(draft.consent.required).toBe(true);
    expect(draft.consent.scopes).toEqual(['browser_interaction']);
    expect(draft.actionLog.find((entry) => entry.id === 'interaction-plan')).toMatchObject({
      requiresConsent: true,
      expectedArtifact: 'browser-action-log.jsonl',
    });
    expect(draft.actionLog.find((entry) => entry.id === 'reviewed-interaction')).toMatchObject({
      action: 'act',
      requiresConsent: true,
      inputs: { instruction: 'tester un formulaire', maxActions: 1 },
    });
    expect(draft.actionLog.find((entry) => entry.id === 'assert')).toMatchObject({
      expectedArtifact: 'browser-assertion.json',
    });
  });

  it('renders a compact operator handoff', () => {
    const plan = buildInternetScoutPlan({
      goal: 'verifier PostCommander',
      expectedText: 'PostCommander',
    });
    const draft = buildBrowserOperatorSessionDraft(plan, {
      mode: 'local',
      generatedAt: '2026-05-18T20:45:00.000Z',
    });

    const rendered = renderBrowserOperatorSessionDraft(draft);

    expect(rendered).toContain('# Browser Operator Session: verifier PostCommander');
    expect(rendered).toContain('Consent: required');
    expect(rendered).toContain('browser.assert_text');
    expect(rendered).toContain('Proof export: browser-operator-verifier-postcommander-20260518204500.browser-operator.json');
  });
});
