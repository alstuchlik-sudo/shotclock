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

function mapToBoxScore({ balance, positions }) {
  const marginLevel = balance.marginLevel;
  const exposure = (positions || []).reduce(
    (sum, p) => sum + Math.abs(p.volumeInLots || 0),
    0
  );
  const points = balance.netProfit || 0;

  // Zero open positions means no margin is in use at all. cTrader reports
  // marginLevel as null in exactly this case (confirmed live against the
  // real MCP server, see services/ctraderMcp.js), the safest possible
  // state: full shot clock, no foul, matching AC3 directly.
  if (marginLevel == null) {
    return {
      shotClockSeconds: SHOT_CLOCK_MAX_SECONDS,
      foul: false,
      boxScore: { points, exposure: 0, marginLevel: null },
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
    },
  };
}

module.exports = { mapToBoxScore, RISK_THRESHOLD_MARGIN_LEVEL, SHOT_CLOCK_MAX_SECONDS };
