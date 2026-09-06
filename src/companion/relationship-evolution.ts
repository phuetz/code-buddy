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
    const current = relationship.loadRelationshipState();
    const { isCopinePersona } = await import('./personas/index.js');
    const { resolveHouseholdClock } = await import('./household-time.js');
    const next = isCopinePersona()
      ? relationship.evolveTraitsWithDayInertia(current, signal, {
          localDate: resolveHouseholdClock(new Date()).localDate,
        })
      : relationship.evolveTraits(current, signal);
    relationship.saveRelationshipState(next);
    relationalContext.invalidateVoiceRelationalContext();
    if (signal !== 'neutral') {
      void relationalContext.prewarmVoiceRelationalContext().catch(() => undefined);
    }
  } catch {
    /* expressive drift is optional and must never block or break a spoken reply */
  }
}
