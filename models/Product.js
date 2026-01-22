const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  productId: { type: String, unique: true, index: true },

  name: String,
  image: String,
  productType: String,

  price: Number,
  currency: String,
  priceId: String,
  
  credits: { type: Number, default: 0 }, // ← ADD THIS FIELD

  locationId: String,

  // 🔥 GHL sync fields
  ghlUpdatedAt: Date,   // from GHL
  lastSyncedAt: Date    // when we synced
}, { timestamps: true });

module.exports = mongoose.model('Product', ProductSchema);