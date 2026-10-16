import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  STORAGE_DRIVER: z.enum(['json', 'mongo']).default('json'),
  DATA_DIR: z.string().default('./data'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
  MONGODB_URI: z.string().trim().optional(),
  MONGODB_DB_NAME: z.string().trim().min(1).default('mywiki'),
  DB_PASSWORD: z.string().optional(),
  // External sign-in. A provider is enabled when both its id and secret are set.
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
  // Public origin the browser uses (the provider redirects to <PUBLIC_ORIGIN>/api/auth/oauth/<id>/callback).
  // Defaults to CLIENT_ORIGIN, i.e. through the Vite proxy in development.
  PUBLIC_ORIGIN: z.string().trim().optional(),
  // Uploaded images: local disk (UPLOAD_DIR) or Amazon S3.
  IMAGE_STORAGE: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().trim().optional(),
  S3_REGION: z.string().trim().optional(),
  AWS_REGION: z.string().trim().optional(),
  // Folder inside the bucket that holds the images (profile pictures).
  S3_PREFIX: z.string().trim().default('mywiki-profile-img/'),
  // Only for S3-compatible services (MinIO, LocalStack…); leave unset for AWS.
  S3_ENDPOINT: z.string().trim().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
});

const stripTrailingSlash = (url) => url.replace(/\/+$/, '');

const PASSWORD_PLACEHOLDER = /<db_password>/i;

/**
 * Fills the `<db_password>` placeholder in MONGODB_URI from DB_PASSWORD (URL-encoded),
 * so the password lives in a single variable and may contain any characters.
 */
export function resolveMongoUri(uri, password) {
  if (!uri || !password) return uri;
  return uri.replace(new RegExp(PASSWORD_PLACEHOLDER.source, 'gi'), encodeURIComponent(password));
}

/**
 * Builds a frozen config object from environment variables.
 * Relative paths are resolved against the server folder, not the cwd.
 * `overrides` lets tests inject values (e.g. a temp dataDir).
 */
export function loadConfig(env = process.env, overrides = {}) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  if (!e.JWT_SECRET && e.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (≥16 chars) in production');
  }

  const mongodbUri = resolveMongoUri(e.MONGODB_URI, e.DB_PASSWORD);
  if (e.STORAGE_DRIVER === 'mongo') {
    if (!mongodbUri) throw new Error('MONGODB_URI must be set when STORAGE_DRIVER=mongo');
    if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
      throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    }
    if (PASSWORD_PLACEHOLDER.test(mongodbUri)) {
      throw new Error('MONGODB_URI contains <db_password>: set DB_PASSWORD in .env to the database user\'s password.');
    }
  }

  if (Boolean(e.GOOGLE_CLIENT_ID) !== Boolean(e.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in (or neither).');
  }

  const s3Region = e.S3_REGION || e.AWS_REGION;
  if (e.IMAGE_STORAGE === 's3') {
    if (!e.S3_BUCKET) throw new Error('S3_BUCKET must be set when IMAGE_STORAGE=s3');
    if (!s3Region) throw new Error('S3_REGION (or AWS_REGION) must be set when IMAGE_STORAGE=s3');
  }

  const clientOrigin = stripTrailingSlash(e.CLIENT_ORIGIN);
  const config = {
    port: e.PORT,
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    clientOrigin,
    publicOrigin: stripTrailingSlash(e.PUBLIC_ORIGIN || clientOrigin),
    oauth: {
      google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET },
    },
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    jwtExpiresIn: e.JWT_EXPIRES_IN,
    storageDriver: e.STORAGE_DRIVER,
    dataDir: path.resolve(SERVER_ROOT, e.DATA_DIR),
    uploadDir: path.resolve(SERVER_ROOT, e.UPLOAD_DIR),
    imageStorage: e.IMAGE_STORAGE,
    s3: {
      bucket: e.S3_BUCKET,
      region: s3Region,
      // "uploads" → "uploads/"; "" → bucket root
      prefix: e.S3_PREFIX ? e.S3_PREFIX.replace(/^\/+|\/+$/g, '') + '/' : '',
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
    },
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    mongodbUri,
    mongodbDbName: e.MONGODB_DB_NAME,
    rateLimit: { enabled: true },
    ...overrides,
  };
  return Object.freeze(config);
}
