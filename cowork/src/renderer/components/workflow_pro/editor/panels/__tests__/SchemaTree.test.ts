// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import SchemaTree, { buildPath } from '../SchemaTree';

describe('SchemaTree.buildPath — Vague 2 gap U2', () => {
  it('uses dot notation for valid identifiers', () => {
    expect(buildPath('$json', 'email')).toBe('$json.email');
    expect(buildPath('$json.user', 'firstName')).toBe('$json.user.firstName');
  });

  it('uses bracket notation for keys with special characters', () => {
    expect(buildPath('$json', 'first name')).toBe('$json["first name"]');
    expect(buildPath('$json', 'has-dash')).toBe('$json["has-dash"]');
    expect(buildPath('$json', '123digit')).toBe('$json["123digit"]');
  });

  it('escapes embedded double quotes in bracket notation', () => {
    expect(buildPath('$json', 'a"b')).toBe('$json["a\\"b"]');
  });

  it('handles array indices with bracket notation', () => {
    expect(buildPath('$json.items', 0)).toBe('$json.items[0]');
    expect(buildPath('$json', 5)).toBe('$json[5]');
  });

  it('round-trips through deep nesting', () => {
    let p = '$json';
    p = buildPath(p, 'user');
    p = buildPath(p, 0);
    p = buildPath(p, 'profile');
    p = buildPath(p, 'email-primary');
    expect(p).toBe('$json.user[0].profile["email-primary"]');
  });
});

describe('SchemaTree — per-row copy button (Vague 13 V13-1)', () => {
  const originalClipboard = (globalThis.navigator as Navigator | undefined)?.clipboard;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    // Restore the original clipboard implementation to avoid pollution between
    // tests (see CLAUDE.md test-stability gotchas).
    if (originalClipboard === undefined) {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it('renders a hover copy button for leaf rows that writes the n8n expression form', async () => {
    render(React.createElement(SchemaTree, { data: { user: { name: 'Ada' } } }));

    // The `user` object row exists at the top level; expand it so the `name`
    // leaf is rendered.
    const expandUserBtn = await screen.findByTestId('schema-tree-copy-$json.user');
    // The expand chevron is the first <button> inside the row with data-path="$json.user".
    const userRow = expandUserBtn.closest('[data-path="$json.user"]') as HTMLElement | null;
    expect(userRow).not.toBeNull();
    const chevron = userRow!.querySelector('button[aria-label="Expand"]') as HTMLElement | null;
    expect(chevron).not.toBeNull();
    await act(async () => {
      fireEvent.click(chevron!);
    });

    const copyBtn = await screen.findByTestId('schema-tree-copy-$json.user.name');
    expect(copyBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith('{{ $json.user.name }}');
  });

  it('does not render a copy button on the synthetic "(+N more)" placeholder row', () => {
    // Use an array of >100 items so SchemaTree emits a placeholder child.
    const data = { items: Array.from({ length: 105 }, (_, i) => ({ id: i })) };
    render(React.createElement(SchemaTree, { data }));

    // The placeholder uses a path that ends with `__more` — verify there is
    // no copy button registered for it.
    const buttons = screen.queryAllByRole('button');
    const placeholderBtn = buttons.find((b) => b.getAttribute('data-testid')?.endsWith('__more'));
    expect(placeholderBtn).toBeUndefined();
  });
});
