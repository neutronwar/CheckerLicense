const mongoose = require('mongoose');

// Maps to the existing licenses collection (read-only, other fields left as-is)
const licenseSchema = new mongoose.Schema(
  {
    licenseKey: String,
    product: String,
    customerName: String,
    status: String,
    paymentStatus: Number,
    slot: Number,
    deviceId: String,
    expiresAt: Date,
    lastHeartbeat: Date,
    deleteTime: Date,
  },
  { strict: false, collection: process.env.MONGO_COLLECTION || 'lordscrack_licenses' }
);

module.exports = { License: mongoose.model('License', licenseSchema) };
