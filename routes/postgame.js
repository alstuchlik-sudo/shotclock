const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const PostGameSend = require('../models/PostGameSend');
const ctraderMcp = require('../services/ctraderMcp');
const mappingEngine = require('../services/mappingEngine');
const narrator = require('../services/narrator');
const streakTracker = require('../services/streakTracker');

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
      // never consulted outside demo mode. ?scenario=no-trades-today is new
      // for SHOT-30 (AC3): the real account's trade history for "today"
      // isn't something this app can force empty on demand either.
      if (isDemoMode() && req.query.scenario === 'job-error') {
        throw new Error('Simulated Post-Game job failure (test hook)');
      }
      const useEmptyPositions = isDemoMode() && req.query.scenario === 'empty-positions';
      const useLowMargin = isDemoMode() && req.query.scenario === 'low-margin';
      const useNoTradesToday = isDemoMode() && req.query.scenario === 'no-trades-today';
      // Reuses ctraderMcp's balance/positions fetch as-is: a Post-Game recap
      // and a Pre-Match report need the same underlying account snapshot,
      // just narrated differently, so there's no separate real-data call to
      // write here.
      let balance, positions, orderHistory;
      if (isDemoMode()) {
        balance = useLowMargin
          ? { ...ctraderMcp.getMockBalance(), marginLevel: 75, netProfit: -200 }
          : ctraderMcp.getMockBalance();
        positions = useEmptyPositions ? [] : ctraderMcp.getMockPositions();
        orderHistory = useNoTradesToday ? [] : ctraderMcp.getMockOrderHistory();
      } else {
        const data = await ctraderMcp.getPreMatchData();
        balance = data.balance;
        positions = data.positions;
        orderHistory = await ctraderMcp.getOrderHistory();
      }

      // SHOT-30: reconstructs today's trade activity. get_order_history has
      // no date-range parameter (per the ticket's notes), so filtering
      // against "today" happens client-side here, then the already-filtered
      // trades feed into the same mapping engine Pre-Match uses unchanged.
      const todaysTrades = mappingEngine.filterTradesForToday(orderHistory, timezone);
      const mapped = mappingEngine.mapToBoxScore({ balance, positions, trades: todaysTrades });

      // SHOT-31: the personal-best discipline streak. Only successful prior
      // sends count as a "day" here, a failed job never computed a foul
      // flag at all, so it can't extend or break a streak either way.
      // Computed before narrating, SHOT-32's narration references it.
      const previous = await PostGameSend.findOne({
        sessionId: req.sessionID,
        status: 'success',
      }).sort({ createdAt: -1 });
      const { streak, personalBest } = streakTracker.computeStreak(previous, mapped.foul);

      // Post-Game's own evening-recap narration template, distinct from
      // Pre-Match's tip-off template (see services/narrator.js). SHOT-32:
      // narrates today's box score against the personal-best streak too.
      const narration = narrator.narratePostGame(mapped, { streak, personalBest });

      const send = await PostGameSend.create({
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
        tradesCount: mapped.boxScore.tradesToday.count,
        tradesRealizedProfit: mapped.boxScore.tradesToday.realizedProfit,
        streak,
        personalBest,
        narration: narration.text,
        narrationTemplateId: narration.templateId,
      });

      res.render('post-game', {
        timezones: TIMEZONES,
        error: null,
        report: {
          account: balance,
          positions,
          trades: todaysTrades,
          timezone,
          localTimeAtSend,
          mapped,
          narration,
          streak,
          personalBest,
          sendId: send._id.toString(),
        },
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

// SHOT-33: one-tap feedback on a specific Post-Game send, the same shared
// mechanism as Pre-Match's feedback (SHOT-27), reused for the evening send.
// Scoped by both the record's own id AND the current session's id, same
// ownership-check reasoning as SHOT-27. AC1/AC2 ("tagged as a foul/
// foul-free day for later review") need no extra tagging logic, the
// record's own `foul` field (already set at generation time) already lives
// right alongside rating/feedbackText on the same document.
router.post(
  '/post-game/:id/feedback',
  asyncHandler(async (req, res) => {
    if (!req.session.connectedAccount) {
      return res.redirect('/connect');
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render('404');
    }

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.render('post-game-feedback', {
        error: 'Choose a rating between 1 and 5.',
        rating: null,
        feedbackText: null,
        muted: false,
      });
    }

    const feedbackText = (req.body.feedbackText || '').toString().trim().slice(0, 500);

    const send = await PostGameSend.findOneAndUpdate(
      { _id: id, sessionId: req.sessionID },
      { rating, feedbackText: feedbackText || undefined },
      { new: true }
    );

    if (!send) {
      return res.status(404).render('404');
    }

    res.render('post-game-feedback', {
      error: null,
      rating: send.rating,
      feedbackText: send.feedbackText || null,
      muted: false,
    });
  })
);

// SHOT-33 AC3: muting instead of rating. This app has no actual push/email
// send to unsubscribe from (Post-Game is generated on demand, see the
// scope-down note on POST /post-game above), so "mute the Post-Game send"
// is scoped the same way: a second one-tap action on the already-generated
// recap, an alternative to the rating buttons rather than a real
// notification-preference change. The mute event lands on the same record
// as the rating would have, so it's tagged with that day's foul status
// for free, same as the feedback route above.
router.post(
  '/post-game/:id/mute',
  asyncHandler(async (req, res) => {
    if (!req.session.connectedAccount) {
      return res.redirect('/connect');
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render('404');
    }

    const send = await PostGameSend.findOneAndUpdate(
      { _id: id, sessionId: req.sessionID },
      { muted: true },
      { new: true }
    );

    if (!send) {
      return res.status(404).render('404');
    }

    res.render('post-game-feedback', { error: null, rating: null, feedbackText: null, muted: true });
  })
);

module.exports = router;
