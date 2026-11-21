// Existing accounts retain their IDs, sessions, history and registered email.
export async function ensureIdentitySchema(sql) {
  const columns = await sql`SELECT table_name, column_name, is_nullable
    FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name IN ('users','registrations') AND column_name IN ('cms','institution')`;
  if (columns.filter(c => c.column_name === 'institution').length === 2 &&
      !columns.some(c => c.column_name === 'cms' && c.is_nullable === 'NO')) return;

  await sql`DO $migration$
  BEGIN
    PERFORM pg_advisory_xact_lock(20271122);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS institution text;
    ALTER TABLE registrations ADD COLUMN IF NOT EXISTS institution text;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='users' AND column_name='cms') THEN
      ALTER TABLE users ALTER COLUMN cms DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='registrations' AND column_name='cms') THEN
      ALTER TABLE registrations ALTER COLUMN cms DROP NOT NULL;
    END IF;
  END $migration$`;
}
