# ShotClock

Your cTrader trading account, translated into a basketball scoreboard.

ShotClock turns raw account data (margin level, open positions, closed trades) into a
daily story a casual sports fan can read at a glance: a **shot clock** for time
pressure, a **foul** for broken risk discipline, and a **box score** for the day's
result — delivered as a morning **Pre-Match** briefing and an evening **Post-Game**
recap.

## Features

- **Connect** — link a cTrader account via the local cTrader Desktop MCP integration.
- **Pre-Match** — an on-demand morning report: shot clock, discipline, points, and an
  AI-narrated summary in an anticipatory "tip-off" tone.
- **Post-Game** — an on-demand evening recap: the same box score, today's closed
  trades, an evening-toned narration, and a personal-best foul-free streak.
- **One-tap feedback** — rate either briefing 1–5 (with optional text), or mute
  Post-Game, in a single tap.
- **Passive logging** — every send logs an open, its (real or nominal) generation
  cost, unsubscribe/mute events, and that day's trade and risk activity to one shared
  log, for reviewing usage after the fact rather than through a live dashboard.
- **About** — a brief in-app explainer page.

Demo Mode (see below) substitutes clearly-labeled simulated account data, so the app
is fully explorable without a real cTrader Desktop connection.

## Tech stack

- **Server**: Express.js
- **Database**: MongoDB + Mongoose
- **Views**: EJS, server-rendered, progressively enhanced with minimal vanilla JS
- **Sessions**: `express-session` + `connect-mongo` (no login system — the session
  itself is this app's user identity)
- **Tests**: Playwright, end-to-end only (`tests/e2e/`)
- **Deployment**: Vercel, via a GitHub Actions pipeline (version bump → test → deploy)

## Project structure

```
server.js           # app entry point, session/view setup, route mounting
routes/              # connect.js, prematch.js, postgame.js
models/              # ConnectionAttempt, PreMatchSend, PostGameSend, EventLog
services/             # ctraderMcp (MCP client), mappingEngine, narrator, streakTracker
views/                # EJS templates + partials
public/               # static CSS/JS
tests/e2e/            # Playwright specs, helpers/db.js, global-setup.js
```

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the example environment file and fill in real values:
   ```bash
   cp .env.example .env
   ```
   | Variable | Purpose |
   |---|---|
   | `MONGODB_URI` | MongoDB connection string |
   | `SESSION_SECRET` | Long random string for signing session cookies |
   | `CTRADER_MCP_URL` | Local cTrader Desktop MCP server URL |
   | `PORT` | Local port (defaults to 3000) |
   | `DEMO_MODE` | `true` to use simulated account data instead of a real MCP call |

3. Start the app:
   ```bash
   npm run dev
   ```

Running for real (`DEMO_MODE=false`) requires cTrader Desktop running locally with its
MCP server reachable at `CTRADER_MCP_URL`.

## Testing

```bash
npm run test:e2e
```

Runs the full Playwright suite against `BASE_URL` (defaults to `http://localhost:3000`)
and `MONGODB_URI`. The suite expects the app to already be running and reachable.

## Deployment

Pushing to `main` triggers the GitHub Actions pipeline (`.github/workflows/ci-cd.yml`):
bump the version, run the E2E suite against a fresh MongoDB service container, then
deploy to Vercel on green. Vercel project settings (env vars, org/project IDs) are
configured separately in the Vercel dashboard and GitHub repo secrets.
