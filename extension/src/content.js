// Glue: on a listing page, find the address (extract.js), show the panel
// (panel.js) and ask the service worker for the Microburbs facts.
// Only the address string is ever sent; nothing is stored.
globalThis.MBX = globalThis.MBX || {};

(function (MBX) {
  'use strict';

  if (MBX.contentLoaded) return; // guard against double injection
  MBX.contentLoaded = true;

  const URL_POLL_MS = 800;
  const SPA_SETTLE_MS = 600; // after an in-page navigation, let the new listing render first
  const EXTRACT_TIMEOUT_MS = 8000;

  let panel = null;
  let pageKey = null; // origin + path of the page the panel belongs to
  let run = 0; // bumped on every new page / lookup / close; stale answers are dropped
  let last = { address: null, source: null };

  const keyOf = (href) => {
    try {
      const u = new URL(href);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
      return String(href);
    }
  };

  function setState(state) {
    if (!panel) return;
    try {
      panel.setState(state);
    } catch (err) {
      console.warn('[Listing Check] panel could not render', err);
    }
  }

  function destroyPanel() {
    if (!panel) return;
    const p = panel;
    panel = null;
    try {
      p.destroy();
    } catch {
      /* already gone */
    }
  }

  function createPanel() {
    destroyPanel();
    if (typeof MBX.createPanel !== 'function') {
      console.warn('[Listing Check] panel.js did not load');
      return;
    }
    panel = MBX.createPanel({
      onSubmitAddress(text) {
        const t = String(text == null ? '' : text).trim();
        if (t) lookup(t, 'typed');
      },
      onRetry() {
        if (last.address) lookup(last.address, last.source);
        else start(0);
      },
      onClose() {
        run++; // drop anything still in flight for this page
        destroyPanel();
      },
    });
  }

  async function start(delayMs) {
    const myRun = ++run;
    const key = pageKey;
    last = { address: null, source: null };
    createPanel();
    setState({ kind: 'detecting' });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (myRun !== run || key !== keyOf(location.href)) return;
    let hit = null;
    try {
      hit = await MBX.extractAddress({ timeoutMs: EXTRACT_TIMEOUT_MS });
    } catch (err) {
      console.warn('[Listing Check] address extraction failed', err);
    }
    if (myRun !== run || key !== keyOf(location.href)) return;
    if (!hit) {
      setState({ kind: 'need_address', reason: 'not_found' });
      return;
    }
    lookup(hit.address, hit.source);
  }

  async function lookup(address, source) {
    if (!panel) createPanel();
    const myRun = ++run;
    const key = pageKey;
    last = { address, source };
    setState({ kind: 'loading', address, source });
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'MBX_LOOKUP', address });
    } catch (err) {
      res = {
        ok: false,
        message: 'The extension was reloaded or its background worker is not answering. Reload this page.',
        detail: String((err && err.message) || err),
      };
    }
    if (myRun !== run || key !== keyOf(location.href)) return; // stale: page or query changed
    if (res && res.ok && res.blob) {
      setState({ kind: 'result', address, source, blob: res.blob });
    } else {
      setState({
        kind: 'error',
        address,
        source,
        message: (res && res.message) || 'The lookup failed.',
        detail: (res && res.detail) || '',
      });
    }
  }

  function check(isInitial) {
    const key = keyOf(location.href);
    if (key === pageKey) return;
    pageKey = key;
    if (MBX.isListingPage(location.href)) {
      start(isInitial ? 0 : SPA_SETTLE_MS);
    } else {
      run++;
      last = { address: null, source: null };
      destroyPanel();
    }
  }

  // Toolbar button (background.js): bring the panel back after Close.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!sender || sender.id !== chrome.runtime.id || !msg || msg.type !== 'MBX_OPEN') return;
    if (panel) return; // already showing (or collapsed to the pill)
    pageKey = null;
    check(true);
  });

  window.addEventListener('popstate', () => check(false));
  setInterval(() => check(false), URL_POLL_MS);
  check(true);
})(globalThis.MBX);
