// Translates raw cTrader account data into ShotClock's basketball metaphor:
// a shot clock (time pressure), a foul (risk-rule break), and a box score
// (today's stat line). Pure function, no I/O, so it's testable in
// isolation from the MCP integration and reused unchanged by Post-Game.

// 150% margin level is a common industry reference point for a margin-call
// warning zone across retail brokers. Below it counts as a foul (elevated
// risk), at or above it is safe. The AC only specifies "above/below a
// threshold", this constant is where the actual number got decided.
const RISK_THRESHOLD_MARGIN_LEVEL = 150;
const SHOT_CLOCK_MAX_SECONDS = 24;

// SHOT-30: `trades` (already filtered to today, see filterTradesForToday
// below) becomes its own tradesToday figure, deliberately NOT blended into
// `points`. `points` is balance.netProfit, cTrader's floating P&L on open
// positions, a completely different thing from the realized P&L of trades
// that already closed today, conflating the two would misrepresent both.
// Defaults to [] so Pre-Match's existing call site (no trades to report
// before the day has any) is unaffected, same formula, same shape either way.
function mapToBoxScore({ balance, positions, trades = [] }) {
  const marginLevel = balance.marginLevel;
  const exposure = (positions || []).reduce(
    (sum, p) => sum + Math.abs(p.volumeInLots || 0),
    0
  );
  const points = balance.netProfit || 0;
  const tradesToday = {
    count: trades.length,
    realizedProfit: Math.round(trades.reduce((sum, t) => sum + (t.profit || 0), 0) * 100) / 100,
  };

  // Zero open positions means no margin is in use at all. cTrader reports
  // marginLevel as null in exactly this case (confirmed live against the
  // real MCP server, see services/ctraderMcp.js), the safest possible
  // state: full shot clock, no foul, matching AC3 directly.
  if (marginLevel == null) {
    return {
      shotClockSeconds: SHOT_CLOCK_MAX_SECONDS,
      foul: false,
      boxScore: { points, exposure: 0, marginLevel: null, tradesToday },
    };
  }

  const foul = marginLevel < RISK_THRESHOLD_MARGIN_LEVEL;

  // Half the max clock sits exactly at the threshold, so crossing it always
  // crosses the halfway point too, above trends toward the full 24s (AC1,
  // low pressure), below trends toward 0s (AC2, high pressure).
  const shotClockSeconds = Math.max(
    0,
    Math.min(
      SHOT_CLOCK_MAX_SECONDS,
      Math.round((marginLevel / RISK_THRESHOLD_MARGIN_LEVEL) * (SHOT_CLOCK_MAX_SECONDS / 2))
    )
  );

  return {
    shotClockSeconds,
    foul,
    boxScore: {
      points,
      exposure: Math.round(exposure * 100) / 100,
      marginLevel,
      tradesToday,
    },
  };
}

// SHOT-30: neither get_order_history nor get_deals takes a date-range
// parameter (per the ticket's own notes), so "today" is reconstructed
// client-side: a trade counts as today if its closedAt falls on the same
// calendar date as `referenceDate` *in the given timezone*. Comparing
// formatted date strings (rather than computing an exact UTC midnight
// instant) sidesteps DST/offset arithmetic entirely while still being
// exactly right, en-CA formats as YYYY-MM-DD so it's a plain string
// comparison. Trades missing/with an unparseable closedAt are excluded
// rather than guessed into today, so malformed data can't inflate the count.
function filterTradesForToday(trades, timezone, referenceDate = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  const today = fmt.format(referenceDate);
  return (trades || []).filter((t) => {
    if (!t.closedAt) return false;
    const closedDate = new Date(t.closedAt);
    if (Number.isNaN(closedDate.getTime())) return false;
    return fmt.format(closedDate) === today;
  });
}

module.exports = {
  mapToBoxScore,
  filterTradesForToday,
  RISK_THRESHOLD_MARGIN_LEVEL,
  SHOT_CLOCK_MAX_SECONDS,
};
