const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

function resolveSslConfig(connectionString) {
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
  if (sslMode === 'disable') {
    return false;
  }

  if (!connectionString) {
    // Local/default pg settings should not force SSL.
    return false;
  }

  try {
    const parsed = new URL(connectionString);
    const host = (parsed.hostname || '').toLowerCase();
    const urlSslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();

    if (urlSslMode === 'disable') {
      return false;
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      return false;
    }
  } catch (error) {
    console.warn('Unable to parse DATABASE_URL for SSL detection:', error.message);
  }

  // Fly Postgres and most hosted Postgres providers require SSL.
  return { rejectUnauthorized: false };
}

if (!databaseUrl && !process.env.PGHOST) {
  console.warn(
    'No DATABASE_URL/PGHOST found. Set DATABASE_URL (or PG* vars) before starting the server.'
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: resolveSslConfig(databaseUrl)
});

async function initDb() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'unknown',
      last_checked TIMESTAMP,
      last_error TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const addConsecutiveFailuresColumnQuery = `
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0;
  `;

  const dedupeQuery = `
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY url ORDER BY id ASC) AS row_num
      FROM links
    )
    DELETE FROM links
    WHERE id IN (
      SELECT id
      FROM ranked
      WHERE row_num > 1
    );
  `;

  const createUniqueIndexQuery = `
    CREATE UNIQUE INDEX IF NOT EXISTS links_url_unique_idx
    ON links (url);
  `;

  await pool.query(createTableQuery);
  await pool.query(addConsecutiveFailuresColumnQuery);
  await pool.query(dedupeQuery);
  await pool.query(createUniqueIndexQuery);
}

module.exports = {
  pool,
  initDb
};
