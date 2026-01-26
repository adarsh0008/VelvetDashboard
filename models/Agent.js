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

  imageUrl: String,

  ratePerMinute: {
    type: Number,
    default: 1,
    min: 0
  },

  // 🔥 NEW: ElevenLabs Agent ID
  elevenLabsAgentId: {
    type: String,
    index: true
  },

  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }

}, { timestamps: true });

module.exports = mongoose.model('Model', ModelSchema);
