import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Guardian Agent documentation honesty', () => {
  it('should not claim Guardian Agent is active in approval chain if it is not imported in src', () => {
    const securityDocPath = path.join(process.cwd(), 'docs', 'security.md');
    const featuresDocPath = path.join(process.cwd(), 'docs', 'features.md');

    const securityContent = fs.readFileSync(securityDocPath, 'utf8');
    const featuresContent = fs.readFileSync(featuresDocPath, 'utf8');

    // These regex check for the false claims about Guardian being an active check/step in approvals.
    const isGuardianActiveInSecurityDoc2 = /Confirmation Service[\s\S]*4\.\s*Guardian Agent/i.test(securityContent);
    const isFailClosedClaimed = /fail-closed design/i.test(securityContent);

    // Check if security doc states it's tested in isolation or similar context rather than just matching title
    const hasTestedInIsolationNote = /tested in isolation and is NOT actively plugged into the approval chain/i.test(securityContent);

    // docs/features.md check
    const isGuardianActiveInFeaturesDoc = /Guardian Agent.*scores each operation.*auto-approve.*prompt.*deny/i.test(featuresContent);

    // If Guardian Agent is truly not active, these claims must be removed or modified to reflect its test-only status.
    expect(hasTestedInIsolationNote, 'docs/security.md should clarify that Guardian Agent is tested in isolation and NOT actively plugged in').toBe(true);
    expect(isGuardianActiveInSecurityDoc2, 'docs/security.md should not list Guardian Agent in the Confirmation Service order').toBe(false);
    expect(isFailClosedClaimed, 'docs/security.md should not claim fail-closed design for Guardian Agent').toBe(false);
    expect(isGuardianActiveInFeaturesDoc, 'docs/features.md should not claim Guardian Agent scores each operation').toBe(false);
  });
});
