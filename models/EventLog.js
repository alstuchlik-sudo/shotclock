const mongoose = require('mongoose');

// SHOT-35: one shared logging pipeline for both send types, instead of
// scattering opens/unsubscribes/generation cost/trade data as ad-hoc fields
// across PreMatchSend and PostGameSend, per the ticket's own framing ("One
// logging pipeline instead of separate live-monitoring systems"). Spam
// risk, cost sustainability, and open-rate all get answered by querying
// this collection after the fact, not a purpose-built dashboard.
//
// sendId intentionally has no `ref`/`refPath`: it points at either a
// PreMatchSend or a PostGameSend depending on sendType, and this log is
// meant to stay a simple, queryable record, not a strict relational model.
const eventLogSchema = new mongoose.Schema(
  {
    // This app has no separate accounts/login system, sessionId is its
    // user id concept everywhere else too (see every other model).
    sessionId: { type: String, required: true, index: true },
    sendType: { type: String, enum: ['pre-match', 'post-game'], required: true, index: true },
    eventType: {
      type: String,
      enum: ['open', 'unsubscribe', 'generation_cost', 'trade_risk_activity'],
      required: true,
      index: true,
    },
    sendId: mongoose.Schema.Types.ObjectId,
    // Set only on generation_cost events. 0 here is a real measurement, not
    // a placeholder: the narrator (services/narrator.js) is a deterministic
    // template, not a paid AI call, so there is no real cost to log yet.
    generationCost: Number,
    // Set only on trade_risk_activity events (Post-Game only, AC4).
    tradesCount: Number,
    tradesRealizedProfit: Number,
    foul: Boolean,
    shotClockSeconds: Number,
    exposure: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('EventLog', eventLogSchema);
