import { config } from "../config.js";

/** The address clients know this server by; OAuth tokens are bound to the /mcp resource below it. */
export const ISSUER = config.publicUrl.replace(/\/+$/, "");
export const MCP_RESOURCE = `${ISSUER}/mcp`;
export const RESOURCE_METADATA_URL = `${ISSUER}/.well-known/oauth-protected-resource/mcp`;
