'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiError extends Error {
  constructor(status) {
    super(`Microburbs request failed (${status})`);
    this.status = status;
  }
}

function retryAfterMs(value, now) {
  if (value == null || value === '') return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function createApiClient({
  apiKey,
  fetchImpl = fetch,
  ttlMs = 15 * 60_000,
  maxEntries = 4000,
  spacingMs = 112,
  maxRetries = 2,
  timeoutMs = 7000,
  maxWaitMs = 6000,
  wait = sleep,
  now = Date.now,
} = {}) {
  const origin = 'https://api-ht.microburbs.com.au';
  const stores = { property: new Map(), suburb: new Map(), query: new Map() };
  const pending = new Map();
  let nextSlot = 0;
  let blockedUntil = 0;
  let queue = Promise.resolve();

  function reserveSlot() {
    const start = queue.then(async () => {
      while (true) {
        const delay = Math.max(nextSlot, blockedUntil) - now();
        if (delay <= 0) break;
        if (delay > maxWaitMs) throw new ApiError(429);
        await wait(delay);
      }
      nextSlot = now() + spacingMs;
    });
    queue = start.catch(() => {});
    return start;
  }

  async function request(url) {
    if (!apiKey) throw new ApiError(401);
    for (let attempt = 0; ; attempt++) {
      await reserveSlot();
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      if (response.ok) return response.json();
      // Release the connection without retaining or logging upstream errors.
      await response.body?.cancel().catch(() => {});
      if (response.status !== 429) throw new ApiError(response.status);
      const time = now();
      const delay = Math.max(350 * 2 ** attempt, retryAfterMs(response.headers.get('Retry-After'), time));
      blockedUntil = Math.max(blockedUntil, time + delay);
      if (attempt >= maxRetries || delay > maxWaitMs) throw new ApiError(429);
    }
  }

  function get(path, params = {}) {
    if (!/^\/v1\/(?!\/)/.test(path)) throw new TypeError('Expected a Microburbs v1 path');
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) {
      throw new TypeError('Expected a Microburbs v1 path');
    }
    for (const [key, value] of Object.entries(params)) {
      if (value != null) for (const item of [].concat(value)) url.searchParams.append(key, String(item));
    }
    url.searchParams.sort();
    const key = url.pathname + url.search;
    const store = url.pathname.startsWith('/v1/properties/') ? stores.property
      : url.pathname.startsWith('/v1/suburbs/') ? stores.suburb : stores.query;
    const cached = store.get(key);
    if (cached) {
      store.delete(key);
      if (cached.expires > now()) {
        store.set(key, cached);
        return Promise.resolve(cached.body);
      }
    }
    if (pending.has(key)) return pending.get(key);
    const work = request(url).then((body) => {
      store.set(key, { body, expires: now() + ttlMs });
      if (store.size > maxEntries) store.delete(store.keys().next().value);
      return body;
    }).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  return { get };
}

export { ApiError, createApiClient };
