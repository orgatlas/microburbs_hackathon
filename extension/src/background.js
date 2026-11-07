// MicroMatch service worker: the only part of the extension that talks to the network.
// In: the listing ADDRESS from the content script (nothing else is read off the page), or a typed
// address / chosen candidate from the side panel. Out: GET ${API_BASE}/lookup?address=&work=
// (&work= only when the saved profile has a workAddress) to the team proxy, which holds the Microburbs key and answers
// README Contract 2 ({ matched, facts, outsideCoverage }).
// Each tab's result lives in chrome.storage.session under "tab:<id>"; the side panel renders it.
import { API_BASE } from "./config.js";
// Namespace imports on purpose: a renamed or missing export can never stop the worker from
// starting. They are only used for the badge, feature-checked and wrapped in try/catch.
import * as adapterModule from "../sidepanel/adapter.js";
import * as profileModule from "../sidepanel/profile.js";
import * as scoreModule from "../sidepanel/score.js";

// No result cache here on purpose: every check asks the live proxy (it has its own cache), so a
// stopped proxy can never be masked by an old answer.
const TIMEOUT_MS = 25000; // below the worker's 30 s idle window
const SETTLE_MS = 700; // after a URL change, let the new listing render before asking for its address
const STALE_GUARD_MS = 5000; // after an in-page navigation, the old address is distrusted this long
const MAX_ADDRESS_CHARS = 200;
// A network failure or timeout of GET /lookup: no numbers, the panel offers a retry.
const OFFLINE = Object.freeze({ status: "error", code: "offline", message: "Backend offline" });

const tabKey = (tabId) => `tab:${tabId}`; // what the panel renders
const pickKey = (tabId) => `pick:${tabId}`; // the user's own correction ("Not this one?") for a page

// Memory only: a worker restart also kills any in-flight fetch, so nothing stale can land.
const inflight = new Map(); // tabId -> { token, key } of the newest request; older answers are dropped
const epochs = new Map(); // tabId -> navigation counter; bumped on every URL change
const lastUrls = new Map(); // tabId -> last URL seen, without the #hash
const lastAddresses = new Map(); // tabId -> normalised listing address last requested
const staleGuards = new Map(); // tabId -> { address, until, tries } after an in-page navigation
const settleTimers = new Map(); // tabId -> pending "extract-address" timer
let tokenCounter = 0;

const epochOf = (tabId) => epochs.get(tabId) || 0;
const isTabId = (tabId) => Number.isInteger(tabId) && tabId >= 0;
const quiet = (promise) => (promise && typeof promise.catch === "function" ? promise.catch(() => {}) : promise);

// ---------- setup (kept from the team worker) ----------

try {
  quiet(chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }));
} catch {
  // No sidePanel permission in the manifest: the worker must still run.
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") quiet(chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") }));
});

// ---------- helpers ----------

function stripHash(url) {
  return typeof url === "string" ? url.split("#")[0] : null;
}

function normalizeAddress(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

function hash(text) {
  let h = 0x811c9dc5; // FNV-1a, 32 bit: enough to tell two profiles apart
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// The panel's label for a picked candidate: shown as the query, never sent to the backend.
function cleanLabel(label) {
  return typeof label === "string" && label.trim() ? label.replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_CHARS) : null;
}

function cleanBody(body) {
  if (!body || typeof body !== "object") return null;
  const address =
    typeof body.address === "string" ? body.address.replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_CHARS) : "";
  const gnaf = typeof body.gnaf_id === "string" ? body.gnaf_id.trim().slice(0, 40) : "";
  if (!address && !gnaf) return null;
  return { address: address || null, gnaf_id: gnaf || null };
}

async function readProfile() {
  try {
    const { profile } = await chrome.storage.local.get("profile");
    if (profile && typeof profile === "object" && !Array.isArray(profile)) return profile;
  } catch {
    // Storage unavailable: no profile.
  }
  return null; // no default persona: no &work=, no fit badge
}

async function readSession(key) {
  try {
    return (await chrome.storage.session.get(key))[key];
  } catch {
    return undefined;
  }
}

// ---------- badge: the README fit, computed by the panel's own modules ----------

