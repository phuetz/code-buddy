const delayMs = Number(process.env.MCP_FIXTURE_DELAY_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
await import('./real-mcp-fixture.mjs');
