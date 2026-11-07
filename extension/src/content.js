// Glue: on a listing page, find the address (extract.js), show the panel
// (panel.js) and ask the service worker for the Microburbs facts.
// Only the listing address and the profile's work address are ever sent. The fit score is
// computed here (MBX.score.scoreListing), so income and budget never leave the browser.
// The profile (MBX.profile) lives in chrome.storage.local; nothing else is stored.
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
  let lastBlob = null; // the blob on screen, for re-scoring after a profile save
  let profile = null;
  let profileP = null;
  let picked = null; // { gnaf_id, display_name } of the last "Not this one?" pick

  // Dev/test only: chrome.storage.local["mbx.dev"] === true keeps the panel's shadow root open so the e2e harness
  // can read it. Otherwise it is closed, so the listing site's scripts cannot read the profile figures in the panel.
  let shadowMode = 'closed';
  const devP = Promise.resolve()
    .then(() => chrome.storage.local.get('mbx.dev'))
    .then((o) => {
      if (o && o['mbx.dev'] === true) shadowMode = 'open';
    })
    .catch(() => {});

  function loadProfile() {
    if (profile) return Promise.resolve(profile);
    if (!profileP) {
      const P = MBX.profile;
      profileP = Promise.resolve()
        .then(() => (P && typeof P.load === 'function' ? P.load() : null))
        .catch((err) => {
          console.warn('[Listing Check] profile could not load', err);
          return null;
        })
        .then((p) => {
          profile = p || (P && P.DEFAULT) || null;
          profileP = null;
          return profile;
        });
    }
    return profileP;
  }

  const workOf = (p) => (p && typeof p.work_address === 'string' ? p.work_address.replace(/\s+/g, ' ').trim() : '');

  function scoreFor(blob, p) {
    if (!blob || blob.status !== 'ok' || !MBX.score || typeof MBX.score.scoreListing !== 'function') return null;
    try {
      return MBX.score.scoreListing(blob.facts || null, p || {});
    } catch (err) {
      console.warn('[Listing Check] score failed', err);
      return null;
    }
  }

  function onProfileSave(next) {
    if (!next || typeof next !== 'object') return;
    const workMoved = workOf(next) !== workOf(profile);
    profile = next;
    if (!panel || !lastBlob) return;
    if (workMoved && last.address) {
      lookup(last.address, last.source); // the commute needs the new workplace located by the proxy
      return;
    }
    try {
      if (typeof panel.updateScore === 'function') panel.updateScore(scoreFor(lastBlob, profile), profile);
    } catch (err) {
      console.warn('[Listing Check] re-score failed', err);
    }
  }

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
      shadowMode,
      onSubmitAddress(text) {
        const t = String(text == null ? '' : text).trim();
        if (t) lookup(t, 'typed');
      },
      onPickCandidate(c) {
        const t = c && typeof c.display_name === 'string' ? c.display_name.trim() : '';
        if (!t) return;
        picked = { gnaf_id: typeof c.gnaf_id === 'string' ? c.gnaf_id : null, display_name: t };
        lookup(t, 'picked');
      },
      onProfileSave,
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
    lastBlob = null;
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
    lastBlob = null;
    setState({ kind: 'loading', address, source });
    const p = await loadProfile();
    if (myRun !== run || key !== keyOf(location.href)) return;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'MBX_LOOKUP', address, work: workOf(p) });
    } catch (err) {
      res = {
        ok: false,
        message: 'The extension was reloaded or its background worker is not answering. Reload this page.',
        detail: String((err && err.message) || err),
      };
    }
    if (myRun !== run || key !== keyOf(location.href)) return; // stale: page or query changed
    if (res && res.ok && res.blob) {
      res.blob = flagPickMismatch(res.blob, source);
      lastBlob = res.blob;
      setState({ kind: 'result', address, source, blob: res.blob, score: scoreFor(res.blob, profile), profile });
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

  // A pick is looked up again by its text; say so if the proxy landed on a different home than the one clicked.
  function flagPickMismatch(blob, source) {
    const m = blob && blob.match;
    if (source !== 'picked' || !picked || !picked.gnaf_id || !m || !m.gnaf_id || m.gnaf_id === picked.gnaf_id) return blob;
    const chk = m.check && typeof m.check === 'object' ? m.check : {};
    const notes = Array.isArray(chk.notes) ? chk.notes : [];
    const note = 'You picked ' + picked.display_name + '; closest match is ' + (m.display_name || 'another home');
    return { ...blob, match: { ...m, check: { ...chk, verdict: chk.verdict === 'exact' ? 'partial' : chk.verdict || 'weak', notes: [note, ...notes] } } };
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
      lastBlob = null;
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

  devP.then(() => {
    window.addEventListener('popstate', () => check(false));
    setInterval(() => check(false), URL_POLL_MS);
    check(true);
  });
})(globalThis.MBX);
