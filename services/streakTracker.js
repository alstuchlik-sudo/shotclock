// SHOT-31: personal-best discipline streak. "A simple maximum over stored
// daily streak values collected so far is enough for the MTP" per the
// ticket's own notes, no separate all-time record system. Pure function:
// the caller supplies the immediately preceding day's own stored
// streak/personalBest (or null for a first-ever day) plus today's foul
// flag, and gets back today's streak and the updated personal best.
//
// This app has no persistent Account model or scheduler (see SHOT-23/29's
// own scope-downs), so "day" here means "the most recent Post-Game send
// for this session", not a deduplicated calendar day, generating several
// recaps back-to-back in one demo session is treated as several
// consecutive days, same on-demand-for-demo-purposes interpretation
// already applied throughout this pipeline.
function computeStreak(previous, todaysFoul) {
  const previousStreak = previous ? previous.streak : 0;
  const previousPersonalBest = previous ? previous.personalBest : 0;

  const streak = todaysFoul ? 0 : previousStreak + 1;
  const personalBest = Math.max(previousPersonalBest, streak);

  return { streak, personalBest };
}

module.exports = { computeStreak };
