const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  agentId: { 
    type: String, 
    required: true 
  },
  startTime: { 
    type: Date, 
    required: true 
  },
  endTime: { 
    type: Date, 
    required: true 
  },
  durationSeconds: { 
    type: Number, 
    required: true 
  },
  creditsUsed: { 
    type: Number, 
    required: true 
  },
  status: {
    type: String,
    enum: ['completed', 'disconnected'],
    default: 'completed'
  }
}, { timestamps: true });

module.exports = mongoose.model('CallLog', callLogSchema);
