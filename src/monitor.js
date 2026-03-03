const cron = require('node-cron');
const dns = require('dns').promises;
const { pool } = require('./db');

const GOOD_HTTP_STATUSES = new Set([200, 301, 302]);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 10000);
const MONITOR_CONCURRENCY = Math.max(1, Number(process.env.MONITOR_CONCURRENCY || 20));
const DOWN_AFTER_CONSECUTIVE_FAILURES = Math.max(
  1,
  Number(process.env.DOWN_AFTER_CONSECUTIVE_FAILURES || 2)
);
const MONITOR_RETRY_ATTEMPTS = Math.max(0, Number(process.env.MONITOR_RETRY_ATTEMPTS || 1));
const MONITOR_RETRY_DELAY_MS = Math.max(0, Number(process.env.MONITOR_RETRY_DELAY_MS || 500));

let cycleInProgress = false;

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function checkOneLink(link) {
  const outcome = await checkWithRetry(link);
  await persistOutcome(link.id, outcome);
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function performSingleCheck(link) {
  const hostname = extractHostname(link.url);
  if (!hostname) {
    return { ok: false, error: 'Invalid URL' };
  }

  try {
    await dns.lookup(hostname);
  } catch (dnsError) {
    return { ok: false, error: `DNS lookup failed: ${dnsError.message}` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(link.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });

    if (GOOD_HTTP_STATUSES.has(response.status)) {
      return { ok: true, status: 'healthy', error: null };
    }

    return {
      ok: true,
      status: 'warning',
      error: `Unexpected HTTP status: ${response.status}`
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkWithRetry(link) {
  let lastFailure = null;

  for (let attempt = 0; attempt <= MONITOR_RETRY_ATTEMPTS; attempt += 1) {
    const outcome = await performSingleCheck(link);
    if (outcome.ok) {
      return outcome;
    }

    lastFailure = outcome;

    if (attempt < MONITOR_RETRY_ATTEMPTS && MONITOR_RETRY_DELAY_MS > 0) {
      await sleep(MONITOR_RETRY_DELAY_MS);
    }
  }

  return lastFailure || { ok: false, error: 'Unknown monitor error' };
}

async function persistOutcome(linkId, outcome) {
  const now = new Date();

  if (outcome.ok) {
    await pool.query(
      `
        UPDATE links
        SET status = $1,
            last_checked = $2,
            last_error = $3,
            consecutive_failures = 0
        WHERE id = $4
      `,
      [outcome.status, now, outcome.error, linkId]
    );
    return;
  }

  await pool.query(
    `
      UPDATE links
      SET consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
          status = CASE
            WHEN COALESCE(consecutive_failures, 0) + 1 >= $4 THEN 'down'
            ELSE 'warning'
          END,
          last_checked = $2,
          last_error = $3
      WHERE id = $1
    `,
    [linkId, now, outcome.error, DOWN_AFTER_CONSECUTIVE_FAILURES]
  );
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  const runners = Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;

      try {
        await worker(current);
      } catch (error) {
        console.error(`Worker failed for link id=${current.id}:`, error);
      }
    }
  });

  await Promise.all(runners);
}

async function runMonitorCycle() {
  if (cycleInProgress) {
    console.log('Monitor cycle skipped: previous cycle still running.');
    return;
  }

  cycleInProgress = true;

  try {
    const result = await pool.query('SELECT id, url FROM links ORDER BY id ASC');
    const links = result.rows;

    await runWithConcurrency(links, MONITOR_CONCURRENCY, checkOneLink);

    console.log(
      `Monitor cycle complete. Checked ${links.length} link(s), concurrency=${MONITOR_CONCURRENCY}.`
    );
  } catch (error) {
    console.error('Monitor cycle failed:', error);
  } finally {
    cycleInProgress = false;
  }
}

function startMonitoring() {
  cron.schedule('*/5 * * * *', async () => {
    await runMonitorCycle();
  });

  runMonitorCycle().catch((error) => {
    console.error('Initial monitor cycle failed:', error);
  });

  console.log('Monitoring scheduler started (every 5 minutes).');
}

module.exports = {
  startMonitoring,
  runMonitorCycle
};
