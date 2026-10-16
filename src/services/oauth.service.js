import crypto from 'node:crypto';
import { signToken } from '../lib/jwt.js';
import { createKeyedMutex } from '../lib/keyedMutex.js';
import { DuplicateKeyError } from '../repositories/index.js';

/**
 * Expected sign-in refusals; `code` becomes `/login?error=<code>` (spec §7.2.1).
 *   oauth_email_unverified  the provider didn't share a verified email
 *   oauth_account_exists    a password account already uses this email (see signIn)
 */
export class OAuthSignInError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OAuthSignInError';
    this.code = code;
  }
}

const USERNAME_MIN = 3;
const USERNAME_MAX = 30;

/** "Ram Singh" → "ram_singh"; accents dropped; only [a-z0-9_]. */
function toUsernameBase(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX);
}

/**
 * Provider-agnostic find-or-create. Works only on the normalized profile every provider
 * returns ({ providerUserId, email, emailVerified, name, picture }), so adding a provider
 * never touches this file.
 */
export function createOAuthService({ repos, config }) {
  const withLock = createKeyedMutex();

  /** From the name, else the email's local part; padded to 3; unique via ram_singh2, ram_singh3… */
  async function uniqueUsername(profile) {
    const fromName = toUsernameBase(profile.name);
    const fromEmail = toUsernameBase(profile.email.split('@')[0]);
    let base = [fromName, fromEmail].find((b) => b.length >= USERNAME_MIN);
    if (!base) {
      const longer = fromName.length >= fromEmail.length ? fromName : fromEmail;
      base = longer ? `${longer}_user` : 'user';
    }
    if (!(await repos.users.findByUsername(base))) return base;
    for (let n = 2; n < 1000; n++) {
      const suffix = String(n);
      const candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
      if (!(await repos.users.findByUsername(candidate))) return candidate;
    }
    return `${base.slice(0, USERNAME_MAX - 7)}_${crypto.randomInt(100_000, 1_000_000)}`;
  }

  async function linkIdentity(user, provider, profile, now) {
    try {
      await repos.identities.create({
        id: crypto.randomUUID(),
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        createdAt: now,
        lastLoginAt: now,
      });
    } catch (err) {
      if (!(err instanceof DuplicateKeyError)) throw err; // already linked by a concurrent request
    }
  }

  async function resolveUser(provider, profile) {
    const now = new Date().toISOString();

    // 1. Returning user: matched by the provider's subject id, never by email alone.
    const identity = await repos.identities.findByProviderUser(provider, profile.providerUserId);
    if (identity) {
      const user = await repos.users.findById(identity.userId);
      if (user) {
        await repos.identities.update(identity.id, { lastLoginAt: now, email: profile.email ?? identity.email });
        return { user, isNewUser: false };
      }
    }

    // Never link or create on an email the provider hasn't verified.
    if (!profile.email || !profile.emailVerified) throw new OAuthSignInError('oauth_email_unverified');

    // 2. A user with this email exists.
    const existing = await repos.users.findByEmail(profile.email);
    if (existing) {
      // Password sign-ups never verify their email, so auto-linking one would let whoever
      // registered it first keep access to the real owner's account ("pre-hijacking").
      // The user logs in with their password instead; linking from settings can come later.
      if (existing.passwordHash) throw new OAuthSignInError('oauth_account_exists');
      await linkIdentity(existing, provider, profile, now);
      return { user: existing, isNewUser: false };
    }

    // 3. First visit: create the user, then its identity. (No cross-collection transaction:
    // if the identity write fails, the next sign-in links it through step 2, since the
    // new account has no password and a verified email.)
    const user = {
      id: crypto.randomUUID(),
      username: await uniqueUsername(profile),
      email: profile.email,
      passwordHash: null,
      createdAt: now,
    };
    await repos.users.create(user);
    await linkIdentity(user, provider, profile, now);
    return { user, isNewUser: true };
  }

  /** → { user, token, isNewUser } for a profile the provider has already verified. */
  async function signIn(provider, profile) {
    const result = await withLock(`${provider}:${profile.providerUserId}`, async () => {
      try {
        return await resolveUser(provider, profile);
      } catch (err) {
        // Lost a race on email/username with a concurrent sign-up: a second pass sees the winner.
        if (err instanceof DuplicateKeyError) return resolveUser(provider, profile);
        throw err;
      }
    });
    return { ...result, token: signToken(result.user.id, config) };
  }

  return { signIn };
}
