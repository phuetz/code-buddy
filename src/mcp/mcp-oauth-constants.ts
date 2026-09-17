/**
 * Shared MCP OAuth markers.
 *
 * Kept in a leaf module so `mcp-oauth.ts` and `mcp-oauth-provider.ts` can share
 * them without an import cycle.
 */

/** Marker stored as tokenUrl: refresh is handled by the SDK, never by MCPOAuthManager.getValidToken(). */
export const SDK_MANAGED_TOKEN_URL = 'sdk-managed';
