import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createOAuth2Provider, OAuthProviderError } from '../oauth2Provider.js';

/**
 * Google (OpenID Connect).
 * Setup: Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID →
 * "Web application", authorized redirect URI `<PUBLIC_ORIGIN>/api/auth/oauth/google/callback`.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// One cached key set per process (jose refreshes it when Google rotates keys).
let googleKeys;

export const google = {
  id: 'google',
  name: 'Google',

  isConfigured: (config) => Boolean(config.oauth?.google?.clientId && config.oauth?.google?.clientSecret),

  /** `jwks` can be injected (tests); defaults to Google's published signing keys. */
  create(config, { jwks } = {}) {
    const { clientId, clientSecret } = config.oauth.google;
    const keys = jwks ?? (googleKeys ??= createRemoteJWKSet(new URL(JWKS_URL)));

    return createOAuth2Provider({
      id: 'google',
      name: 'Google',
      clientId,
      clientSecret,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'email', 'profile'],
      usesNonce: true,
      authorizationParams: { prompt: 'select_account' },

      // The id_token must be signed by Google, issued for our client id, unexpired,
      // and bound to the nonce we sent in this sign-in attempt.
      async fetchProfile(tokens, { nonce }) {
        if (typeof tokens.id_token !== 'string') throw new OAuthProviderError('google: no id_token in token response');
        let claims;
        try {
          ({ payload: claims } = await jwtVerify(tokens.id_token, keys, { issuer: ISSUERS, audience: clientId }));
        } catch (err) {
          throw new OAuthProviderError(`google: id_token rejected (${err.code ?? err.message})`);
        }
        if (!nonce || claims.nonce !== nonce) throw new OAuthProviderError('google: id_token nonce mismatch');
        return {
          providerUserId: claims.sub,
          email: claims.email,
          emailVerified: claims.email_verified === true,
          name: claims.name,
          picture: claims.picture,
        };
      },
    });
  },
};
