import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { conflict, unauthenticated } from '../lib/errors.js';
import { signToken } from '../lib/jwt.js';
import { DuplicateKeyError } from '../repositories/index.js';

export function createAuthService({ repos, config }) {
  const rounds = config.bcryptRounds ?? 12;
  // Compared against when the email is unknown, so timing doesn't reveal which emails exist.
  let dummyHashPromise;
  const dummyHash = () => (dummyHashPromise ??= bcrypt.hash(crypto.randomUUID(), rounds));

  async function register({ username, email, password }) {
    if (await repos.users.findByEmail(email)) throw emailTaken();
    if (await repos.users.findByUsername(username)) throw usernameTaken();

    const passwordHash = await bcrypt.hash(password, rounds);
    const user = {
      id: crypto.randomUUID(),
      username,
      email: email.toLowerCase(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    try {
      await repos.users.create(user);
    } catch (err) {
      // Lost a race with a concurrent registration.
      if (err instanceof DuplicateKeyError) throw err.index === 'emailLower' ? emailTaken() : usernameTaken();
      throw err;
    }
    return { user, token: signToken(user.id, config) };
  }

  async function login({ email, password }) {
    const user = await repos.users.findByEmail(email);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !ok) throw unauthenticated('Incorrect email or password');
    return { user, token: signToken(user.id, config) };
  }

  return { register, login };
}

const emailTaken = () =>
  conflict('EMAIL_TAKEN', 'An account with this email already exists', [
    { path: 'email', message: 'An account with this email already exists' },
  ]);
const usernameTaken = () =>
  conflict('USERNAME_TAKEN', 'This username is already taken', [
    { path: 'username', message: 'This username is already taken' },
  ]);
