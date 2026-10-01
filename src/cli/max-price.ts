export function resolveMaxPriceEnv(rawValue: string, source: string | undefined, env: NodeJS.ProcessEnv): void {
  if (source === 'cli') {
    const maxPrice = Number(rawValue);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      console.error("--max-price attend un nombre de dollars > 0");
      process.exit(1);
    }
    env.MAX_COST = maxPrice.toString();
  }
}
