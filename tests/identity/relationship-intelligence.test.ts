import { buildRelationshipContext } from '../../src/identity/relationship-intelligence.js';

describe('buildRelationshipContext', () => {
  it('uses public knowledge for public people without relationship memory', () => {
    const context = buildRelationshipContext({
      subject: 'Bill Gates',
      subjectType: 'public_person',
      confidence: 0.92,
      publicFacts: ['Cofounder of Microsoft', 'American technology entrepreneur'],
      relationshipFacts: ['Met Patrice yesterday'],
      evidence: [
        {
          sourceType: 'public_web',
          label: 'Encyclopedic public source',
          url: 'https://example.com/bill-gates',
          confidence: 0.9,
        },
      ],
    });

    expect(context.contextLevel).toBe('public_context');
    expect(context.publicContext).toContain('Cofounder of Microsoft');
    expect(context.relationshipContext).toEqual([]);
    expect(context.withheld).not.toEqual(
      expect.arrayContaining([expect.stringContaining('relationship facts')]),
    );
    expect(context.allowedUses).toContain('public knowledge');
  });

  it('withholds relationship memory until a known person is confidently recognized', () => {
    const context = buildRelationshipContext({
      subject: 'Patrice',
      subjectType: 'known_person',
      mode: 'robot_conversation',
      confidence: 0.51,
      publicFacts: ['Developer and architect'],
      relationshipFacts: ['Works on the 10-year robot project'],
    });

    expect(context.needsConfirmation).toBe(true);
    expect(context.contextLevel).toBe('public_context');
    expect(context.relationshipContext).toEqual([]);
    expect(context.withheld).toEqual([
      'relationship facts withheld until identity confidence is confirmed',
    ]);
    expect(context.recommendedNextAction).toContain('I think this is Patrice');
  });

  it('allows relationship memory for confirmed known people', () => {
    const context = buildRelationshipContext({
      subject: 'Patrice',
      subjectType: 'known_person',
      mode: 'robot_conversation',
      confidence: 0.96,
      relationshipFacts: ['Prefers direct French answers', 'Builds Code Buddy and Lisa'],
      permissions: {
        useRelationshipMemory: true,
      },
    });

    expect(context.contextLevel).toBe('relationship_context');
    expect(context.relationshipContext).toEqual([
      'Prefers direct French answers',
      'Builds Code Buddy and Lisa',
    ]);
    expect(context.allowedUses).toContain('relationship memory');
  });

  it('keeps unknown people at visible context only by default', () => {
    const context = buildRelationshipContext({
      subject: 'person at conference booth',
      confidence: 0.88,
      publicFacts: ['Possible CTO at Acme'],
      relationshipFacts: ['Likely met last week'],
      visibleSignals: ['wearing an Acme badge', 'standing at a public conference booth'],
    });

    expect(context.subjectType).toBe('unknown_person');
    expect(context.contextLevel).toBe('visible_context_only');
    expect(context.publicContext).toEqual([]);
    expect(context.relationshipContext).toEqual([]);
    expect(context.visibleContext).toContain('wearing an Acme badge');
    expect(context.safetyWarnings[0]).toContain('Unknown person');
  });

  it('withholds sensitive facts unless explicitly allowed and confirmed', () => {
    const context = buildRelationshipContext({
      subject: 'Patrice',
      subjectType: 'known_person',
      confidence: 0.99,
      relationshipFacts: ['Likes compact plans'],
      sensitiveFacts: ['Private health detail'],
      permissions: {
        useRelationshipMemory: true,
      },
    });

    expect(context.relationshipContext).toEqual(['Likes compact plans']);
    expect(context.withheld).toEqual(['1 sensitive fact(s) withheld']);
  });
});
