const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },

  provider: { type: String }, // stripe / razorpay
  creditsPurchased: Number,
  amountPaid: Number,

  status: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  }

}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
