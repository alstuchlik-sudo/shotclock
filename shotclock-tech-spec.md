# ShotClock Daily Loop — Technical Spec (MTP)

## Problem & Who It's For

Casual, sports-literate demo-account traders (persona: Marcus) have no daily ritual around checking risk, unlike checking fantasy sports scores. Two natural moments make that ritual: before the trading day, live exposure and margin, and after it, how discipline held up. Pre-Match and Post-Game together are the two-touchpoint daily habit loop the strategy's North Star metric (daily briefings opened) depends on. Neither stands alone as the product; Post-Game explicitly depends on Pre-Match's mapping engine to exist.

For: the MTP beta cohort (20-50 users, per the strategy's launch baseline).

## Scope

**In:**
- **Pre-Match (morning):** fixed local-time send (e.g. 8am); live snapshot via `get_balance`/`get_positions`; build the risk-to-stat mapping engine, the shared foundation both features run on; pre-match-toned AI narration; email/SMS delivery.
- **Post-Game (evening):** fixed local-time cutoff (e.g. 8pm); reconstruct the day's trades via `get_order_history`/`get_deals`, filtered client-side against that cutoff; personal-best streak = max of stored daily streak values; evening-toned AI narration, distinct from Pre-Match, referencing the personal best; email/SMS delivery.
- **Shared:** one tap-to-react feedback mechanism attached to both sends, replacing bespoke instrumentation per assumption; passive logging of opens, unsubscribes/mutes, generation cost, and trade/risk activity, reviewed manually after the fact instead of live dashboards, the trim needed to build this in one day.

**Out (deliberately, for now):**
- A/B cohort split and retention-lift comparison (Pre-Match-only vs. Pre-Match+Post-Game), deferred to the MLP
- In-app/push delivery, visual personal-best progress bar
- Real market-session/day-boundary detection (fixed cutoffs are enough to test the hypothesis)
- Actionable next-step content in Post-Game; notification preview good/bad signaling; long-term personal-best staleness handling
- Foul Trouble Alerts and any real-time monitoring
- League layer, monetization, commentator voice packs
- Migrating off the local desktop MCP, fine for demo scope

## How It Uses cTrader MCP

Server: local `ctrader-desktop` MCP (`127.0.0.1:9876`).

**Tools called:**
- `get_balance` / `get_positions` — Pre-Match's live snapshot (balance, equity, margin, open positions). Live-tested, confirmed working.
- `get_order_history` / `get_deals` — Post-Game's source for reconstructing the day's closed trades. Caveat: neither takes a date-range param; `get_order_history` returns "trades currently loaded in the repository," not a guaranteed complete log, so results are filtered client-side against the day boundary.

**Not used:** `get_account_statistics` — zero parameters, no date scoping, returned `available: false` when live-tested.

**AI agent vs. app**, same division for both features:
- **App (deterministic):** triggers both scheduled cutoffs, calls the relevant MCP tools, runs the shared mapping formulas once for both sends, computes and stores the personal-best streak, sends the messages, and logs opens, unsubscribes/mutes, generation cost, and trade/risk activity for later review.
- **AI agent (LLM):** narration only, one tone template per send. Takes the app's already-computed structured output as input and writes the text. It never calls MCP tools or decides what counts as "today", that stays app logic so the numbers stay trustworthy regardless of narration variance.

## Success Metrics

1. **Shared feedback + passive logs answer 14 of 15 Leap of Faith assumptions** — the one tap-to-react mechanism plus the passive logs (opens, mutes, cost, trade activity), reviewed weekly, cover everything except Post-Game's incremental retention lift.
2. **Daily open rate, whole cohort** — the North Star metric, tracked for both sends with no cohort split in the MTP; the A/B comparison against Pre-Match-only moves to the MLP.
