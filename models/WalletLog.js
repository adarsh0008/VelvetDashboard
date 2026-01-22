const mongoose = require('mongoose');

const WalletLogSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },

  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },

  amount: { type: Number, required: true },

  reason: {
    type: String,
    enum: ['call', 'purchase', 'refund', 'admin']
  },

  referenceId: String, // callId / orderId

  balanceAfter: Number

}, { timestamps: true });

module.exports = mongoose.model('WalletLog', WalletLogSchema);
