// Live Microburbs client: Bearer auth, 8 s timeout, a small rate limiter, 429 backoff.
// get(path, query) -> Promise<{ status, body, requestId }>. status 0 = no answer (network error / timeout).
// The key is only ever placed in the Authorization header; it never appears in returned bodies or errors.

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** At most `maxInFlight` concurrent jobs and at most `maxPerSecond` job starts per rolling second. */
export function createLimiter({ maxInFlight = 6, maxPerSecond = 8, now = Date.now } = {}) {
  let inFlight = 0;
  const starts = [];
  const queue = [];
  let timer = null;

  function pump() {
    while (queue.length && inFlight < maxInFlight) {
      const t = now();
      while (starts.length && t - starts[0] >= 1000) starts.shift();
      if (starts.length >= maxPerSecond) {
        if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            pump();
          }, Math.max(1, 1000 - (t - starts[0]) + 1));
        }
        return;
      }
      const job = queue.shift();
      inFlight++;
      starts.push(t);
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          inFlight--;
          pump();
        });
    }
  }

  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        pump();
      });
    },
  };
}

/** Delay before retrying a 429: Retry-After (seconds, capped at 10 s) else 400 ms * 2^n + jitter. */
export function backoffDelay(retryAfter, attempt, random = Math.random) {
  if (retryAfter !== null && retryAfter !== undefined && String(retryAfter).trim() !== '') {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 10000);
  }
  return 400 * 2 ** attempt + Math.floor(random() * 200);
}

/**
 * Wraps a raw transport rawGet(path, query) -> { status, body, requestId, retryAfter } (throws on network error)
 * with the shared retry policy. Used by the live client and by the mock client so "rate429" exercises it too.
 */
// maxTotalWaitMs bounds the 429 sleeping per call (the extension gives up after 20 s), so a long Retry-After
// returns the 429 at once instead of stalling the lookup.
export function withBackoff(rawGet, { maxAttempts = 4, maxTotalWaitMs = 4000, sleep = defaultSleep, random = Math.random, onRetry } = {}) {
  return async function get(path, query) {
    let rateLimited = 0;
    let networkFailures = 0;
    let waited = 0;
    for (;;) {
      let r;
      try {
        r = await rawGet(path, query);
      } catch (err) {
        networkFailures++;
        // A timeout already cost timeoutMs: retrying it would double the wait, so only quick failures retry.
        if (networkFailures < 2 && !(err && err.name === 'TimeoutError')) {
          await sleep(300);
          continue;
        }
        return { status: 0, body: null, requestId: null, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network error' };
      }
      if (r.status === 429) {
        rateLimited++;
        const wait = backoffDelay(r.retryAfter, rateLimited - 1, random);
        if (rateLimited < maxAttempts && waited + wait <= maxTotalWaitMs) {
          waited += wait;
          if (onRetry) onRetry({ path, attempt: rateLimited, wait });
          await sleep(wait);
          continue;
        }
      }
      return { status: r.status, body: r.body, requestId: r.requestId ?? null };
    }
  };
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url;
}

export function createLiveClient({
  apiKey,
  baseUrl = 'https://api-ht.microburbs.com.au',
  timeoutMs = 8000,
  maxInFlight = 6,
  maxPerSecond = 8,
  maxAttempts = 4,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
} = {}) {
  if (!apiKey) throw new Error('createLiveClient: an API key is required (set MICROBURBS_API_KEY)');
  const base = String(baseUrl).replace(/\/+$/, '');
  const limiter = createLimiter({ maxInFlight, maxPerSecond });

  async function rawGet(path, query) {
    const url = buildUrl(base, path, query);
    return limiter.run(async () => {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { detail: 'non-JSON response from Microburbs' };
        }
      }
      return {
        status: res.status,
        body,
        requestId: res.headers.get('x-request-id'),
        retryAfter: res.headers.get('retry-after'),
      };
    });
  }

  return { get: withBackoff(rawGet, { maxAttempts, sleep }) };
}
