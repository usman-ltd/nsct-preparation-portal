BEGIN;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL, cms text NOT NULL UNIQUE CHECK(cms=upper(cms)),
 email text NOT NULL UNIQUE CHECK(email=lower(email)), password_hash text NOT NULL,
 admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
-- Verified users are promoted atomically from expiring registration challenges.
CREATE TABLE IF NOT EXISTS registrations (
 token_hash text PRIMARY KEY, name text NOT NULL, cms text NOT NULL,
 email text NOT NULL, password_hash text NOT NULL, code_hash text NOT NULL,
 code_expires_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 tries integer NOT NULL DEFAULT 0, sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registrations_expiry ON registrations(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_limits (
 key_hash text PRIMARY KEY, hits integer NOT NULL, until_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limits_expiry ON auth_limits(until_at);
CREATE TABLE IF NOT EXISTS attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state jsonb NOT NULL, version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_owner_date ON attempts(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS question_overrides (question_id text PRIMARY KEY, disabled boolean NOT NULL DEFAULT false);
COMMIT;
