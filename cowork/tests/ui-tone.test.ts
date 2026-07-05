import { describe, expect, it } from 'vitest';

import { toneClasses } from '../src/renderer/utils/ui-tone';

describe('toneClasses', () => {
  it('maps semantic tones to semantic classes', () => {
    expect(toneClasses('success')).toContain('text-success');
    expect(toneClasses('warning')).toContain('text-warning');
    expect(toneClasses('danger')).toContain('text-destructive');
    expect(toneClasses('info')).toContain('text-primary');
  });

  it('uses default muted classes', () => {
    expect(toneClasses()).toContain('text-muted-foreground');
  });
});
