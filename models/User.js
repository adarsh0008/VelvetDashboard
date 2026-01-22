const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({

  googleId: { type: String, required: true, unique: true, index: true },

  displayName: { type: String, trim: true },
  email: { type: String, lowercase: true, unique: true, index: true },
  avatar: String,

  wallet: {
    balance: { type: Number, default: 100, min: 0 }
  },

  ghl: {
    contactId: String,
    locationId: String
  },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  lastLogin: Date

}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
