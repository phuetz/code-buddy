import { describe, expect, it, vi } from 'vitest';
import { queryMediaMessageBlobs } from '../src/main/session/media-message-query';
import { basenameOf, buildMediaSessionIndex } from '../src/main/session/media-session-index';
import type { DatabaseInstance } from '../src/main/db/database';

describe('media message query', () => {
  it('prepares one targeted query per database and maps only its matching rows', () => {
    const all = vi.fn(() => [
      {
        session_id: 'session-with-media',
        content: '[{"type":"text","text":"MEDIA: /tmp/generated-123.png"}]',
      },
    ]);
    const prepare = vi.fn(() => ({ all }));
    const database = {
      raw: { prepare },
    } as unknown as Pick<DatabaseInstance, 'raw'>;

    const first = queryMediaMessageBlobs(database);
    const second = queryMediaMessageBlobs(database);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toContain("role = 'assistant'");
    expect(prepare.mock.calls[0][0]).toContain("content LIKE '%MEDIA:%'");
    expect(all).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);

    const index = buildMediaSessionIndex(first);
    expect(index.get(basenameOf('/library/generated-123.png'))).toBe('session-with-media');
    expect(index.has('unmentioned.png')).toBe(false);
  });
});
