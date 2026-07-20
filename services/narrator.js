// Builds the Pre-Match narration: an AI-agent-styled summary of the morning's
// computed box score, in the anticipatory "tip-off" tone of a game preview,
// not the evening recap tone Post-Game will eventually use. Every value is
// interpolated directly from the mapped box score, never invented by the
// template itself, satisfying AC1's "no invented numbers" requirement
// structurally rather than by trusting an external model's output.
const PRE_MATCH_TEMPLATE_ID = 'pre-match-v1';

function narratePreMatch(mapped) {
  const { shotClockSeconds, foul, boxScore } = mapped;
  const { points, exposure, marginLevel } = boxScore;

  const pointsPhrase = points >= 0 ? `up ${points}` : `down ${Math.abs(points)}`;
  const marginPhrase = marginLevel != null ? `a ${marginLevel}% margin level` : 'no margin in play yet';
  const disciplinePhrase = foul
    ? `Foul on the board, ${marginPhrase} puts you inside the risk zone`
    : `No fouls called, ${marginPhrase} keeps you clear`;

  const text =
    `Tip-off. Shot clock's at ${shotClockSeconds} seconds heading into your session. ` +
    `${disciplinePhrase}. You're carrying ${exposure} lots of exposure and sitting ${pointsPhrase} on the board. ` +
    `Get set, the clock starts now.`;

  return { templateId: PRE_MATCH_TEMPLATE_ID, text };
}

// SHOT-29: Post-Game's evening recap tone, "final buzzer" framing instead of
// Pre-Match's "tip-off" anticipation. Same mapped box score, same
// no-invented-numbers guarantee, a distinct template id so AC2 of SHOT-26
// ("uses the pre-match template, not Post-Game's") is checkable both ways
// now that a real Post-Game template exists to compare against.
const POST_GAME_TEMPLATE_ID = 'post-game-v1';

// SHOT-32: narrates today's result against the personal-best streak
// (services/streakTracker.js). `streakInfo` is required, not defaulted,
// since Post-Game always computes it before narrating (see
// routes/postgame.js) and a silently-defaulted 0/0 here could misreport a
// real streak as "no record" if the caller ever forgot to pass it.
function narratePostGame(mapped, streakInfo) {
  const { shotClockSeconds, foul, boxScore } = mapped;
  const { points, exposure, marginLevel } = boxScore;
  const { streak, personalBest } = streakInfo;

  const pointsPhrase = points >= 0 ? `up ${points}` : `down ${Math.abs(points)}`;
  const marginPhrase = marginLevel != null ? `a ${marginLevel}% margin level` : 'no margin left in play';
  const disciplinePhrase = foul
    ? `You picked up a foul along the way, ${marginPhrase} at the buzzer`
    : `No fouls on the day, ${marginPhrase} at the buzzer`;

  const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;
  const gap = personalBest - streak;
  const streakPhrase =
    streak > 0 && streak === personalBest
      ? `Tonight sets a new personal best, ${dayWord(streak)} foul-free`
      : streak > 0
        ? `That's ${dayWord(streak)} foul-free, ${dayWord(gap)} short of your personal best of ${personalBest}`
        : `Personal best holds at ${personalBest} after tonight's foul`;

  const text =
    `Final buzzer. You closed the day with ${shotClockSeconds} seconds still on the clock. ` +
    `${disciplinePhrase}. You finished carrying ${exposure} lots of exposure, ${pointsPhrase} on the final score. ` +
    `${streakPhrase}. That's the recap, see you back for tip-off tomorrow.`;

  return { templateId: POST_GAME_TEMPLATE_ID, text };
}

module.exports = { narratePreMatch, PRE_MATCH_TEMPLATE_ID, narratePostGame, POST_GAME_TEMPLATE_ID };
