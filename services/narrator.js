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

module.exports = { narratePreMatch, PRE_MATCH_TEMPLATE_ID };
