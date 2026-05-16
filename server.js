require('dotenv').config();
const express = require('express');
const { handleMessage } = require('./src/handler');
const db = require('./src/supabase');

const app = express();
app.use(express.json());

// ─── Webhook verification (Meta GET request) ──────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Incoming messages (Meta POST request) ────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond 200 immediately

  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages?.length) return; // Skip status updates

    const msgObj = entry.messages[0];
    const salon = await db.getSalon();
    if (!salon) return;

    await handleMessage(msgObj, salon);
  } catch (err) {
    console.error('Handler error:', err.message);
  }
});

// ─── Health check ─────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'SalonBot v3' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SalonBot running on port ${PORT}`));
