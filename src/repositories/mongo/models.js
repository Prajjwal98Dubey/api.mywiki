import { Schema } from 'mongoose';

const { Mixed } = Schema.Types;

// UUIDs from the app are stored as `_id` (string), so ids survive a JSON → Mongo migration.
// Content fields are Mixed: they are validated by zod before they get here, and Mixed stores
// them exactly as given (key order included), which the null-edit comparison relies on.
// Dates stay ISO-8601 strings, as in the spec; they sort correctly as strings.
const options = (collection) => ({
  collection,
  versionKey: false,
  minimize: false,
  id: false,
  strict: true,
});

const userSchema = new Schema(
  {
    _id: String,
    username: String,
    email: String,
    passwordHash: String, // null for accounts created through an external provider
    createdAt: String,
    // internal, never returned
    emailLower: String,
    usernameLower: String,
  },
  options('users'),
);
userSchema.index({ emailLower: 1 }, { unique: true });
userSchema.index({ usernameLower: 1 }, { unique: true });

const pageSchema = new Schema(
  {
    _id: String,
    slug: String,
    ownerId: String,
    visibility: String, // "public" | "unlisted"; missing on older docs = "public"
    title: String,
    shortDescription: String,
    infobox: Mixed,
    lead: String,
    sections: Mixed,
    references: Mixed,
    seeAlso: Mixed,
    externalLinks: Mixed,
    categories: Mixed,
    currentRevisionId: String,
    revisionCount: Number,
    createdAt: String,
    updatedAt: String,
    // internal, never returned
    slugKey: String,
    plainText: String, // lead + sections + infobox values without markup, for search pre-filtering
  },
  options('pages'),
);
pageSchema.index({ slugKey: 1 }, { unique: true });
pageSchema.index({ ownerId: 1, updatedAt: -1 });
pageSchema.index({ createdAt: -1 });
pageSchema.index({ visibility: 1, createdAt: -1 }); // explore: discoverable pages, newest first
pageSchema.index({ updatedAt: -1 });

const revisionSchema = new Schema(
  {
    _id: String,
    pageId: String,
    revNumber: Number,
    authorId: String,
    authorUsername: String,
    editSummary: String,
    size: Number,
    sizeDelta: Number,
    snapshot: Mixed,
    createdAt: String,
  },
  options('revisions'),
);
revisionSchema.index({ pageId: 1, revNumber: -1 }, { unique: true });

// External sign-in identities (Google today). One user can have several.
const identitySchema = new Schema(
  {
    _id: String,
    userId: String,
    provider: String, // "google"
    providerUserId: String, // the provider's stable user id ("sub")
    email: String, // as last reported by the provider
    createdAt: String,
    lastLoginAt: String,
  },
  options('identities'),
);
identitySchema.index({ provider: 1, providerUserId: 1 }, { unique: true });
identitySchema.index({ userId: 1 });

export function defineModels(conn) {
  return {
    User: conn.model('User', userSchema),
    Page: conn.model('Page', pageSchema),
    Revision: conn.model('Revision', revisionSchema),
    Identity: conn.model('Identity', identitySchema),
  };
}
