// Service worker: the only part of the extension that talks to the network.
// It receives a listing address from the content script and asks our proxy,
// which holds the Microburbs key. Only the address string leaves the page.
import { PROXY_URL } from './src/config.js';

const MAX_ADDRESS_CHARS = 200;
// Above the proxy's worst case for a rate-limited call, below the worker's 30 s idle window.
const TIMEOUT_MS = 28000;

function unreachable(detail) {
  return {
    ok: false,
    message: 'Could not reach the Listing Check proxy at ' + PROXY_URL + '. Is it running?',
    detail: String(detail || ''),
  };
}

function notJson(detail) {
  return { ok: false, message: 'The proxy answered with something that is not JSON.', detail: String(detail || '') };
}

async function lookup(address, work) {
  let url = PROXY_URL + '/lookup?address=' + encodeURIComponent(address);
  if (work) url += '&work=' + encodeURIComponent(work);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const name = err && err.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        message: 'The proxy is taking too long (it may be retrying a rate-limited request). Retry in a few seconds.',
        detail: 'No answer after ' + TIMEOUT_MS / 1000 + ' s (' + name + ')',
      };
    }
    return unreachable(err && err.message ? err.message : err);
  }
  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    return unreachable('HTTP ' + res.status + ', body could not be read: ' + (err && err.message));
  }
  let blob;
  try {
    blob = JSON.parse(text);
  } catch {
    return notJson('HTTP ' + res.status + ', response was not JSON: ' + text.slice(0, 120));
  }
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    return notJson('HTTP ' + res.status + ', response was not a JSON object');
  }
  return { ok: true, httpStatus: res.status, blob };
}

// Panel template + stylesheet, read once from the extension's own files (no web_accessible_resources needed:
// the worker runs on the extension origin). A failed read is not cached, so the next ask retries.
let assetsPromise = null;
async function readAsset(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
  return res.text();
}
function getAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([readAsset('panel/panel.html'), readAsset('panel/panel.css')])
      .then(([html, css]) => ({ ok: true, html, css }))
      .catch((err) => {
        assetsPromise = null;
        return { ok: false, message: 'Could not read the panel files.', detail: String((err && err.message) || err) };
      });
  }
  return assetsPromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (!msg) return false;
  if (msg.type === 'MBX_ASSETS') {
    getAssets().then(sendResponse);
    return true;
  }
  if (msg.type !== 'MBX_LOOKUP') return false;
  const address = typeof msg.address === 'string' ? msg.address.trim().slice(0, MAX_ADDRESS_CHARS) : '';
  // The workplace address is the only profile field that leaves the browser (to place the commute).
  const work = typeof msg.work === 'string' ? msg.work.replace(/\s+/g, ' ').trim().slice(0, MAX_ADDRESS_CHARS) : '';
  if (!address) {
    sendResponse({ ok: false, message: 'No address to look up.', detail: '' });
    return false;
  }
  lookup(address, work)
    .then(sendResponse)
    .catch((err) => sendResponse(unreachable(err && err.message ? err.message : err)));
  return true; // keep the channel open for the async answer
});

// Toolbar button: reopen the panel on the current listing after it was closed.
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'MBX_OPEN' }).catch(() => {});
});
