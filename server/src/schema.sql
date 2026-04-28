CREATE TABLE IF NOT EXISTS lobbies (
  code TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  host_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  lobby_code TEXT NOT NULL REFERENCES lobbies(code) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  x_handle TEXT,
  color TEXT,
  pfp_data_url TEXT,
  assist_user_id TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lobby_code, id)
);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL REFERENCES lobbies(code) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_lobby ON chat(lobby_code, created_at);

CREATE TABLE IF NOT EXISTS clip_ranges (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL REFERENCES lobbies(code) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ranges_lobby ON clip_ranges(lobby_code, updated_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL REFERENCES lobbies(code) ON DELETE CASCADE,
  type TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  range_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending
  ON deliveries(lobby_code, to_user_id, delivered, created_at);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL REFERENCES lobbies(code) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS transcript_chunks (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  t_start REAL NOT NULL,
  t_end REAL NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_transcript
  ON transcript_chunks(transcript_id, t_start);
