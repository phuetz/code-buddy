/** Shared best-effort mood/trait drift for every spoken reply path. */
export async function evolveRelationshipFromUtterance(heard: string): Promise<void> {
  if (process.env.CODEBUDDY_COMPANION_RELATIONAL !== 'true') return;
  try {
    const [augmentation, relationship, relationalContext] = await Promise.all([
      import('./reply-augment.js'),
      import('./relationship-state.js'),
      import('./relational-context.js'),
    ]);
    const signal = augmentation.detectRelationalSignal(heard);
    relationship.saveRelationshipState(
      relationship.evolveTraits(relationship.loadRelationshipState(), signal),
    );
    relationalContext.invalidateVoiceRelationalContext();
    if (signal !== 'neutral') {
      void relationalContext.prewarmVoiceRelationalContext().catch(() => undefined);
    }
  } catch {
    /* expressive drift is optional and must never block or break a spoken reply */
  }
}
