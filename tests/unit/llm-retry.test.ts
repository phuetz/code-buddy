import { describe, it, expect, vi } from 'vitest';
import { parseJsonResponse, generateJsonWithRetry } from '../../src/utils/llm-retry.js';

describe('Self-Healing JSON (llm-retry)', () => {
  describe('parseJsonResponse', () => {
    it('should parse standard JSON string', () => {
      const input = '{"key": "value", "number": 123}';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ key: 'value', number: 123 });
    });

    it('should parse JSON enclosed in markdown fences', () => {
      const input = '```json\n{"key": "value"}\n```';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ key: 'value' });
    });

    it('should parse JSON enclosed in plain markdown code fences', () => {
      const input = '```\n{"key": "value"}\n```';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ key: 'value' });
    });

    it('should extract JSON from surrounding text', () => {
      const input = 'Here is the answer:\n{"key": "value", "nested": {"ok": true}}\nThanks.';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ key: 'value', nested: { ok: true } });
    });

    it('should repair trailing commas', () => {
      const input = '```json\n{"items": [1, 2,], "ok": true,}\n```';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ items: [1, 2], ok: true });
    });

    it('should repair missing closing braces and brackets', () => {
      const input = '{"items": [{"id": 1}, {"id": 2}';
      const parsed = parseJsonResponse(input);
      expect(parsed).toEqual({ items: [{ id: 1 }, { id: 2 }] });
    });

    it('repairs a stray quote-comma line after a completed key (GK33 live flow plan)', () => {
      const input = `{
  "steps": [
    { "id": "1", "title": "Define" },
    {
      "id": "3",
     ",
      "title": "Run"
    }
  ]
}`;
      const parsed = parseJsonResponse(input) as { steps: Array<{ id: string; title: string }> };
      expect(parsed.steps.map((s) => s.title)).toEqual(['Define', 'Run']);
    });
  });

  describe('generateJsonWithRetry', () => {
    it('should return parsed JSON on first attempt if valid', async () => {
      const generateFn = vi.fn().mockResolvedValue('{"success": true}');
      const result = await generateJsonWithRetry<any>(generateFn, 'initial prompt');

      expect(generateFn).toHaveBeenCalledTimes(1);
      expect(generateFn).toHaveBeenCalledWith('initial prompt');
      expect(result).toEqual({ success: true });
    });

    it('should retry if invalid JSON is received and succeed when corrected', async () => {
      const generateFn = vi.fn()
        .mockResolvedValueOnce('invalid json {')
        .mockResolvedValueOnce('{"success": true}');

      const result = await generateJsonWithRetry<any>(generateFn, 'initial prompt');

      expect(generateFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should throw error when max retries are exceeded', async () => {
      const generateFn = vi.fn().mockResolvedValue('bad json');

      await expect(generateJsonWithRetry<any>(generateFn, 'initial prompt', 1))
        .rejects.toThrow('Failed to generate valid JSON after 1 retries');
    });
  });
});
