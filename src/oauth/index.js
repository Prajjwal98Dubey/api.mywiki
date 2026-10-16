import { google } from './providers/google.js';

/**
 * Provider registry (spec §7.2.1). Each entry is
 *   { id, name, isConfigured(config), create(config) → provider }
 * where `provider` follows the interface in ./oauth2Provider.js.
 *
 * To add e.g. GitHub:
 *   1. write ./providers/github.js using createOAuth2Provider() with its endpoints and a
 *      fetchProfile() that returns { providerUserId, email, emailVerified, name, picture }
 *   2. add it to PROVIDERS below
 *   3. add GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET to config/env.js (→ config.oauth.github)
 * Routes, the state cookie and find-or-create sign-in are provider-agnostic and don't change.
 */
const PROVIDERS = [google];

/**
 * Map(id → provider) of the providers whose credentials are configured.
 * Tests may inject ready-made providers with `config.oauthProviders` (an array).
 */
export function createOAuthProviders(config) {
  if (config.oauthProviders) return new Map(config.oauthProviders.map((p) => [p.id, p]));
  return new Map(PROVIDERS.filter((p) => p.isConfigured(config)).map((p) => [p.id, p.create(config)]));
}
