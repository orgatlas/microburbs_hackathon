// Express app: GET /health, GET /lookup?address=...[&work=...], everything else 404 JSON. No CORS headers on purpose:
// the extension calls from its service worker, which host_permissions exempt from CORS.
// /lookup answers the lookup blob plus one extra key, "facts" (proxy/profile-facts.js), when status is "ok";
// facts is null otherwise. A facts failure or a slow facts fetch never breaks the lookup itself.
import express from 'express';
import { createLookup, httpStatusFor } from './lookup.js';
import { createProfileFacts, FACT_KEYS } from '../profile-facts.js';

const MAX_WORK_CHARS = 200;
// The extension's service worker gives up at 28 s; the lookup itself can take a few seconds on a cold cache.
const FACTS_TIMEOUT_MS = 15000;
// The whole /lookup answer (lookup + facts) aims to land before the extension's 28 s abort.
const RESPONSE_BUDGET_MS = 24000;
const MIN_FACTS_MS = 1000;
// Identical upstream GETs from the lookup and the facts (valuation/avm, rent-history-latest) are fetched once.
const SHARED_TTL_MS = 60000;
const SHARED_MAX = 500;

/** Wraps a client so identical GETs (path + query) in flight, or answered 200 within ttlMs, hit upstream once. */
export function shareClient(client, ttlMs = SHARED_TTL_MS) {
  if (!client || typeof client.get !== 'function') return client;
  const done = new Map();
  const inflight = new Map();
  return {
    ...client,
    get(path, query) {
      const key = String(path) + '|' + JSON.stringify(query || {});
      const hit = done.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.res);
      if (hit) done.delete(key);
      const running = inflight.get(key);
      if (running) return running;
      const p = Promise.resolve()
        .then(() => client.get(path, query))
        .then((res) => {
          if (res && res.status === 200) {
            done.set(key, { at: Date.now(), res });
            if (done.size > SHARED_MAX) done.delete(done.keys().next().value);
          }
          return res;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}

const firstString = (raw) => (typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '');

/** Every fact absent, each with the same reason: what the panel gets when facts could not be fetched in time. */
function factsUnavailable(match, why) {
  const missing = {};
  for (const k of FACT_KEYS) missing[k] = why;
  return {
    gnaf_id: String(match.gnaf_id || ''),
    suburb: String(match.suburb || ''),
    property_type: typeof match.property_type === 'string' ? match.property_type : null,
    fetched_at: new Date().toISOString(),
    missing,
  };
}

export function createApp({ client: rawClient, mode = 'mock', lookup, profileFacts, factsTimeoutMs = FACTS_TIMEOUT_MS } = {}) {
  const client = shareClient(rawClient);
  const doLookup = lookup || createLookup({ client, mode });
  let facts = profileFacts || null;
  if (!facts && client && typeof client.get === 'function') {
    try {
      facts = createProfileFacts({ client });
    } catch {
      facts = null;
    }
  }

  async function attachFacts(body, work, waitMs = factsTimeoutMs) {
    const match = body && body.status === 'ok' && body.match && typeof body.match === 'object' ? body.match : null;
    if (!match || !match.gnaf_id || !facts || typeof facts.getFacts !== 'function') return { ...body, facts: null };
    let timer;
    try {
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(factsUnavailable(match, 'upstream_error:timeout')), waitMs);
      });
      const got = Promise.resolve()
        .then(() => facts.getFacts({ gnafId: match.gnaf_id, suburb: match.suburb, propertyType: match.property_type, workAddress: work }))
        .then((f) => (f && typeof f === 'object' ? f : factsUnavailable(match, 'internal_error')), () => factsUnavailable(match, 'internal_error'));
      return { ...body, facts: await Promise.race([got, timeout]) };
    } catch {
      return { ...body, facts: factsUnavailable(match, 'internal_error') };
    } finally {
      clearTimeout(timer);
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, mode });
  });

  app.get('/lookup', async (req, res) => {
    const address = firstString(req.query.address);
    const work = firstString(req.query.work).replace(/\s+/g, ' ').trim().slice(0, MAX_WORK_CHARS);
    const t0 = Date.now();
    const body = await doLookup(address);
    let out = body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      try {
        // Facts get what is left of the response budget, so a slow lookup cannot push the answer past 28 s.
        const left = Math.max(MIN_FACTS_MS, RESPONSE_BUDGET_MS - (Date.now() - t0));
        out = await attachFacts(body, work, Math.min(factsTimeoutMs, left));
      } catch {
        out = { ...body, facts: null };
      }
    }
    res.status(httpStatusFor(out)).set('Cache-Control', 'no-store').json(out);
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
