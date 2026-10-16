/**
 * Generic OAuth 2.0 authorization-code client (PKCE, optional OIDC nonce) — spec §7.2.1.
 * A concrete provider (./providers/google.js) only supplies endpoints, scopes and a
 * `fetchProfile(tokens, { nonce })` that verifies the provider's answer and maps it to:
 *
 *   {
 *     providerUserId: string,   // the provider's stable subject id — never the email
 *     email: string | null,     // lowercased here
 *     emailVerified: boolean,   // only verified emails are trusted for linking/creating
 *     name: string,
 *     picture: string | null,
 *   }
 *
 * The object returned by createOAuth2Provider is all the rest of the app uses:
 *   { id, name, authorizationUrl({ state, codeChallenge, nonce, redirectUri }),
 *     exchange({ code, codeVerifier, nonce, redirectUri }) → Profile }
 */

const TIMEOUT_MS = 10_000;

/** Anything that went wrong talking to / verifying the provider. Never contains tokens. */
export class OAuthProviderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'OAuthProviderError';
    this.details = details;
  }
}

/** fetch() + JSON + timeout; non-2xx responses throw OAuthProviderError with the OAuth error code. */
export async function fetchJson(url, init = {}) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new OAuthProviderError(`Request to ${host} failed: ${err.message}`);
  }
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON error page; only the status is useful
  }
  if (!res.ok) {
    throw new OAuthProviderError(`${host} responded ${res.status}`, { error: body.error });
  }
  return body;
}

export function createOAuth2Provider({
  id,
  name,
  clientId,
  clientSecret,
  authorizationEndpoint,
  tokenEndpoint,
  scopes,
  usesNonce = false, // OpenID Connect providers bind the id_token to a nonce
  authorizationParams = {},
  fetchProfile,
}) {
  return {
    id,
    name,

    authorizationUrl({ state, codeChallenge, nonce, redirectUri }) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...authorizationParams,
      });
      if (usesNonce) params.set('nonce', nonce);
      const url = new URL(authorizationEndpoint);
      url.search = params.toString();
      return url.toString();
    },

    async exchange({ code, codeVerifier, nonce, redirectUri }) {
      const tokens = await fetchJson(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: codeVerifier,
        }),
      });
      return normalizeProfile(id, await fetchProfile(tokens, { nonce }));
    },
  };
}

function normalizeProfile(id, p) {
  if (!p || typeof p.providerUserId !== 'string' || !p.providerUserId) {
    throw new OAuthProviderError(`${id}: profile has no subject id`);
  }
  return {
    providerUserId: p.providerUserId,
    email: typeof p.email === 'string' && p.email.trim() ? p.email.trim().toLowerCase() : null,
    emailVerified: p.emailVerified === true,
    name: typeof p.name === 'string' ? p.name.trim() : '',
    picture: typeof p.picture === 'string' ? p.picture : null,
  };
}
