/**
 * IdentityLinker persistence hardening.
 *
 * Reproduces IDLINKS1: a batch of `link()`/`unlink()` calls in quick
 * succession (as happens when several channel adapters resolve identities
 * around the same moment) each mark the linker dirty and fire an unawaited
 * `persist()`. Before the fix, every one of those calls opened its own
 * `<target>.tmp.<pid>.<hex>` temporary file and renamed it onto the same
 * target — one physical write per call, even when the serialized content
 * never changed between calls. See docs/reports/2026-09/REPARATION-IDLINKS1.md.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as atomicWrite from '../../src/utils/atomic-write.js';
import { IdentityLinker, resetIdentityLinker } from '../../src/channels/identity-links.js';

describe('IdentityLinker persistence hardening', () => {
  let tempDir: string;
  let persistPath: string;
  let linker: IdentityLinker;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idlinks1-persist-'));
    persistPath = join(tempDir, 'identity-links.json');
    resetIdentityLinker();
    linker = new IdentityLinker({ persistPath });
    writeSpy = vi.spyOn(atomicWrite, 'writeFileAtomic');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetIdentityLinker();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('coalesces concurrent persist() calls into a single physical write', async () => {
    linker.link(
      { channelType: 'telegram', peerId: 'a' },
      { channelType: 'discord', peerId: 'b' },
    );

    // Simulate 16 channel adapters each firing autoPersist() around the
    // same moment (the exact "packets of 16" shape measured on the robot).
    await Promise.all(Array.from({ length: 16 }, () => linker.persist()));

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the physical write when the serialized content is unchanged', async () => {
    linker.link(
      { channelType: 'telegram', peerId: 'a' },
      { channelType: 'discord', peerId: 'b' },
    );
    await linker.persist();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    // Nothing changed the in-memory state since the last write.
    await linker.persist();
    await linker.persist();
    await linker.persist();

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('still writes once more when state actually changes after a persist', async () => {
    linker.link(
      { channelType: 'telegram', peerId: 'a' },
      { channelType: 'discord', peerId: 'b' },
    );
    await linker.persist();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    linker.link(
      { channelType: 'slack', peerId: 'c' },
      { channelType: 'matrix', peerId: 'd' },
    );
    await linker.persist();

    expect(writeSpy).toHaveBeenCalledTimes(2);
  });
});
