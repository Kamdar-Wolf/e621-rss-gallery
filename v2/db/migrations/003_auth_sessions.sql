ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE TABLE IF NOT EXISTS reader_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reader_sessions_user_idx ON reader_sessions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS reader_sessions_expiry_idx ON reader_sessions(expires_at)
  WHERE revoked_at IS NULL;
