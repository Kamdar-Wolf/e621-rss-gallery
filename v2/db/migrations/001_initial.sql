CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reader_users (
  id UUID PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS feeds (
  id UUID PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  last_success_at TIMESTAMPTZ,
  next_poll_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  feed_id UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  title_override TEXT,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,feed_id)
);
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY,
  feed_id UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  source_guid TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  summary TEXT,
  sanitized_html TEXT,
  media_type TEXT NOT NULL DEFAULT 'article',
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(feed_id,source_guid)
);
CREATE TABLE IF NOT EXISTS entry_media (
  id UUID PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  stored_key TEXT,
  mime_type TEXT,
  kind TEXT NOT NULL DEFAULT 'image',
  width INTEGER,
  height INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entry_id,source_url)
);
CREATE TABLE IF NOT EXISTS entry_states (
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  starred_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id,entry_id)
);
CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(user_id,name)
);
CREATE TABLE IF NOT EXISTS entry_labels (
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(entry_id,label_id)
);
CREATE TABLE IF NOT EXISTS entry_notes (
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,entry_id)
);
CREATE INDEX IF NOT EXISTS entries_timeline_idx ON entries(feed_id,published_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS entries_publication_idx ON entries(published_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS subscriptions_owner_idx ON subscriptions(user_id,folder_id);
CREATE INDEX IF NOT EXISTS entry_states_recent_idx ON entry_states(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS entries_fts_idx ON entries USING GIN (
  to_tsvector('simple', COALESCE(title,'') || ' ' || COALESCE(summary,''))
);
