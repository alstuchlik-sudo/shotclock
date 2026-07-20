const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const PostGameSend = require('../models/PostGameSend');
const ctraderMcp = require('../services/ctraderMcp');
const mappingEngine = require('../services/mappingEngine');
const narrator = require('../services/narrator');

const isDemoMode = () => process.env.DEMO_MODE === 'true';

const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

router.get('/post-game', (req, res) => {
  if (!req.session.connectedAccount) {
    return res.redirect('/connect');
  }
  res.render('post-game', { timezones: TIMEZONES, report: null, error: null });
});

// SHOT-29, scoped down the same way SHOT-23 scoped Pre-Match: the literal AC
// describes the system autonomously detecting each account's local 8pm and
// firing Post-Game on its own, which needs a persistent Account model plus a
// scheduler (Vercel Cron) checking every connected account's timezone,
// neither of which exist. Per explicit product direction, this instead
// mirrors Pre-Match's on-demand model exactly: a "Get my Post-Game recap"
// CTA the user taps themselves, with no real gating on whether it's
// actually past 8pm in the timezone they pick. AC2 (each account gets its
// own local time, not one shared UTC time) is still demonstrable, just
// manually: the timezone picker and localTimeAtSend formatting are the same
// per-timezone-aware code Pre-Match already uses, generating two recaps
// with two different timezones selected produces two different local times.
router.post(
  '/post-game',
  asyncHandler(async (req, res) => {
    if (!req.session.connectedAccount) {
      return res.redirect('/connect');
    }

    const timezone = req.body.timezone;
    if (!timezone || !TIMEZONES.includes(timezone)) {
      return res.render('post-game', {
        timezones: TIMEZONES,
        report: null,
        error: 'Choose a valid timezone from the list.',
      });
    }

    const localTimeAtSend = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());

    try {
      // Same demo-mode-only test hooks as Pre-Match (see routes/prematch.js),
      // never consulted outside demo mode.
      if (isDemoMode() && req.query.scenario === 'job-error') {
        throw new Error('Simulated Post-Game job failure (test hook)');
      }
      const useEmptyPositions = isDemoMode() && req.query.scenario === 'empty-positions';
      const useLowMargin = isDemoMode() && req.query.scenario === 'low-margin';
      // Reuses ctraderMcp's balance/positions fetch as-is: a Post-Game recap
      // and a Pre-Match report need the same underlying account snapshot,
      // just narrated differently, so there's no separate real-data call to
      // write here.
      const { balance, positions } = isDemoMode()
        ? {
            balance: useLowMargin
              ? { ...ctraderMcp.getMockBalance(), marginLevel: 75, netProfit: -200 }
              : ctraderMcp.getMockBalance(),
            positions: useEmptyPositions ? [] : ctraderMcp.getMockPositions(),
          }
        : await ctraderMcp.getPreMatchData();

      // Same mapping engine as Pre-Match, unchanged (see services/mappingEngine.js).
      const mapped = mappingEngine.mapToBoxScore({ balance, positions });

      // Post-Game's own evening-recap narration template, distinct from
      // Pre-Match's tip-off template (see services/narrator.js).
      const narration = narrator.narratePostGame(mapped);

      await PostGameSend.create({
        sessionId: req.sessionID,
        timezone,
        localTimeAtSend,
        status: 'success',
        brokerName: balance.brokerName,
        accountType: balance.accountType,
        traderId: balance.traderId,
        depositAsset: balance.depositAsset,
        balance: balance.balance,
        margin: balance.margin,
        positions,
        shotClockSeconds: mapped.shotClockSeconds,
        foul: mapped.foul,
        points: mapped.boxScore.points,
        exposure: mapped.boxScore.exposure,
        narration: narration.text,
        narrationTemplateId: narration.templateId,
      });

      res.render('post-game', {
        timezones: TIMEZONES,
        error: null,
        report: { account: balance, positions, timezone, localTimeAtSend, mapped, narration },
      });
    } catch (err) {
      await PostGameSend.create({
        sessionId: req.sessionID,
        timezone,
        localTimeAtSend,
        status: 'failed',
        errorReason: err.message,
      });

      res.render('post-game', {
        timezones: TIMEZONES,
        report: null,
        error: `Couldn't generate the Post-Game recap. (${err.message})`,
      });
    }
  })
);

module.exports = router;
