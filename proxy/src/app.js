// Express app: GET /health, GET /lookup?address=..., everything else 404 JSON. No CORS headers on purpose:
// the extension calls from its service worker, which host_permissions exempt from CORS.
import express from 'express';
import { createLookup, httpStatusFor } from './lookup.js';

export function createApp({ client, mode = 'mock', lookup } = {}) {
  const doLookup = lookup || createLookup({ client, mode });
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, mode });
  });

  app.get('/lookup', async (req, res) => {
    const raw = req.query.address;
    const address = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
    const body = await doLookup(address);
    res.status(httpStatusFor(body)).set('Cache-Control', 'no-store').json(body);
  });

  app.use((req, res) => {
    res.status(404).json({ status: 'error', error: { code: 'not_found', message: 'Only GET /health and GET /lookup?address=... exist.', request_id: null } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ status: 'error', mode, error: { code: 'internal', message: 'The proxy hit an unexpected error.', request_id: null } });
  });

  return app;
}
