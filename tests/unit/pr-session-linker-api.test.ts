import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRSessionLinker } from '../../src/integrations/pr-session-linker.js';

describe('PRSessionLinker API integration', () => {
  const originalFetch = global.fetch;
  const originalRepo = process.env.GITHUB_REPOSITORY;

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'acme/project';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalRepo === undefined) {
      delete process.env.GITHUB_REPOSITORY;
    } else {
      process.env.GITHUB_REPOSITORY = originalRepo;
    }
    vi.restoreAllMocks();
  });

  it('hydrates PR metadata from the GitHub API when the repo is known', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/pulls/42')) {
        return new Response(
          JSON.stringify({
            number: 42,
            title: 'Fix auth flow',
            body: 'Adds stricter token validation',
            state: 'open',
            draft: false,
            html_url: 'https://github.com/acme/project/pull/42',
            head: { ref: 'feature/fix-auth' },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/pulls/42/reviews')) {
        return new Response(JSON.stringify([{ state: 'APPROVED' }]), { status: 200 });
      }

      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const linker = new PRSessionLinker();
    const pr = await linker.linkToPR('42');

    expect(pr.title).toBe('Fix auth flow');
    expect(pr.repo).toBe('acme/project');
    expect(pr.branch).toBe('feature/fix-auth');
    expect(linker.getReviewStatus()).toBe('approved');
  });

  it('auto-links from a branch name through the GitHub API', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/pulls?head=')) {
        return new Response(
          JSON.stringify([
            {
              number: 84,
              title: 'Refactor session loading',
              body: '',
              state: 'open',
              draft: false,
              html_url: 'https://github.com/acme/project/pull/84',
              head: { ref: 'feature/session-loading' },
            },
          ]),
          { status: 200 }
        );
      }

      if (url.endsWith('/pulls/84/reviews')) {
        return new Response(JSON.stringify([{ state: 'CHANGES_REQUESTED' }]), { status: 200 });
      }

      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const linker = new PRSessionLinker();
    const pr = await linker.autoLinkFromBranch('feature/session-loading');

    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(84);
    expect(linker.getReviewStatus()).toBe('changes_requested');
  });
});
