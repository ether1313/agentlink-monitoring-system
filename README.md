# Agent Link Monitoring System

Simple agent link monitoring system using:

- Node.js
- Express
- Fly Postgres
- node-cron
- Plain HTML/CSS/JS dashboard

## Project structure

- `server.js` - Express server and REST API routes
- `src/db.js` - Postgres connection and table initialization
- `src/monitor.js` - Monitoring scheduler and link checks (DNS + HTTP)
- `public/index.html` - Dashboard UI
- `public/app.js` - Dashboard behavior (render, fetch, alert, alarm)
- `public/styles.css` - Dashboard styling
- `Dockerfile` - Container image for deployment
- `fly.toml` - Fly.io app configuration

## Database table

The app creates this table automatically at startup:

- `id` (serial primary key)
- `url` (text)
- `note` (text)
- `status` (text)
- `last_checked` (timestamp)
- `last_error` (text)
- `created_at` (timestamp default now())

## API endpoints

- `GET /links`
- `POST /links`
- `PUT /links/:id`
- `DELETE /links/:id`

## Local run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp env.example .env
   ```
3. Set your `DATABASE_URL` in `.env` (for local non-SSL Postgres, keep `PGSSLMODE=disable`)
4. Start app:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000`

## Monitoring behavior

- Runs every 5 minutes (`node-cron`)
- For each link:
  - Extracts domain from URL
  - Performs DNS lookup
  - If DNS fails -> marks as `down`
  - Performs HTTP fetch with timeout
  - If HTTP status is not `200`, `301`, or `302` -> marks as `warning`
- Updates `status`, `last_checked`, and `last_error`
- Logs failures without crashing the scheduler

## Fly.io deployment

### A) One-time prerequisites

1. Install Fly CLI  
   https://fly.io/docs/flyctl/install/
2. Login:
   ```bash
   fly auth login
   ```
3. In this project folder, confirm the app name in `fly.toml`:
   - `app = "agent-link-monitor"`
   - If this name is already taken globally, change it to a unique name (for example `agent-link-monitor-<yourname>`).

### B) Create infrastructure (first deployment only)

1. Create app:
   ```bash
   fly apps create agent-link-monitor
   ```
2. Create Fly Postgres in `sin`:
   ```bash
   fly postgres create --name agent-monitor-db --region sin
   ```
3. Attach Postgres to app (auto-sets `DATABASE_URL` secret):
   ```bash
   fly postgres attach --app agent-link-monitor agent-monitor-db
   ```
4. (Optional) Force SSL mode in secret:
   ```bash
   fly secrets set PGSSLMODE=require --app agent-link-monitor
   ```

### C) Deploy application

```bash
fly deploy
```

### D) Keep cron running 24/7 (important)

Use a single always-on machine so `node-cron` does not pause or run twice:

```bash
fly scale count 1 --app agent-link-monitor
```

### E) Post-deploy checks

1. Check service state:
   ```bash
   fly status --app agent-link-monitor
   fly machine list --app agent-link-monitor
   ```
2. Check logs:
   ```bash
   fly logs --app agent-link-monitor
   ```
3. Open site:
   ```bash
   fly open --app agent-link-monitor
   ```
4. Health endpoint:
   - `https://<your-app>.fly.dev/health`

### F) If app/database already exists

Run only:

```bash
fly auth login
fly postgres attach --app agent-link-monitor agent-monitor-db
fly deploy
fly scale count 1 --app agent-link-monitor
fly status --app agent-link-monitor
```

### G) Common failure fixes

- `No access token available` -> run `fly auth login`
- `Could not find App` -> create app or fix app name in `fly.toml`
- `DATABASE_URL missing` -> run `fly postgres attach ...` again
- `App started but no cron effect` -> make sure machine count is `1`

## Notes

- The dashboard attempts to play `/alarm.mp3` when at least one link is `down`.
- Add your own `public/alarm.mp3` file for the alarm sound used in browsers.
