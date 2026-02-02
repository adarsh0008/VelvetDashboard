const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  productId: String,
  productName: String,

  // Stripe IDs
  stripeSessionId: {
    type: String
  },

  paymentIntentId: {
    type: String
  },

  amount: Number,     // in cents
  currency: String,

  creditsAdded: Number,

  status: {
    type: String,
    enum: ['initiated', 'pending', 'paid', 'failed', 'expired'],
    default: 'initiated'   // ✅ FIXED
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * 🔒 Enforce Stripe session uniqueness ONLY when it exists
 */
purchaseSchema.index(
  { stripeSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripeSessionId: { $exists: true, $type: 'string' }
    }
  }
);

module.exports = mongoose.model('Purchase', purchaseSchema);
