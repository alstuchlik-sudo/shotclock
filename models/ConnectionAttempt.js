const mongoose = require('mongoose');

const connectionAttemptSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    outcome: {
      type: String,
      enum: ['started', 'connected', 'drop_off'],
      default: 'started',
      required: true,
    },
    brokerName: String,
    accountType: String,
    traderId: Number,
    depositAsset: String,
    balance: Number,
    errorReason: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('ConnectionAttempt', connectionAttemptSchema);
