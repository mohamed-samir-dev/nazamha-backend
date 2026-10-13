import mongoose, { Schema, Document } from "mongoose";

// ── TokenBlacklist ────────────────────────────────────────────────────────────
// MongoDB fallback store for revoked JWTs.
// Used when Redis is unavailable.
// We store the SHA-256 hash of the raw token — never the token itself.
// The TTL index auto-deletes documents when expires_at is reached, so the
// collection never grows unboundedly.

export interface ITokenBlacklist extends Document {
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

const TokenBlacklistSchema = new Schema<ITokenBlacklist>(
  {
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

TokenBlacklistSchema.index({ token_hash: 1 }, { unique: true });
// MongoDB TTL index: document is automatically removed when expires_at is reached
TokenBlacklistSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const TokenBlacklist = mongoose.model<ITokenBlacklist>(
  "TokenBlacklist",
  TokenBlacklistSchema
);
