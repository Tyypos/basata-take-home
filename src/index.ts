import express from 'express';
import 'dotenv/config';
import { webhookRouter } from './routes/webhook.js';

const app = express();
app.use(express.json());

// VAPI tool webhook routes mounted under /vapi.
// Single endpoint /vapi/webhook handles all tool calls; the dispatcher routes
// by tool name internally. See routes/webhook.ts for the full payload shape.
app.use('/vapi', webhookRouter);

// Lightweight health check for ngrok/uptime monitors.
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on :${PORT}`);
});
