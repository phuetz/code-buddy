import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createCompanionCard,
  formatCompanionCards,
  getCompanionCardsPath,
  readCompanionCards,
  updateCompanionCardStatus,
} from '../src/companion/cards.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

describe('companion cards', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-cards-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('creates typed cards and records them as companion percepts', async () => {
    const card = await createCompanionCard({
      kind: 'mission',
      title: 'Run the next companion mission',
      body: 'Prepare the next executable brief.',
      priority: 'high',
      actions: [{ id: 'run-next', label: 'Run next', command: 'buddy companion missions run-next', style: 'primary' }],
      tags: ['mission-board'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(card.id).toContain('card-20260524100000');
    const store = await readCompanionCards({ cwd: tempDir });
    expect(store.storePath).toBe(getCompanionCardsPath(tempDir));
    expect(store.cards[0]).toMatchObject({
      id: card.id,
      kind: 'mission',
      priority: 'high',
      status: 'open',
    });
    expect(formatCompanionCards(store)).toContain('Buddy Companion Cards');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'tool' });
    expect(percepts.some(percept => percept.source === 'companion_cards')).toBe(true);
  });

  it('records approval cards in the safety ledger', async () => {
    const card = await createCompanionCard({
      kind: 'approval',
      title: 'Approve outbound Discord reply',
      body: 'Reply to a companion gateway thread.',
      priority: 'high',
      actions: [{ id: 'approve', label: 'Approve', style: 'primary' }],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:05:00.000Z'),
    });

    const events = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'permission' });
    expect(events[0]).toMatchObject({
      action: 'companion_card_approval',
      status: 'planned',
      payload: expect.objectContaining({ cardId: card.id }),
    });
  });

  it('updates card status and supports filtered reads', async () => {
    const first = await createCompanionCard({
      kind: 'camera',
      title: 'Review latest snapshot',
    }, { cwd: tempDir, now: new Date('2026-05-24T10:10:00.000Z') });
    await createCompanionCard({
      kind: 'tool',
      title: 'Inspect tool result',
      priority: 'low',
    }, { cwd: tempDir, now: new Date('2026-05-24T10:11:00.000Z') });

    const resolved = await updateCompanionCardStatus(first.id, 'resolved', {
      cwd: tempDir,
      now: new Date('2026-05-24T10:12:00.000Z'),
    });

    expect(resolved.status).toBe('resolved');
    const openCards = await readCompanionCards({ cwd: tempDir, status: 'open' });
    expect(openCards.cards).toHaveLength(1);
    expect(openCards.cards[0].kind).toBe('tool');
  });
});
