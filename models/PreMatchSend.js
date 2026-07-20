const mongoose = require('mongoose');

const preMatchSendSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    timezone: { type: String, required: true },
    localTimeAtSend: { type: String, required: true },
    brokerName: String,
    accountType: String,
    traderId: Number,
    depositAsset: String,
    balance: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('PreMatchSend', preMatchSendSchema);
