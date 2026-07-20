const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    symbol: String,
    side: String,
    volumeInLots: Number,
    entryPrice: Number,
    currentPrice: Number,
    pips: Number,
    profit: Number,
  },
  { _id: false }
);

const postGameSendSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    timezone: { type: String, required: true },
    localTimeAtSend: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed'], default: 'success', required: true },
    errorReason: String,
    brokerName: String,
    accountType: String,
    traderId: Number,
    depositAsset: String,
    balance: Number,
    margin: Number,
    positions: [positionSchema],
    shotClockSeconds: Number,
    foul: Boolean,
    points: Number,
    exposure: Number,
    tradesCount: Number,
    tradesRealizedProfit: Number,
    streak: Number,
    personalBest: Number,
    narration: String,
    narrationTemplateId: String,
    rating: { type: Number, min: 1, max: 5 },
    feedbackText: String,
    muted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PostGameSend', postGameSendSchema);
