# MyWiki — server

Express 5 REST API for MyWiki. The contract is in [`../PROJECT_SPEC.md`](../PROJECT_SPEC.md) §6–7;
the implementation plan is in [`../BACKEND_PLAN.md`](../BACKEND_PLAN.md).

## Quick start

```bash
cd server
npm install
cp .env.example .env      # set JWT_SECRET to a long random string
npm run seed              # demo@mywiki.local / demo12345 + Jane_Doe, John_Doe, Ada_Example
npm run dev               # http://localhost:5000  (GET /api/health)
```

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server with `--watch` |
| `npm start` | Starts the server |
| `npm run seed` | Seeds an empty data dir. `npm run seed -- --force` wipes it first |
| `npm test` | Runs the `node:test` + supertest suite (each test file uses its own temp data dir) |
| `npm run test:mongo` | Same suite against MongoDB (each test file creates and drops a `mywiki_test_*` database) |
| `npm run migrate:json-to-mongo` | Copies `data/*.json` into MongoDB, keeping ids. Safe to re-run |

`.env` is optional in development (an insecure dev JWT secret is used, with a warning). In
production, `JWT_SECRET` (≥16 chars) is required.

## Layout

```
src/
  index.js / app.js     entry point / createApp({ repos, config }) (tests use createApp)
  config/env.js         env → frozen config (zod)
  routes/ → controllers/ (HTTP only) → services/ (business logic) → repositories/ (storage only)
  middleware/           auth, loadPage/requireOwner, validate, upload, rateLimit, errorHandler
  validation/           zod schemas (page limits live in page.schemas.js → LIMITS)
  lib/                  slug, wikitext, jwt, serialize, errors, keyedMutex
  repositories/         json/ (files) and mongo/ (mongoose): the same interface
scripts/              seed.js, migrateJsonToMongo.js, testMongo.js
tests/
```

## Storage

### JSON (default)

`STORAGE_DRIVER=json` keeps `users.json`, `pages.json` and `revisions.json`
in `DATA_DIR`. Collections live in memory and are persisted with atomic tmp-file + rename writes
(retried on Windows file locks). Writes are queued and coalesced. Uniqueness (email, username, slug)
is enforced by in-memory unique indexes. A corrupt data file stops startup instead of being overwritten.

Because the JSON store is in-process, run **a single server process** per data dir.

### MongoDB

`STORAGE_DRIVER=mongo` stores the same documents in MongoDB (mongoose, `src/repositories/mongo/`).
Ids stay UUID strings (stored as `_id`), dates stay ISO strings, so the API output is identical.

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | `mongodb+srv://user:<db_password>@cluster.xxxx.mongodb.net/` (Atlas) or `mongodb://127.0.0.1:27017` |
| `DB_PASSWORD` | Atlas DB user's password. Replaces `<db_password>` in `MONGODB_URI`, URL-encoded automatically |
| `MONGODB_DB_NAME` | Database name, default `mywiki` |
| `TEST_MONGODB_URI` | Optional, for `npm run test:mongo` (defaults to `MONGODB_URI`) |

Atlas checklist:
1. **Database Access**: the DB user needs *readWrite* on the `mywiki` database (and on `mywiki_test_*` if you run
   `test:mongo`; *Read and write to any database* covers both).
2. **Network Access**: add your current IP (or `0.0.0.0/0` for a quick dev setup). A missing entry shows up as a
   server-selection timeout after ~10 s.
3. Set `DB_PASSWORD` in `.env` (plain text; it is URL-encoded for you). Startup refuses a URI that still contains
   `<db_password>` with no `DB_PASSWORD` set.

Switching over:
```bash
# in .env: STORAGE_DRIVER=mongo
npm run seed                    # fresh demo data in Mongo, or:
npm run migrate:json-to-mongo   # copy existing data/*.json (keeps ids, skips docs already there)
npm run dev                     # GET /api/health → { ok: true, storage: "mongo" }
```

On startup the server creates its indexes (unique: users `emailLower`, `usernameLower`; pages `slugKey`; revisions
`pageId + revNumber`). Edit-conflict checks use an in-process lock, so run **one server process** per database for now.

## Images (local disk or Amazon S3)

`IMAGE_STORAGE=local` (default) keeps uploads in `UPLOAD_DIR`. `IMAGE_STORAGE=s3` stores them in a **private** S3 bucket.
Either way, image URLs are `/uploads/<uuid>.<ext>` and the server streams them (`src/images/imageStore.js`), so pages and
the client don't change when you switch.

**Only images, strictly** (`src/images/detectImage.js`): each upload is held in memory (≤ 5 MB) and inspected byte by
byte before anything is written. It must be exactly one complete JPEG, PNG, GIF or WebP, ≤ 10,000 px per side and ≤ 40 MP.
Videos, documents, SVG/HTML, archives, truncated files, and images with extra data appended (e.g. "motion photo" MP4s,
polyglots) get `415`. The stored type and extension come from the bytes, never from the client.

Switching to S3:
1. Create a bucket (keep **Block Public Access** on) and an IAM user whose policy allows `s3:PutObject` and
   `s3:GetObject` on `arn:aws:s3:::<bucket>/mywiki-profile-img/*` and `s3:ListBucket` on `arn:aws:s3:::<bucket>`.
2. In `.env`: `IMAGE_STORAGE=s3`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
3. `npm run migrate:uploads-to-s3` copies existing local images (same names, so old URLs keep working; safe to re-run).
4. `npm run dev`: startup checks the bucket and logs `images: s3`.

## Sign in with Google

One OAuth flow handles both sign-up and log-in (spec §7.2.1). The browser goes to
`/api/auth/oauth/google/start?returnTo=/somewhere`. The server redirects to Google, verifies the `id_token`
(signature against Google's keys, issuer, audience, expiry, nonce) with PKCE + `state`, then finds or creates the
user and sets the usual `token` cookie.

1. Google Cloud Console → APIs & Services → **OAuth consent screen** (External; add yourself as a test user).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized redirect URI: `http://localhost:5173/api/auth/oauth/google/callback` (dev, through the Vite proxy).
   In production use `<PUBLIC_ORIGIN>/api/auth/oauth/google/callback`.
3. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart. `GET /api/auth/providers` then lists Google.

Code: `src/oauth/` (generic OAuth client + provider registry + the `oauth_tx` state cookie) and
`src/services/oauth.service.js` (provider-agnostic find-or-create). Accounts live in `users`; each external login is a
row in `identities` `(provider, providerUserId) → userId`. **Adding a provider** (GitHub, Microsoft…) means writing
`src/oauth/providers/<name>.js`, registering it in `src/oauth/index.js` and adding its two env vars.

## Notes

- Slugs (spec §6.4): the server assigns them. "Ram Singh" → `ram-singh`; a later page with the same
  title (or a reserved word like `login`) gets a 9-char random suffix, e.g. `ram-singh-1rqdasr3r`.
  Lookups slugify the URL param, so `/api/pages/Ram%20Singh` finds `ram-singh`. The reserved list is
  `RESERVED_SLUGS` in `src/lib/slug.js`. Keep it equal to the spec, which lists the frontend's top-level routes.
- Edit conflicts: `PUT` compares `baseRevisionId` under a per-page lock, so concurrent saves from the
  same base produce exactly one success and the rest get `409 EDIT_CONFLICT`.
- Saving identical content is a null edit, so no revision is created.
- Uploads: MIME allow-list, then a magic-byte check. The file name is a random UUID with an extension
  taken from the MIME type. Served from `/uploads` with `nosniff`.
- Rate limits: login 10/15 min, register 5/hour per IP (`429 RATE_LIMITED`).
