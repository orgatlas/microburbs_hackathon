// Side-panel content script for realestate.com.au and domain.com.au. Loaded after src/extract.js.
//
// PRIVACY: the only thing that leaves the page is the listing's ADDRESS string, found by
// MBX.extractAddress (JSON-LD, then the h1; otherwise the user types it). No other listing text, no price,
// photos or agent details, no screenshots. No storage, no network, no DOM writes: the panel
// lives in Chrome's side panel, and this script only tells the service worker which address
// this tab is showing:
//   { type: "listing-address", address: "<address>" | null, listing: true }    a listing page
//   { type: "listing-address", address: null, listing: false }                any other page
// Both sites are single-page apps, so it re-runs whenever the page's path changes (1 s poll,
// popstate, Navigation API, back/forward cache) and whenever the background asks with
// { type: "extract-address" }.
globalThis.MBX = globalThis.MBX || {};

(function (MBX) {
  'use strict';

  // Guard against double injection. A copy orphaned by an extension reload does not count.
  const prior = MBX.contentInstance;
  if (prior && typeof prior.alive === 'function' && prior.alive()) return;
  if (prior && typeof prior.stop === 'function') prior.stop();

  const URL_POLL_MS = 1000;
  const SPA_SETTLE_MS = 700; // after an in-page navigation, let the new listing render first
  const EXTRACT_TIMEOUT_MS = 8000;
  const RETRY_MS = 300; // re-read while the page still shows the listing we just left
  const MAX_ADDRESS_CHARS = 200;

  let pageKey = null; // origin + path of the page this script is reporting (query and hash ignored)
  let run = 0; // bumped on every run; answers from older runs are dropped
  let inflight = 0; // the run id of a listing extraction still in progress
  let reported = { key: null, address: null }; // the last address sent, and for which page
  let dead = false;
  let timer = null;
  const warned = new Set();

  const nav = (() => {
    try {
      return typeof navigation !== 'undefined' && navigation && typeof navigation.addEventListener === 'function' ? navigation : null;
    } catch {
      return null;
    }
  })();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function warnOnce(what, detail) {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn('[MicroMatch] ' + what, detail || '');
  }

  function keyOf(href) {
    try {
      const u = new URL(String(href));
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
      return String(href);
    }
  }

  function alive() {
    if (dead) return false;
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  // The extension was reloaded or removed: stop quietly instead of throwing every second.
  function stop() {
    if (dead) return;
    dead = true;
    run++;
    inflight = 0;
    if (timer) clearInterval(timer);
    timer = null;
    try {
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('pageshow', onPageShow);
      if (nav) nav.removeEventListener('currententrychange', onNavigate);
    } catch {
      /* page already gone */
    }
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      /* context invalidated */
    }
  }

  function onSendError(err) {
    const m = String((err && err.message) || err || '');
    if (/context invalidated/i.test(m)) return stop();
    // The background does not have to answer, and a worker that is restarting may miss one.
    if (/message port closed|receiving end does not exist|could not establish connection/i.test(m)) return;
    warnOnce('could not reach the background', m);
  }

  function send(message) {
    if (!alive()) return stop();
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') p.catch(onSendError);
    } catch (err) {
      onSendError(err);
    }
  }

  // The address string and two flags. Nothing else from the page, ever.
  function report(key, address, listing) {
    const a = listing && typeof address === 'string' && address.trim() ? address.trim().slice(0, MAX_ADDRESS_CHARS) : null;
    reported = { key, address: a };
    send({ type: 'listing-address', address: a, listing: Boolean(listing) });
  }

  function isListing(href) {
    if (typeof MBX.isListingPage !== 'function') {
      warnOnce('extract.js did not load: no listing detection');
      return false;
    }
    try {
      return Boolean(MBX.isListingPage(href));
    } catch {
      return false;
    }
  }

  // Reads the address, but treats the address of the listing we just left as "not rendered yet":
  // a single-page app can change the URL before it swaps the page. If that address is still
  // there at the deadline, it is the same home after all.
  async function extractFresh(avoid, deadline, current) {
    if (typeof MBX.extractAddress !== 'function') {
      warnOnce('extract.js did not load: no address extraction');
      return null;
    }
    for (;;) {
      let hit = null;
      try {
        hit = await MBX.extractAddress({ timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (err) {
        warnOnce('address extraction failed', String((err && err.message) || err));
        hit = null;
      }
      if (!current()) return null;
      if (!hit || typeof hit.address !== 'string' || !hit.address.trim()) return null;
      if (!avoid || norm(hit.address) !== norm(avoid)) return hit;
      if (Date.now() + RETRY_MS >= deadline) return hit;
      await sleep(RETRY_MS);
      if (!current()) return null;
    }
  }

  async function runFor(key, settleMs, avoid) {
    const myRun = ++run;
    const current = () => !dead && myRun === run && keyOf(location.href) === key;
    if (!isListing(location.href)) {
      inflight = 0;
      report(key, null, false);
      return;
    }
    inflight = myRun;
    try {
      if (settleMs) await sleep(settleMs);
      if (!current()) return;
      const hit = await extractFresh(avoid, Date.now() + EXTRACT_TIMEOUT_MS, current);
      if (!current()) return; // stale: the page changed while we were reading it
      report(key, hit ? hit.address : null, true);
    } finally {
      if (inflight === myRun) inflight = 0;
    }
  }

  function start(key, settleMs, avoid) {
    runFor(key, settleMs, avoid).catch((err) => warnOnce('address check failed', String((err && err.message) || err)));
  }

  const busy = () => inflight !== 0 && inflight === run;

  // Starts a run when the page's path changed. Returns true if it did.
  function check(initial) {
    if (!alive()) {
      stop();
      return false;
    }
    const key = keyOf(location.href);
    if (key === pageKey) return false;
    const left = reported.key === pageKey ? reported.address : null;
    pageKey = key;
    start(key, initial ? 0 : SPA_SETTLE_MS, initial ? null : left);
    return true;
  }

  function onNavigate() {
    check(false);
  }

  // Back/forward cache: this page is showing again, but the background may hold another page's answer.
  function onPageShow(e) {
    if (!e || !e.persisted) return;
    if (!check(true) && !busy()) start(pageKey, 0, null);
  }

  // The background (or the side panel) asks which address this tab is showing.
  function onMessage(msg, sender, sendResponse) {
    if (!msg || msg.type !== 'extract-address') return;
    try {
      if (sender && sender.id && sender.id !== chrome.runtime.id) return;
    } catch {
      return;
    }
    // A path change starts its own run; a run in flight will answer; otherwise read the page again.
    if (!check(false) && !busy() && !dead) start(pageKey, 0, null);
    try {
      sendResponse({ ok: true }); // the answer itself arrives as a "listing-address" message
    } catch {
      /* channel closed */
    }
  }

  MBX.contentLoaded = true;
  MBX.contentInstance = { alive, stop };

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch (err) {
    onSendError(err);
  }
  if (dead) return;
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('pageshow', onPageShow);
  try {
    if (nav) nav.addEventListener('currententrychange', onNavigate);
  } catch {
    /* no Navigation API: the poll covers it */
  }
  timer = setInterval(() => check(false), URL_POLL_MS);
  check(true);
})(globalThis.MBX);