function findFunction(module, names) {
  for (const name of names) if (typeof module?.[name] === "function") return module[name];
  const fallback = module?.default;
  if (typeof fallback === "function") return fallback;
  for (const name of names) if (typeof fallback?.[name] === "function") return fallback[name].bind(fallback);
  return null;
}

function readFit(result) {
  if (typeof result === "number") return result;
  for (const name of ["fit", "overall", "score", "total", "value"]) {
    if (typeof result?.[name] === "number") return result[name];
  }
  return null;
}

async function computeFit(record, rawProfile) {
  const adapt = findFunction(adapterModule, ["adapt", "adaptResponse", "adaptBackend", "adaptMatch", "toSignals", "fromBackend"]);
  const normalize = findFunction(profileModule, ["normalizeProfile", "normaliseProfile", "normalize"]);
  const score = findFunction(scoreModule, ["scoreListing", "computeFit", "score", "computeScore", "fitScore", "scoreFit"]);
  if (!adapt || !score) return null;
  if (!rawProfile) return null; // no profile, no fit
  const profile = normalize ? await normalize(rawProfile) : rawProfile;
  if (!profile) return null; // nothing recognisable in the stored profile
  const adapted = await adapt(record);
  const fit = readFit(await score(adapted, profile));
  return Number.isFinite(fit) ? Math.max(0, Math.min(100, Math.round(fit))) : null;
}

async function setBadge(tabId, record, profile) {
  let text = "";
  let color = null;
  if (record?.status === "matched") {
    try {
      const fit = await computeFit(record, profile || (await readProfile())); // null without a profile: empty badge
      if (fit !== null) {
        text = String(fit);
        color = fit >= 70 ? "#1f7a4d" : fit <= 30 ? "#b42318" : "#9a6700"; // Halo / Failo / Meh
      }
    } catch {
      text = ""; // a module that is missing or throws only costs us the badge
    }
  } else if (record?.status === "ambiguous" || record?.status === "need_address") {
    text = "?"; // the panel needs the user: pick the home or type the address
    color = "#475467";
  }
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // Tab already closed.
  }
}

// ---------- the backend call ----------

async function fetchMatch(body, profile, label) {
  // The proxy matches by address text; a picked candidate is resent by its display name.
  const address = body.address || label || null;
  if (!address) return { status: "error", code: "missing_address", message: "Type the address to check it." };
  const url = new URL(`${API_BASE}/lookup`);
  url.searchParams.set("address", address.slice(0, MAX_ADDRESS_CHARS));
  const work = typeof profile?.workAddress === "string" ? profile.workAddress.trim() : "";
  if (work) url.searchParams.set("work", work.slice(0, MAX_ADDRESS_CHARS));
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ...OFFLINE }; // proxy down, unreachable or too slow (TimeoutError): never a stale or fake answer
  }
  let data;
  try {
    data = await response.json();
  } catch {
    // A server error page, a 404 page or a proxy answer: it reached the backend, so not "network".
    return {
      status: "error",
      code: `http_${response.status}`,
      message: `MicroMatch answered HTTP ${response.status} without JSON.`,
      httpStatus: response.status,
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      status: "error",
      code: "bad_response",
      message: `MicroMatch answered HTTP ${response.status} with something other than a JSON object.`,
      httpStatus: response.status,
    };
  }
  // README Contract 2 has no status field: derive one for the badge and the panel.
  // The proxy answers 403 + outsideCoverage for addresses outside the City of Sydney.
  if (data.error && typeof data.error === "object") {
    return {
      ...data,
      contract: 2,
      status: "error",
      code: typeof data.error.code === "string" && data.error.code ? data.error.code : `http_${response.status}`,
      message: typeof data.error.message === "string" && data.error.message ? data.error.message : `MicroMatch answered HTTP ${response.status}.`,
      httpStatus: response.status,
    };
  }
  if (data.outsideCoverage === true) return { ...data, contract: 2, status: "out_of_area", httpStatus: response.status };
  if (!response.ok) {
    return { ...data, contract: 2, status: "error", code: `http_${response.status}`, message: `MicroMatch answered HTTP ${response.status}.`, httpStatus: response.status };
  }
  const matched = data.matched && typeof data.matched === "object" ? data.matched : null;
  const status = !matched ? "no_match" : matched.gnaf_id ? "matched" : "ambiguous";
  return { ...data, contract: 2, status };
}

