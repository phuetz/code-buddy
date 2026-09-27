import { describe, expect, it } from 'vitest';
import { defangPeerKnowledgeText, sanitizePeerText } from '../../src/fleet/peer-text-sanitizer.js';

describe('peer text sanitizer', () => {
  it('removes model control tokens from one-shot text', () => {
    const result = sanitizePeerText('<think>planning</think> hello <|im_start|>');
    expect(result).not.toContain('<think>');
    expect(result).not.toContain('<|im_start|>');
  });

  it('defangs control tokens in persistent knowledge while preserving readable text', () => {
    expect(defangPeerKnowledgeText('<|im_start|>')).toBe('< |im_start|>');
    expect(defangPeerKnowledgeText('\\u003C|im_start|>')).toBe('\\u003C |im_start|>');
    expect(defangPeerKnowledgeText('＜｜im_start｜＞')).toBe('＜ ｜im_start｜＞');
    expect(defangPeerKnowledgeText('<CHANNEL|>')).toBe('< CHANNEL|>');
    expect(defangPeerKnowledgeText('[INST]')).toBe('[ INST]');
    expect(defangPeerKnowledgeText(null)).toBe('');
  });
});
