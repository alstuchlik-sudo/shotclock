const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const PreMatchSend = require('../models/PreMatchSend');
const ctraderMcp = require('../services/ctraderMcp');

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

    try {
      const account = isDemoMode() ? ctraderMcp.getMockBalance() : await ctraderMcp.getBalance();
      const localTimeAtSend = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date());

      await PreMatchSend.create({
        sessionId: req.sessionID,
        timezone,
        localTimeAtSend,
        brokerName: account.brokerName,
        accountType: account.accountType,
        traderId: account.traderId,
        depositAsset: account.depositAsset,
        balance: account.balance,
      });

      res.render('pre-match', {
        timezones: TIMEZONES,
        error: null,
        report: { account, timezone, localTimeAtSend },
      });
    } catch (err) {
      res.render('pre-match', {
        timezones: TIMEZONES,
        report: null,
        error: `Couldn't generate the Pre-Match report. (${err.message})`,
      });
    }
  })
);

module.exports = router;
