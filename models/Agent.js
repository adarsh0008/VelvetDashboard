const mongoose = require('mongoose');

const ModelSchema = new mongoose.Schema({

  // 🔑 GHL Custom Object Record ID
  recordId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  name: {
    type: String,
    required: true
  },

  imageUrl: {
    type: String
  },

  ratePerMinute: {
    type: Number,
    default: 1,
    min: 0
  },

  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }

}, { timestamps: true });

module.exports = mongoose.model('Model', ModelSchema);
