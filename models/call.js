const mongoose = require('mongoose');

const CallSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },

  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  },

  provider: { type: String }, // twilio / elevenlabs

  durationSeconds: Number,
  creditsUsed: Number,

  status: {
    type: String,
    enum: ['started', 'completed', 'failed'],
    default: 'started'
  },

  startedAt: Date,
  endedAt: Date

}, { timestamps: true });

module.exports = mongoose.model('Call', CallSchema);
