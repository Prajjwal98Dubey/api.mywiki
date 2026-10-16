import { notFound } from '../lib/errors.js';
import { setAuthCookie } from '../lib/jwt.js';
import {
  createAuthRequest,
  setTxCookie,
  readTxCookie,
  clearTxCookie,
  statesMatch,
  safeReturnTo,
} from '../oauth/state.js';
import { OAuthProviderError } from '../oauth/oauth2Provider.js';
import { OAuthSignInError } from '../services/oauth.service.js';

/**
 * Browser-facing OAuth endpoints (spec §7.2.1). /start and /callback are full-page
 * navigations, so they answer with **relative** redirects, never JSON:
 * success → `returnTo`; failure → `/login?error=<code>[&returnTo=…]` where code is
 * oauth_cancelled | oauth_email_unverified | oauth_account_exists | oauth_failed.
 * Causes are logged server-side; provider error text never goes into the URL.
 */
export function createOAuthController({ oauthService, providers, config }) {
  const callbackUrl = (id) => `${config.publicOrigin}/api/auth/oauth/${id}/callback`;
  const loginErrorUrl = (code, returnTo) => {
    const qs = new URLSearchParams({ error: code });
    if (returnTo && returnTo !== '/') qs.set('returnTo', returnTo);
    return `/login?${qs}`;
  };

  const getProvider = (id) => {
    const provider = providers.get(id);
    if (!provider) throw notFound(`Sign-in with "${id}" is not available`);
    return provider;
  };

  return {
    /** GET /api/auth/providers → { providers: [{ id, name, startUrl }] } (configured ones only). */
    list(_req, res) {
      res.json({
        providers: [...providers.values()].map((p) => ({
          id: p.id,
          name: p.name,
          startUrl: `/api/auth/oauth/${p.id}/start`,
        })),
      });
    },

    /** GET /api/auth/oauth/:provider/start?returnTo=/path → 302 to the provider. */
    start(req, res) {
      const provider = getProvider(req.params.provider);
      const { state, nonce, codeVerifier, codeChallenge } = createAuthRequest();
      const returnTo = safeReturnTo(req.query.returnTo);
      setTxCookie(res, { provider: provider.id, state, nonce, codeVerifier, returnTo }, config);
      res.set('Cache-Control', 'no-store');
      res.redirect(
        302,
        provider.authorizationUrl({ state, codeChallenge, nonce, redirectUri: callbackUrl(provider.id) }),
      );
    },

    /** GET /api/auth/oauth/:provider/callback?code&state → sets the `token` cookie, 302 to returnTo. */
    async callback(req, res) {
      const provider = getProvider(req.params.provider);
      const tx = readTxCookie(req, config);
      clearTxCookie(res, config); // one attempt per transaction
      res.set('Cache-Control', 'no-store');
      const returnTo = safeReturnTo(tx?.returnTo);
      const fail = (code, reason) => {
        if (reason) console.warn(`[oauth] ${provider.id} sign-in failed: ${reason}`);
        return res.redirect(302, loginErrorUrl(code, returnTo));
      };

      const { code, state, error } = req.query;
      if (error === 'access_denied') return fail('oauth_cancelled');
      if (error) return fail('oauth_failed', `provider returned error=${String(error).slice(0, 50)}`);
      if (!tx || tx.provider !== provider.id || !statesMatch(tx.state, state)) {
        return fail('oauth_failed', 'missing, expired or mismatched state');
      }
      if (typeof code !== 'string' || !code) return fail('oauth_failed', 'no authorization code');

      let profile;
      try {
        profile = await provider.exchange({
          code,
          codeVerifier: tx.codeVerifier,
          nonce: tx.nonce,
          redirectUri: callbackUrl(provider.id),
        });
      } catch (err) {
        if (err instanceof OAuthProviderError) return fail('oauth_failed', `${err.message} ${err.details?.error ?? ''}`);
        console.error(`[oauth] ${provider.id} code exchange crashed:`, err);
        return fail('oauth_failed');
      }

      try {
        const { token } = await oauthService.signIn(provider.id, profile);
        setAuthCookie(res, token, config);
        return res.redirect(302, returnTo);
      } catch (err) {
        if (err instanceof OAuthSignInError) return fail(err.code);
        console.error(`[oauth] ${provider.id} find-or-create failed:`, err);
        return fail('oauth_failed');
      }
    },
  };
}