// Every write to "tab:<id>" goes through here so the badge always follows the record.
function writeRecord(tabId, record, profile) {
  const write = quiet(chrome.storage.session.set({ [tabKey(tabId)]: record }));
  quiet(setBadge(tabId, record, profile));
  return write;
}

function clearTab(tabId) {
  inflight.delete(tabId);
  const removal = quiet(chrome.storage.session.remove(tabKey(tabId)));
  quiet(setBadge(tabId, null));
  return removal;
}

// options.force skips the duplicate check (retry); options.pageUrl is the listing page;
// options.label names a picked candidate (its address) for the panel, since only its gnaf_id is sent.
async function requestMatch(tabId, rawBody, options = {}) {
  const body = cleanBody(rawBody);
  if (!isTabId(tabId) || !body) return;
  const epoch = epochOf(tabId);
  const profile = await readProfile();
  if (epochOf(tabId) !== epoch) return; // the tab navigated meanwhile
  const key = `${body.gnaf_id ? `g:${body.gnaf_id}` : `a:${normalizeAddress(body.address)}`}|${hash(stableStringify(profile))}`;
  if (!options.force && inflight.get(tabId)?.key === key) return; // the same request is already on its way

  const token = ++tokenCounter;
  inflight.set(tabId, { token, key });
  const isCurrent = () => inflight.get(tabId)?.token === token;
  const pageUrl = options.pageUrl ?? null;
  const label = cleanLabel(options.label);
  const query = body.address || label || body.gnaf_id;

  await writeRecord(tabId, { status: "loading", query, request: body, label, pageUrl, startedAt: new Date().toISOString() }, profile);
  const payload = await fetchMatch(body, profile, label);
  if (!isCurrent()) return; // superseded by a newer request or a URL change: drop it
  inflight.delete(tabId);

  const record = {
    ...payload,
    query: payload.query ?? query,
    fetchedAt: new Date().toISOString(),
    request: body,
    label,
    pageUrl,
  };
  await writeRecord(tabId, record, profile);
}

// ---------- navigation ----------

function askForAddress(tabId) {
  if (!isTabId(tabId)) return;
  quiet(
    chrome.tabs
      .sendMessage(tabId, { type: "extract-address" })
      .then((reply) => {
        // A content script may answer in the reply instead of sending its own message.
        if (reply && typeof reply === "object" && ("address" in reply || "listing" in reply)) {
          handleListingAddress(tabId, reply, lastUrls.get(tabId) ?? null);
        }
      })
      .catch(async () => {
        // No content script on this page (not a listing site): end in the empty state, unless a
        // request started meanwhile (a typed address on this tab).
        const shown = await readSession(tabKey(tabId));
        if (!shown || (shown.status === "loading" && !shown.request)) await clearTab(tabId);
      }),
  );
}

function navigated(tabId, { inPage = false } = {}) {
  epochs.set(tabId, epochOf(tabId) + 1);
  // The previous home's score must never show on the next page. A "checking" record (no request)
  // replaces it instead of an empty one, so an in-page URL change on a listing site does not flash
  // "Open a listing" before the content script reports the new address.
  inflight.delete(tabId);
  quiet(writeRecord(tabId, { status: "loading", query: null, pageUrl: null, startedAt: new Date().toISOString() }));
  const previous = lastAddresses.get(tabId);
  if (inPage && previous) staleGuards.set(tabId, { address: previous, until: Date.now() + STALE_GUARD_MS, tries: 0 });
  else staleGuards.delete(tabId);
  clearTimeout(settleTimers.get(tabId));
  settleTimers.set(tabId, setTimeout(() => askForAddress(tabId), SETTLE_MS));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Without the tabs or host permission Chrome leaves changeInfo.url out for these sites, so in
  // practice every navigation (full load, pushState, hash, query) arrives as status "loading" and
  // takes the second branch. The url branch only applies if the tabs permission is ever granted.
  if (changeInfo.url) {
    const url = stripHash(changeInfo.url);
    const previous = lastUrls.get(tabId);
    lastUrls.set(tabId, url);
    if (previous === url && changeInfo.status !== "loading") return; // only the #hash changed: same listing
    navigated(tabId, { inPage: changeInfo.status !== "loading" });
  } else if (changeInfo.status === "loading") {
    navigated(tabId);
  } else if (changeInfo.status === "complete") {
    readSession(tabKey(tabId)).then((record) => {
      if (!record || (record.status === "loading" && !record.request)) askForAddress(tabId);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const map of [inflight, epochs, lastUrls, lastAddresses, staleGuards]) map.delete(tabId);
  clearTimeout(settleTimers.get(tabId));
  settleTimers.delete(tabId);
  quiet(chrome.storage.session.remove([tabKey(tabId), pickKey(tabId)]));
});

// A new quiz result changes every score: re-run each tab that has a home on screen.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !("profile" in changes)) return;
  quiet(
    chrome.storage.session.get(null).then((all) => {
      for (const [name, record] of Object.entries(all || {})) {
        if (!name.startsWith("tab:") || !record?.request) continue;
        requestMatch(Number(name.slice(4)), record.request, { pageUrl: record.pageUrl ?? null, label: record.label ?? null });
      }
    }),
  );
});

