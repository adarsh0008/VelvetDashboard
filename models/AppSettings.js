const mongoose = require('mongoose');

const CouponSchema = new mongoose.Schema({
  code: { type: String, required: true },
  type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  value: { type: Number, required: true },
  active: { type: Boolean, default: true }
}, { _id: false });

const AppSettingsSchema = new mongoose.Schema({
  allowedCountries: {
    type: [String],
    default: ['US']
  },

  coupons: {
    type: [CouponSchema],
    default: []
  }

}, { timestamps: true });

module.exports = mongoose.model('AppSettings', AppSettingsSchema);