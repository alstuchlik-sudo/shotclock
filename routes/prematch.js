const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const PreMatchSend = require('../models/PreMatchSend');
const ctraderMcp = require('../services/ctraderMcp');
const mappingEngine = require('../services/mappingEngine');
const narrator = require('../services/narrator');

const isDemoMode = () => process.env.DEMO_MODE === 'true';

// Full IANA timezone list from the runtime itself, not a hardcoded/curated
// subset, so the picker is real data rather than a stand-in for it.
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

router.get('/pre-match', (req, res) => {
  if (!req.session.connectedAccount) {
    return res.redirect('/connect');
  }
  res.render('pre-match', { timezones: TIMEZONES, report: null, error: null });
});

// On-demand version of "Pre-Match is generated and sent" (SHOT-23). A real
// autonomous per-timezone 8am trigger needs Vercel Cron plus a persistent
// Account model, neither of which exist yet; this generates the same report
// content on explicit user action instead, gated the same way AC3 intends,
// no send is possible without an active connected account.
//
// SHOT-24: the "Pre-Match job" itself, pulls both balance and open
// positions. Either call failing fails the whole job (AC3), no report gets
// generated and the failure is logged as its own PreMatchSend record
// instead of a silently dropped error.
router.post(
  '/pre-match',
  asyncHandler(async (req, res) => {
    if (!req.session.connectedAccount) {
      return res.redirect('/connect');
    }

    const timezone = req.body.timezone;
    if (!timezone || !TIMEZONES.includes(timezone)) {
      return res.render('pre-match', {
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
      // Demo-mode-only test hooks, never consulted outside demo mode:
      // ?scenario=empty-positions substitutes an empty position list (the
      // real account genuinely has none right now, but that's external live
      // state this app can't control for a deterministic test run).
      // ?scenario=low-margin substitutes a below-threshold marginLevel, so
      // AC2's foul/high-pressure path is reachable deterministically too.
      // ?scenario=job-error forces this exact try block to throw, so the
      // real failure-handling path below (log status:'failed', no report)
      // gets exercised without needing an unreachable real MCP server,
      // which would also fail the earlier connect step, never reaching here.
      if (isDemoMode() && req.query.scenario === 'job-error') {
        throw new Error('Simulated Pre-Match job failure (test hook)');
      }
      const useEmptyPositions = isDemoMode() && req.query.scenario === 'empty-positions';
      const useLowMargin = isDemoMode() && req.query.scenario === 'low-margin';
      const { balance, positions } = isDemoMode()
        ? {
            balance: useLowMargin
              ? { ...ctraderMcp.getMockBalance(), marginLevel: 75, netProfit: -200 }
              : ctraderMcp.getMockBalance(),
            positions: useEmptyPositions ? [] : ctraderMcp.getMockPositions(),
          }
        : await ctraderMcp.getPreMatchData();

      // SHOT-25: the risk-to-stat mapping engine, translates the raw
      // account data above into the shot clock / foul / box score terms
      // the whole product is framed around.
      const mapped = mappingEngine.mapToBoxScore({ balance, positions });

      // SHOT-26: narrates that same computed box score in a pre-match tone.
      // The narrator interpolates mapped's own values rather than generating
      // them itself, so the "no invented numbers" AC holds structurally.
      const narration = narrator.narratePreMatch(mapped);

      const send = await PreMatchSend.create({
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

      res.render('pre-match', {
        timezones: TIMEZONES,
        error: null,
        report: {
          account: balance,
          positions,
          timezone,
          localTimeAtSend,
          mapped,
          narration,
          sendId: send._id.toString(),
        },
      });
    } catch (err) {
      await PreMatchSend.create({
        sessionId: req.sessionID,
        timezone,
        localTimeAtSend,
        status: 'failed',
        errorReason: err.message,
      });

      res.render('pre-match', {
        timezones: TIMEZONES,
        report: null,
        error: `Couldn't generate the Pre-Match report. (${err.message})`,
      });
    }
  })
);

// SHOT-27: one-tap feedback on a specific Pre-Match send. Scoped by both
// the record's own id AND the current session's id in a single query, so a
// rating can only ever attach to the exact send it was submitted for (AC3:
// today's send only, never a previous day's) and never to another session's
// send, since ids are otherwise guessable/enumerable on a public demo app.
router.post(
  '/pre-match/:id/feedback',
  asyncHandler(async (req, res) => {
    if (!req.session.connectedAccount) {
      return res.redirect('/connect');
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render('404');
    }

    // The rating buttons are the only way to submit in normal use (values
    // fixed 1-5), so this guards a bare POST that bypasses them (AC1 says
    // "1 to 5", nothing outside that range is a valid rating).
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.render('pre-match-feedback', {
        error: 'Choose a rating between 1 and 5.',
        rating: null,
        feedbackText: null,
      });
    }

    const feedbackText = (req.body.feedbackText || '').toString().trim().slice(0, 500);

    const send = await PreMatchSend.findOneAndUpdate(
      { _id: id, sessionId: req.sessionID },
      { rating, feedbackText: feedbackText || undefined },
      { new: true }
    );

    if (!send) {
      return res.status(404).render('404');
    }

    res.render('pre-match-feedback', {
      error: null,
      rating: send.rating,
      feedbackText: send.feedbackText || null,
    });
  })
);

module.exports = router;
