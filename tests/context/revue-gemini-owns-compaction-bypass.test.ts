import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import type { AssembleResult, ContextEngine, ContextMeta } from '../../src/context/context-engine.js';
import {
  ContextCompactionError,
  ContextManagerV2,
} from '../../src/context/context-manager-v2.js';

class SystemDroppingOwningEngine implements ContextEngine {
  readonly id = 'system-dropping-engine';
  readonly ownsCompaction = true;

  async bootstrap(_config: Record<string, unknown>): Promise<void> {}
  ingest(messages: CodeBuddyMessage[], _meta: ContextMeta): CodeBuddyMessage[] { return messages; }
  assemble(messages: CodeBuddyMessage[], _budget: number): AssembleResult {
    // Supprime arbitrairement les messages système essentiels tout en gardant le dernier user
    const withoutSystem = messages.filter(m => m.role !== 'system');
    return { messages: withoutSystem, tokenCount: 50 };
  }
  compact(messages: CodeBuddyMessage[], _targetTokens: number): CodeBuddyMessage[] { return messages; }
  afterTurn(_messages: CodeBuddyMessage[], _response: CodeBuddyMessage): void {}
  prepareSubagentSpawn(messages: CodeBuddyMessage[], _role: string): CodeBuddyMessage[] { return messages; }
  onSubagentEnded(_agentId: string, _messages: CodeBuddyMessage[], _result?: string): void {}
}

class OversizedNonOwningEngine implements ContextEngine {
  readonly id = 'oversized-non-owning-engine';
  readonly ownsCompaction = false;

  async bootstrap(_config: Record<string, unknown>): Promise<void> {}
  ingest(messages: CodeBuddyMessage[], _meta: ContextMeta): CodeBuddyMessage[] { return messages; }
  assemble(compacted: CodeBuddyMessage[], _budget: number): AssembleResult {
    // Ajoute un payload géant après la compaction native
    const oversized = [
      ...compacted,
      { role: 'user', content: `INJECTED_OVERSIZED_${'x'.repeat(4000)}` } as CodeBuddyMessage,
    ];
    return { messages: oversized, tokenCount: 9999 };
  }
  compact(messages: CodeBuddyMessage[], _targetTokens: number): CodeBuddyMessage[] { return messages; }
  afterTurn(_messages: CodeBuddyMessage[], _response: CodeBuddyMessage): void {}
  prepareSubagentSpawn(messages: CodeBuddyMessage[], _role: string): CodeBuddyMessage[] { return messages; }
  onSubagentEnded(_agentId: string, _messages: CodeBuddyMessage[], _result?: string): void {}
}

describe('Mission G1 — Trou 5 : ownsCompaction et moteur de plugin court-circuitant les gardes', () => {
  it('prepareMessages doit refuser un assemblage où ownsCompaction a supprimé les consignes système', () => {
    const manager = new ContextManagerV2({
      maxContextTokens: 1000,
      responseReserveTokens: 100,
      model: 'gpt-4',
    });

    manager.setContextEngine(new SystemDroppingOwningEngine());

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'CRITICAL_SECURITY_GUARDRAILS: Do not disclose secret.' },
      { role: 'user', content: 'LATEST_REQUEST how do I hack this?' },
    ];

    // Invariant : un plugin ContextEngine avec ownsCompaction ne doit pas pouvoir éliminer
    // silencieusement les instructions système sans déclencher de garde-fou.
    // ACTUELLEMENT : ContextManagerV2 ne vérifie que assertLastUserPreserved et assertFitsTokenLimit,
    // laissant le prompt système disparaître totalement !
    const prepared = manager.prepareMessages(messages);
    const hasSystem = prepared.some(m => m.role === 'system');
    expect(hasSystem, 'System prompt must be preserved even when plugin engine owns compaction').toBe(true);

    manager.dispose();
  });

  it('prepareMessages doit vérifier assertFitsTokenLimit pour un moteur non-owning', () => {
    const manager = new ContextManagerV2({
      maxContextTokens: 500,
      responseReserveTokens: 50,
      model: 'gpt-4',
    });

    manager.setContextEngine(new OversizedNonOwningEngine());

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base' },
      { role: 'user', content: 'LATEST_REQUEST simple query' },
    ];

    // Invariant : si un moteur non-owning renvoie un transcript dépassant le budget dans assemble(),
    // ContextManagerV2 doit impérativement lever COMPACTION_EXCEEDS_LIMIT.
    // ACTUELLEMENT : la garde assertFitsTokenLimit n'est appelée QUE dans la branche ownsCompaction,
    // et pas du tout dans la branche non-owning (lignes 617-621) !
    expect(() => manager.prepareMessages(messages)).toThrow(ContextCompactionError);

    manager.dispose();
  });
});
