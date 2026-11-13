-- Initial schema (PostgreSQL >= 15); applied once by migrate.ts.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (length(email) <= 254),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'Nový kanál',
  description text,
  etag text,
  last_modified text,
  next_fetch_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz,
  last_error text,
  failure_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','ok','error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_feeds_due ON feeds(next_fetch_at);
CREATE TABLE folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE subscriptions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_id uuid NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  title_override text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feed_id)
);
CREATE TABLE entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid text NOT NULL,
  title text NOT NULL,
  link text,
  author text,
  summary text,
  image_url text,
  media_type text NOT NULL DEFAULT 'article',
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feed_id, guid)
);
CREATE INDEX idx_entries_feed_date ON entries(feed_id, published_at DESC, id DESC);
CREATE INDEX idx_entries_search ON entries USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,'')));
CREATE TABLE entry_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  is_saved boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_id)
);
CREATE TABLE sync_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_user_cursor ON sync_events(user_id, id);
CREATE TABLE fetch_runs (
  id bigserial PRIMARY KEY,
  feed_id uuid NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  status text NOT NULL,
  details text,
  entry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
