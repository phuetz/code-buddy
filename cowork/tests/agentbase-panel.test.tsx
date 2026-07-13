/** @vitest-environment happy-dom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentBasePanel } from '../src/renderer/components/settings/AgentBasePanel';

const connector = {
  id: 'notion',
  name: 'Notion',
  category: 'productivity',
  source: 'configured' as const,
  installed: true,
  enabled: true,
  status: 'connected' as const,
  auth: { mode: 'oauth' as const, configured: true, detail: 'OAuth session stored' },
  permissions: { read: true, write: false, external: false },
  tools: [{ name: 'list_pages', permission: 'read' as const }],
};

const api = {
  list: vi.fn(async () => [connector, {
    ...connector,
    id: 'catalog:slack',
    name: 'Slack',
    source: 'marketplace' as const,
    installed: false,
    enabled: false,
    status: 'available' as const,
    tools: [],
  }]),
  setPermissions: vi.fn(async () => ({ read: true, write: true, external: false })),
  audit: vi.fn(async () => []),
  discoverCodeBuddy: vi.fn(async () => ({
    ok: true,
    warnings: [],
    candidates: [{
      id: 'codebuddy-mcp:abc',
      name: 'PubCommander',
      source: 'project' as const,
      transport: 'stdio' as const,
      command: 'node',
      args: ['/workspace/pubcommander.js'],
      envKeys: ['LOG_LEVEL', 'API_TOKEN'],
      secretEnvKeys: ['API_TOKEN'],
      enabledInSource: true,
      alreadyConfigured: false,
      importable: true,
    }],
  })),
  importCodeBuddy: vi.fn(async () => ({
    ok: true,
    imported: { id: 'pubcommander', name: 'PubCommander', enabled: false as const },
  })),
};

describe('AgentBasePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = { agentBase: api };
  });

  afterEach(cleanup);

  it('shows real connector, auth and catalog counts', async () => {
    render(<AgentBasePanel isActive />);
    expect(await screen.findByText('Notion')).toBeTruthy();
    expect(screen.getByText('oauth ✓')).toBeTruthy();
    expect(screen.getByText('1 outils')).toBeTruthy();
    expect(screen.getByText('Catalogue').previousElementSibling?.textContent).toBe('1');
  });

  it('persists a narrow permission change', async () => {
    render(<AgentBasePanel isActive />);
    const toggle = await screen.findByTestId('agentbase-permission-notion-write');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setPermissions).toHaveBeenCalledWith('notion', { write: true }));
    expect(toggle.textContent).toContain('autorisée');
  });

  it('imports a reviewed Code Buddy connector disabled and never renders secret values', async () => {
    render(<AgentBasePanel isActive />);
    expect(await screen.findByText('PubCommander')).toBeTruthy();
    expect(screen.getByText(/Variables héritées sans copie : API_TOKEN/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret-value');
    fireEvent.click(screen.getByRole('button', { name: 'Importer désactivé' }));
    await waitFor(() => expect(api.importCodeBuddy).toHaveBeenCalledWith('codebuddy-mcp:abc'));
  });
});
