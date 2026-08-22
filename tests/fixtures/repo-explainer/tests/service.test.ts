import { describe, expect, it } from 'vitest';
import { createService } from '../src/service.js';

describe('service', () => {
  it('handles a value', () => {
    expect(createService().handle(1)).toBe('accepted');
  });
});
