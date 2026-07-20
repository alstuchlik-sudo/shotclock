const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const ConnectionAttempt = require('../models/ConnectionAttempt');
const ctraderMcp = require('../services/ctraderMcp');

const isDemoMode = () => process.env.DEMO_MODE === 'true';

router.get(
  '/connect',
  asyncHandler(async (req, res) => {
    if (!req.session.attemptId) {
      const attempt = await ConnectionAttempt.create({
        sessionId: req.sessionID,
        outcome: 'started',
      });
      req.session.attemptId = attempt._id.toString();
    }
    res.render('connect', { error: null, mcpUrl: ctraderMcp.MCP_URL, demoMode: isDemoMode() });
  })
);

router.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const attemptId = req.session.attemptId;

    try {
      // Demo mode skips the real MCP call entirely, no reachable cTrader
      // Desktop is assumed to exist for a publicly shared link.
      const account = isDemoMode() ? ctraderMcp.getMockBalance() : await ctraderMcp.getBalance();

      if (account.connectionState !== 'Authenticated') {
        if (attemptId) {
          await ConnectionAttempt.findByIdAndUpdate(attemptId, {
            outcome: 'drop_off',
            errorReason: `Not authenticated (state: ${account.connectionState}).`,
          });
        }
        delete req.session.attemptId;
        return res.render('connect', {
          error: `cTrader Desktop is running but not logged in to a broker account (state: ${account.connectionState}). Log in to cTrader Desktop, then try again.`,
          mcpUrl: ctraderMcp.MCP_URL,
          demoMode: isDemoMode(),
        });
      }

      if (attemptId) {
        await ConnectionAttempt.findByIdAndUpdate(attemptId, {
          outcome: 'connected',
          brokerName: account.brokerName,
          accountType: account.accountType,
          traderId: account.traderId,
          depositAsset: account.depositAsset,
          balance: account.balance,
        });
      }
      delete req.session.attemptId;
      req.session.connectedAccount = {
        brokerName: account.brokerName,
        accountType: account.accountType,
        traderId: account.traderId,
        depositAsset: account.depositAsset,
        balance: account.balance,
      };
      res.redirect('/connect/success');
    } catch (err) {
      if (attemptId) {
        await ConnectionAttempt.findByIdAndUpdate(attemptId, {
          outcome: 'drop_off',
          errorReason: err.message,
        });
      }
      delete req.session.attemptId;
      res.render('connect', {
        error: `Couldn't reach cTrader Desktop. Make sure the app is open and running on this machine, then try again. (${err.message})`,
        mcpUrl: ctraderMcp.MCP_URL,
        demoMode: isDemoMode(),
      });
    }
  })
);

// Beacon target: fires only if the user leaves the connect screen without
// ever submitting the form (AC3). Submitting, success or failure, is
// already logged directly by the POST /connect handler above.
router.post(
  '/connect/abandon',
  asyncHandler(async (req, res) => {
    const attemptId = req.session.attemptId;
    if (attemptId) {
      await ConnectionAttempt.findOneAndUpdate(
        { _id: attemptId, outcome: 'started' },
        { outcome: 'drop_off', errorReason: 'abandoned' }
      );
      delete req.session.attemptId;
    }
    res.status(204).end();
  })
);

router.get('/connect/success', (req, res) => {
  const account = req.session.connectedAccount;
  if (!account) {
    return res.redirect('/connect');
  }
  res.render('connect-success', { account, demoMode: isDemoMode() });
});

router.get(
  '/connect/stats',
  asyncHandler(async (req, res) => {
    const [connected, dropOff] = await Promise.all([
      ConnectionAttempt.countDocuments({ outcome: 'connected' }),
      ConnectionAttempt.countDocuments({ outcome: 'drop_off' }),
    ]);
    const resolved = connected + dropOff;
    const rate = resolved > 0 ? Math.round((connected / resolved) * 100) : null;
    const recent = await ConnectionAttempt.find({ outcome: { $ne: 'started' } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.render('stats', { connected, dropOff, resolved, rate, recent, demoMode: isDemoMode() });
  })
);

module.exports = router;
