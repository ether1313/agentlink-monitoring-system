require('dotenv').config();

const express = require('express');
const path = require('path');
const { pool, initDb } = require('./src/db');
const { startMonitoring } = require('./src/monitor');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const URL_PROBE_TIMEOUT_MS = Number(process.env.URL_PROBE_TIMEOUT_MS || 6000);

const LINK_CATEGORIES = [
  'ipay9', 'kingbet9', 'bigpay77', 'me99', 'rolex9', 'gucci9', 'bybid9',
  'mrbean9', 'pkm9', 'queen13', 'micky9', 'winnie777', 'ace96au'
];

function isValidCategory(value) {
  return value && LINK_CATEGORIES.includes(String(value).toLowerCase());
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasHttpProtocol(value) {
  return /^https?:\/\//i.test(value);
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_PROBE_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePreferredUrl(rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) {
    return { ok: false, reason: 'empty' };
  }

  if (hasHttpProtocol(input)) {
    if (!isValidHttpUrl(input)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, url: input };
  }

  // No protocol: prefer https, fallback to http when needed.
  const httpsCandidate = `https://${input}`;
  if (!isValidHttpUrl(httpsCandidate)) {
    return { ok: false, reason: 'invalid' };
  }

  if (await probeUrl(httpsCandidate)) {
    return { ok: true, url: httpsCandidate };
  }

  const httpCandidate = `http://${input}`;
  if (await probeUrl(httpCandidate)) {
    return { ok: true, url: httpCandidate };
  }

  return { ok: false, reason: 'unreachable' };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/links', async (req, res) => {
  try {
    const category = req.query.category;
    const status = req.query.status;

    let query = 'SELECT * FROM links WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (category && category !== 'all') {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex += 1;
    }
    if (status && status !== 'all' && ['healthy', 'down', 'warning', 'unknown'].includes(status)) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    query += ' ORDER BY id DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('GET /links failed:', error);
    res.status(500).json({ error: 'Failed to fetch links' });
  }
});

app.get('/links/categories', (_req, res) => {
  res.json(LINK_CATEGORIES);
});

app.post('/links', async (req, res) => {
  const { url, note, category } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'category is required and must be one of: ' + LINK_CATEGORIES.join(', ') });
  }

  const resolved = await resolvePreferredUrl(url);
  if (!resolved.ok) {
    return res.status(400).json({
      error:
        resolved.reason === 'invalid'
          ? 'url must be a valid link'
          : 'Unable to reach URL with https first, then http fallback'
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO links (url, note, category, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (url) DO NOTHING
      RETURNING *
      `,
      [resolved.url, note || null, category, 'unknown']
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'URL already exists' });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('POST /links failed:', error);
    return res.status(500).json({ error: 'Failed to create link' });
  }
});

app.post('/links/bulk', async (req, res) => {
  const { urls, note, category } = req.body || {};

  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'urls must be an array' });
  }
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'category is required and must be one of: ' + LINK_CATEGORIES.join(', ') });
  }

  const cleanedUrls = [...new Set(urls.map((item) => String(item || '').trim()).filter(Boolean))];

  if (cleanedUrls.length === 0) {
    return res.status(400).json({ error: 'At least one url is required' });
  }

  const resolvedUrls = [];
  const invalidUrls = [];
  const unresolvedUrls = [];

  for (const rawUrl of cleanedUrls) {
    const resolved = await resolvePreferredUrl(rawUrl);

    if (!resolved.ok) {
      if (resolved.reason === 'invalid') {
        invalidUrls.push(rawUrl);
      } else {
        unresolvedUrls.push(rawUrl);
      }
      continue;
    }

    resolvedUrls.push(resolved.url);
  }

  const dedupedResolvedUrls = [...new Set(resolvedUrls)];
  if (dedupedResolvedUrls.length === 0) {
    return res.status(400).json({
      error: 'No valid and reachable URLs were provided',
      invalidUrls,
      unresolvedUrls
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO links (url, note, category, status)
      SELECT input.url, $2, $3, 'unknown'
      FROM unnest($1::text[]) AS input(url)
      ON CONFLICT (url) DO NOTHING
      RETURNING *
      `,
      [dedupedResolvedUrls, note || null, category]
    );

    const created = result.rows.length;
    const skipped = dedupedResolvedUrls.length - created;

    return res.status(201).json({
      created,
      skipped,
      invalidUrls,
      unresolvedUrls,
      links: result.rows
    });
  } catch (error) {
    console.error('POST /links/bulk failed:', error);
    return res.status(500).json({ error: 'Failed to create links' });
  }
});

app.put('/links/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { url, note, category } = req.body || {};

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid link id' });
  }

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (category !== undefined && !isValidCategory(category)) {
    return res.status(400).json({ error: 'category must be one of: ' + LINK_CATEGORIES.join(', ') });
  }

  try {
    const result = await pool.query(
      `
      UPDATE links
      SET url = $1,
          note = $2,
          category = COALESCE($4, category)
      WHERE id = $3
      RETURNING *
      `,
      [url, note || null, id, category || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'URL already exists' });
    }

    console.error('PUT /links/:id failed:', error);
    return res.status(500).json({ error: 'Failed to update link' });
  }
});

app.post('/links/:id/checked', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid link id' });
  }

  try {
    const result = await pool.query(
      `
      UPDATE links
      SET status = 'healthy',
          last_error = NULL,
          consecutive_failures = 0,
          last_checked = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('POST /links/:id/checked failed:', error);
    return res.status(500).json({ error: 'Failed to mark link as checked' });
  }
});

app.delete('/links/:id', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid link id' });
  }

  try {
    const result = await pool.query('DELETE FROM links WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /links/:id failed:', error);
    return res.status(500).json({ error: 'Failed to delete link' });
  }
});

async function bootstrap() {
  try {
    await initDb();
    startMonitoring();

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Application startup failed:', error);
    process.exit(1);
  }
}

bootstrap();
