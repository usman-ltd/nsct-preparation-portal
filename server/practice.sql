CREATE TABLE IF NOT EXISTS practice_usage (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 counts jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS student_activity (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
