require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { License } = require('./models');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function checkLicense(doc) {
  // deleteTime is a scheduled deletion; it only counts once that time has passed
  if (doc.deleteTime && doc.deleteTime <= new Date()) return 'License has been deleted';
  if (doc.status !== 'active') return `License status: ${doc.status}`;
  if (doc.paymentStatus !== 1) return 'Payment is pending';
  if (doc.expiresAt && doc.expiresAt < new Date()) return 'License has expired';
  return null;
}

app.post('/api/check', async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) return res.status(400).json({ found: false, message: 'License key is required' });

  try {
    // licenseKey is unique per product, so one key can map to several products
    const docs = await License.find({ licenseKey: key }).lean();
    if (!docs.length) return res.json({ found: false, message: 'License key not found' });

    const licenses = docs.map((doc) => {
      const error = checkLicense(doc);
      return {
        valid: !error,
        message: error || 'License is valid',
        product: doc.product,
        status: doc.status,
        slot: doc.slot,
        paid: doc.paymentStatus === 1,
        expiresAt: doc.expiresAt,
        deviceBound: Boolean(doc.deviceId),
        lastHeartbeat: doc.lastHeartbeat,
        deleteAt: doc.deleteTime && doc.deleteTime > new Date() ? doc.deleteTime : null,
        // Lordsbot uses V5/V6 access flags, other products a single whitelist flag (missing field means no access)
        versions: doc.product === 'lordsbot' ? { V5: doc.V5 === true, V6: doc.V6 === true } : null,
        whitelist: doc.product === 'lordsbot' ? null : doc.whitelist === true,
      };
    });
    res.json({ found: true, licenses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ found: false, message: 'Server error' });
  }
});

// In-memory cooldown per license (key + product); resets when the server restarts
const RESET_COOLDOWN_MS = Number(process.env.RESET_COOLDOWN_MINUTES || 60) * 6e4;
const lastReset = new Map();

app.post('/api/reset-device', async (req, res) => {
  const key = String(req.body.key || '').trim();
  const product = String(req.body.product || '').trim();
  if (!key || !product) return res.status(400).json({ success: false, message: 'License key and product are required' });

  const id = `${key}|${product}`;
  const waitMs = (lastReset.get(id) || 0) + RESET_COOLDOWN_MS - Date.now();
  if (waitMs > 0) {
    return res.status(429).json({ success: false, message: `Please wait ${Math.ceil(waitMs / 6e4)} min before resetting again` });
  }

  try {
    // Same fields the admin panel clears on "Reset Device"
    const result = await License.updateOne(
      { licenseKey: key, product, deviceId: { $nin: [null, ''] } },
      { $set: { deviceId: null, sessionId: null, updatedAt: new Date() } }
    );
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'License is not bound to any device' });

    lastReset.set(id, Date.now());
    res.json({ success: true, message: 'Device has been reset' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME })
  .then(() => {
    console.log(`MongoDB connected (${process.env.MONGO_DB_NAME}.${License.collection.name})`);
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