// ---------- messages ----------

async function handleListingAddress(tabId, message, pageUrl) {
  const address = typeof message.address === "string" ? message.address.trim() : "";
  if (!address && message.listing !== true) {
    lastAddresses.delete(tabId);
    staleGuards.delete(tabId);
    await clearTab(tabId); // search results or any other page: empty state
    return;
  }
  if (address) {
    // After an in-page navigation the page may still show the old listing for a moment.
    const guard = staleGuards.get(tabId);
    if (guard && Date.now() < guard.until && guard.tries < 3 && normalizeAddress(address) === guard.address) {
      guard.tries += 1;
      clearTimeout(settleTimers.get(tabId));
      settleTimers.set(tabId, setTimeout(() => askForAddress(tabId), 900));
      return;
    }
    staleGuards.delete(tabId);
  }
  const epoch = epochOf(tabId);
  const pick = await readSession(pickKey(tabId));
  if (epochOf(tabId) !== epoch) return;
  if (pick?.url && pick.url === stripHash(pageUrl) && pick.body) {
    requestMatch(tabId, pick.body, { pageUrl, label: pick.label ?? null }); // the user already corrected this page's home
    return;
  }
  if (!address) {
    inflight.delete(tabId);
    lastAddresses.delete(tabId);
    await writeRecord(tabId, { status: "need_address", query: null, pageUrl, fetchedAt: null });
    return;
  }
  lastAddresses.set(tabId, normalizeAddress(address));
  requestMatch(tabId, { address, gnaf_id: null }, { pageUrl });
}

async function handleManualMatch(tabId, rawBody) {
  const body = cleanBody(rawBody);
  if (!isTabId(tabId) || !body) return;
  const shown = await readSession(tabKey(tabId));
  const pageUrl = shown?.pageUrl ?? lastUrls.get(tabId) ?? null;
  const label = cleanLabel(rawBody?.label);
  if (pageUrl) quiet(chrome.storage.session.set({ [pickKey(tabId)]: { url: stripHash(pageUrl), body, label } }));
  requestMatch(tabId, body, { pageUrl, label });
}

async function handleRetry(tabId) {
  if (!isTabId(tabId)) return;
  const shown = await readSession(tabKey(tabId));
  if (shown?.request) requestMatch(tabId, shown.request, { force: true, pageUrl: shown.pageUrl ?? null, label: shown.label ?? null });
  else askForAddress(tabId); // nothing requested yet: ask the page for its address again
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || sender?.id !== chrome.runtime.id) return false;
  if (message.type === "listing-address") {
    const tabId = sender.tab?.id;
    if (!isTabId(tabId)) return false; // only content scripts in a tab report a listing
    if (sender.frameId) return false; // top frame only: the listing, not an embedded ad
    const pageUrl = stripHash(sender.url || sender.tab.url || null);
    quiet(handleListingAddress(tabId, message, pageUrl));
  } else if (message.type === "manual-match") {
    quiet(handleManualMatch(Number(message.tabId), message.body));
  } else if (message.type === "retry") {
    quiet(handleRetry(Number(message.tabId)));
  } else {
    return false;
  }
  sendResponse({ ok: true });
  return false;
});
