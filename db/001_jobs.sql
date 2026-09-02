CREATE TABLE IF NOT EXISTS plow_jobs (
  id TEXT PRIMARY KEY,
  owner_token_hash TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'active', 'submitted', 'completed', 'rejected', 'expired', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  job JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS plow_jobs_owner_updated_idx
  ON plow_jobs (owner_token_hash, updated_at DESC);
