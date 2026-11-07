// MicroMatch side panel controller. Reads the tab's record from chrome.storage.session ("tab:<id>",
// written by src/background.js), adapts it (adapter.js), scores it for the profile (score.js) and
// hands the pieces to the components. It never talks to the network and never reads the listing page:
// background.js holds the only backend call, and the content script sends only the address.
// Tests can pin the panel to a tab with ?tabId=<id>; otherwise it follows the active tab.
import { adapt } from "./adapter.js";
import { scoreListing } from "./score.js";
import { renderFit } from "./fit.js";
import { loadProfile, openOnboarding, renderProfile } from "./profile.js";
import { initAccount } from "./account.js";
import { SITE_URL } from "../src/config.js";

const STATES = new Set(["empty", "loading", "need_address", "matched", "ambiguous", "no_match", "out_of_area", "error"]);
// background.js gives up on a fetch after 25 s; a "checking" record older than this has lost its worker.
const STALL_MS = 30000;
const BASICS_SOURCE = "Microburbs /v1/properties/{gnaf_id}/basics/all";
const CONFIDENCE_TEXT = {
  exact: "Exact match",
  building: "Same building: the unit number is missing or differs",
  guess: "Best guess: this address differs from the listing, check it",
};

const view = document.getElementById("view");
const picker = document.getElementById("mm-picker");
const pickerToggle = document.querySelector('[data-action="not-this-one"]');
const form = document.querySelector('form[data-slot="typeit"]');
const input = document.getElementById("mm-typeit-input");

const pinnedTabId = (() => {
  const raw = new URLSearchParams(location.search).get("tabId");
  const id = raw === null ? NaN : Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : null;
})();

let tabId = pinnedTabId;
let stored = null;
let userPick = null; // background's "pick:<id>": the address the user typed or picked for this page
let profile = null; // the user's own quiz profile; null = none saved (no default persona, no score)
let refreshSeq = 0;
let stallTimer = null;
const typed = new Set(); // addresses typed into the box this session, so the listing line can say so
const handles = { fit: null, profile: null };

// ---------- small DOM helpers (textContent only, never innerHTML with data) ----------

const slot = (name) => document.querySelector(`[data-slot="${name}"]`);
function bind(name, text) {
  for (const node of document.querySelectorAll(`[data-bind="${name}"]`)) node.textContent = text ?? "";
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const norm = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
const send = (message) => {
  try {
    return chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    return Promise.resolve();
  }
};

// ---------- tab + data ----------

async function resolveTabId() {
  if (pinnedTabId !== null) return pinnedTabId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return Number.isInteger(tab?.id) ? tab.id : null;
  } catch {
    return null;
  }
}

async function readRecord(id) {
  if (id === null) return { record: null, pick: null };
  try {
    const got = await chrome.storage.session.get([`tab:${id}`, `pick:${id}`]);
    return { record: got[`tab:${id}`] ?? null, pick: got[`pick:${id}`] ?? null };
  } catch {
    return { record: null, pick: null };
  }
}

async function refresh() {
  const seq = ++refreshSeq;
  const id = await resolveTabId();
  const [{ record, pick: savedPick }, prof] = await Promise.all([readRecord(id), loadProfile()]);
  if (seq !== refreshSeq) return; // a newer refresh started meanwhile
  tabId = id;
  stored = record;
  userPick = savedPick;
  profile = prof;
  render();
}

// ---------- rendering ----------

function setState(state) {
  if (view.dataset.state !== state) {
    view.dataset.state = state;
    closePicker();
  }
}

function candidateList(list, candidates, currentId) {
  list.replaceChildren(
    ...candidates.map((c) => {
      const button = el(
        "button",
        { type: "button", className: "mm-cand", "aria-current": c.gnaf_id && c.gnaf_id === currentId ? "true" : null },
        c.display_name || c.address || c.gnaf_id || "Unnamed address",
        c.property_type ? el("small", {}, c.property_type) : null,
      );
      button.addEventListener("click", () => pick(c));
      return el("li", {}, button);
    }),
  );
}

function pick(candidate) {
  if (tabId === null) return;
  closePicker();
  const name = candidate.display_name || candidate.address || null;
  showLoading(name || candidate.gnaf_id);
  // API_CONTRACT: once the user has picked a candidate, send its gnaf_id (alone, so the backend never
  // re-geocodes the candidate's name). The name travels only as the label the panel shows.
  const body = candidate.gnaf_id ? { gnaf_id: candidate.gnaf_id, address: null, label: name } : { gnaf_id: null, address: name };
  send({ type: "manual-match", tabId, body });
}

function showLoading(query) {
  setState("loading");
  bind("query", query || "this home");
  bind("status", `Checking ${query || "this home"}`);
  // background.js normally writes a loading record at once; re-read in case the answer came from its cache.
  setTimeout(refresh, 1500);
}

function listingLine(adapted) {
  const query = adapted.query;
  const request = stored?.request || {};
  if (request.gnaf_id) {
    return query && query !== request.gnaf_id ? `Listing: ${query} · you picked this home` : "Listing: picked from the candidates";
  }
  if (!query) return "Listing: address not known";
  const pickedAddress = userPick?.body && !userPick.body.gnaf_id ? userPick.body.address : null;
  if (typed.has(norm(query)) || (pickedAddress && norm(pickedAddress) === norm(request.address))) return `Listing: ${query} · typed by you`;
  return `Listing: ${query} · read from the page`;
}

function propertyLine(property) {
  if (!property) return "";
  const bits = [];
  if (property.bed_count !== null && property.bed_count !== undefined) bits.push(`${property.bed_count} bed`);
  if (property.bath_count !== null && property.bath_count !== undefined) bits.push(`${property.bath_count} bath`);
  if (property.parking_count !== null && property.parking_count !== undefined) bits.push(`${property.parking_count} parking`);
  if (property.dwelling_type) bits.push(String(property.dwelling_type));
  return bits.length ? bits.join(" · ") : "Bed, bath and parking: no data";
}

function renderNotices(adapted, result) {
  const box = slot("notices");
  const items = [];
  for (const d of adapted.backend?.dealbreakers || []) {
    if (d.message) items.push(el("li", { className: "mm-notice", dataset: { kind: "dealbreaker" } }, el("strong", { className: "mm-notice__tag" }, "Dealbreaker"), " ", d.message));
  }
  for (const gap of adapted.backend?.data_gaps || []) {
    items.push(el("li", { className: "mm-notice", dataset: { kind: "gap" } }, gap));
  }
  const nodes = [];
  if (items.length) nodes.push(el("ul", { className: "mm-notices" }, ...items));
  const missing = result?.missing || [];
  if (missing.length) {
    const { scored = 0, total = 0 } = result.coverage || {};
    const details = el(
      "details",
      { className: "mm-missing" },
      el("summary", {}, `Not scored: ${missing.length} signal${missing.length === 1 ? "" : "s"} had no data (${scored} of ${total} scored). Missing data is skipped, never counted as zero.`),
      el(
        "ul",
        { className: "mm-gaps" },
        ...missing.map((m) => el("li", {}, `${m.label || m.key}: ${m.reason || "no data"}`)),
      ),
    );
    nodes.push(details);
  }
  box.replaceChildren(...nodes);
}

// No profile in chrome.storage.local: the matched address plus one "Take the quiz" button. No speedo,
// pros/cons, sliders or numbers. A profile arriving (storage.onChanged "profile") re-renders the fit.
function renderNoProfile(matched) {
  bind("facts", "");
  const factsNode = document.querySelector('[data-bind="facts"]');
  if (factsNode) factsNode.title = "";
  handles.fit = null;
  handles.profile = null;
  slot("fit").replaceChildren(
    el(
      "div",
      { className: "mm-quiz-cta", dataset: { state: "no-profile" } },
      el("p", { className: "mm-quiz-cta__title" }, "Take the quiz to see your fit"),
      el("p", { className: "mm-quiz-cta__text" }, "Your fit is weighed by your own quiz answers. Take it once and every listing is scored for you."),
      el("button", { type: "button", className: "mm-btn", dataset: { action: "open-quiz" } }, "Take the quiz"),
    ),
  );
  slot("notices").replaceChildren();
  slot("profile").replaceChildren();
  bind("status", `Matched ${matched.display_name || "a home"}. Take the quiz to see your fit.`);
}

function openQuiz() {
  const url = `${SITE_URL}/quiz`;
  try {
    if (chrome?.tabs?.create) return chrome.tabs.create({ url }).catch(() => {});
  } catch {
    // not inside the extension: fall through to a plain new tab
  }
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}

function renderMatched(adapted) {
  const matched = adapted.matched || {};
  bind("address", matched.display_name || "Address not returned");
  bind("listing", matched.confidence === "exact" ? "" : listingLine(adapted));
  const conf = document.querySelector('[data-bind="confidence"]');
  conf.textContent = CONFIDENCE_TEXT[matched.confidence] || "";
  if (matched.confidence) conf.dataset.confidence = matched.confidence;
  else delete conf.dataset.confidence;
  bind("facts", propertyLine(adapted.property));
  // README rule: every number on screen shows its source.
  const factsNode = document.querySelector('[data-bind="facts"]');
  if (factsNode) {
    if (adapted.property) factsNode.append(el("span", { className: "mm-addr__src", title: BASICS_SOURCE }, " · source: basics/all"));
    factsNode.title = adapted.property ? `Source: ${BASICS_SOURCE}` : "";
  }
  candidateList(slot("candidates"), adapted.candidates || matched.candidates || [], matched.gnaf_id);

  if (!profile) return renderNoProfile(matched);

  const result = scoreListing(adapted, profile);
  const options = { trusted: matched.confidence === "exact", identity: matched.gnaf_id || matched.display_name, profile };
  if (handles.fit) handles.fit.update(result, options);
  else handles.fit = renderFit(slot("fit"), result, options);

  renderNotices(adapted, result);

  if (handles.profile) handles.profile.update(profile);
  else handles.profile = renderProfile(slot("profile"), profile, { onOpenOnboarding: openOnboarding });

  const fitText = !options.trusted ? "Confirm the matched address to see its fit" : result.fit === null ? "Not scored yet" : `Fit ${result.fit} of 100`;
  bind("status", `Matched ${matched.display_name || "a home"}. ${fitText}.`);
}

function render() {
  let adapted;
  try {
    adapted = adapt(stored);
  } catch (error) {
    adapted = { status: "error", message: `The panel could not read this answer (${error?.message || error}).` };
  }
  let state = STATES.has(adapted.status) ? adapted.status : "error";
  clearTimeout(stallTimer);
  if (state === "loading") {
    const started = Date.parse(stored?.startedAt || "");
    if (Number.isFinite(started) && Date.now() - started > STALL_MS) {
      // The service worker was stopped mid-fetch (its in-memory request died with it).
      state = "error";
      adapted = { ...adapted, status: "error", message: "This check stopped before it finished.", code: "stalled" };
    } else {
      stallTimer = setTimeout(refresh, (Number.isFinite(started) ? Math.max(0, started + STALL_MS - Date.now()) : STALL_MS) + 1000);
    }
  }
  const fetched = adapted.fetchedAt ? new Date(adapted.fetchedAt) : null;
  // The footer's as-of: when these facts were fetched (no backend factor carries its own date yet).
  // Only for a scored home; an error or "outside coverage" answer has no facts to date.
  bind(
    "asof",
    state === "matched" && profile && fetched && !Number.isNaN(fetched.getTime())
      ? ` · Fetched ${fetched.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "",
  );

  if (state === "matched") {
    try {
      renderMatched(adapted);
    } catch (error) {
      state = "error";
      adapted = { ...adapted, message: `The panel could not score this home (${error?.message || error}).` };
    }
  }
  setState(state);

  if (state === "loading") {
    bind("query", adapted.query || "this home");
    bind("status", `Checking ${adapted.query || "this home"}`);
  } else if (state === "ambiguous") {
    candidateList(slot("ambiguous-list"), adapted.candidates || [], null);
    bind("status", `Which home is this? ${adapted.candidates?.length || 0} candidates.`);
  } else if (state === "no_match") {
    const section = view.querySelector('[data-for="no_match"]');
    let list = section.querySelector('ul[data-list="no-match"]');
    if (!list) {
      // Same data-slot as the ambiguous list so it gets the candidate-row styling; it sits later in the DOM,
      // so slot("ambiguous-list") still finds the ambiguous section's list first.
      list = el("ul", { "data-slot": "ambiguous-list", "data-list": "no-match", "aria-label": "Closest addresses" });
      section.append(list);
    }
    candidateList(list, adapted.candidates || [], null);
    bind("status", "We couldn't find that address.");
  } else if (state === "out_of_area") {
    bind("message", adapted.message || "MicroMatch covers the City of Sydney only for now.");
    bind("status", "Outside the City of Sydney.");
  } else if (state === "error") {
    // Offline (proxy down, unreachable or too slow): one line, "Backend offline — retry", no numbers.
    const offline = adapted.code === "offline";
    const section = view.querySelector('[data-for="error"]');
    if (offline) section.dataset.code = "offline";
    else delete section.dataset.code;
    const line = view.querySelector('[data-bind="error"]');
    if (offline) {
      line.replaceChildren("Backend offline — ", el("button", { type: "button", className: "mm-retry-inline", dataset: { action: "retry" } }, "retry"));
    } else {
      line.replaceChildren([adapted.message, adapted.code ? `(${adapted.code})` : null].filter(Boolean).join(" "));
    }
    bind("status", offline ? "Backend offline. Retry." : "We couldn't check this home.");
  } else if (state === "need_address") {
    bind("status", "No address on this page. Type it below.");
  } else if (state === "empty") {
    bind("status", "Open a listing to see how well it fits you.");
  }
}

// ---------- picker ----------

function closePicker() {
  if (!picker || picker.hidden) return;
  picker.hidden = true;
  pickerToggle?.setAttribute("aria-expanded", "false");
}

pickerToggle?.addEventListener("click", () => {
  const open = picker.hidden;
  picker.hidden = !open;
  pickerToggle.setAttribute("aria-expanded", String(open));
  if (open && !slot("candidates").children.length) input?.focus(); // no alternatives: go straight to the type-it box
});

// ---------- actions ----------

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  const action = target.dataset.action;
  if (action === "open-onboarding") openOnboarding();
  else if (action === "open-quiz") openQuiz();
  else if (action === "retry" && tabId !== null) {
    showLoading(stored?.query || stored?.request?.address || null);
    send({ type: "retry", tabId });
  }
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const address = String(input?.value || "").replace(/\s+/g, " ").trim();
  if (!address || tabId === null) return;
  typed.add(norm(address));
  showLoading(address);
  send({ type: "manual-match", tabId, body: { address, gnaf_id: null } });
});

// ---------- live updates ----------

chrome.storage.session.onChanged.addListener((changes) => {
  if (tabId !== null && `tab:${tabId}` in changes) refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "profile" in changes) refresh();
});
chrome.tabs.onActivated.addListener(() => {
  if (pinnedTabId === null) refresh();
});
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && (changeInfo.status || changeInfo.url)) refresh();
});
try {
  chrome.windows?.onFocusChanged?.addListener(() => {
    if (pinnedTabId === null) refresh();
  });
} catch {
  // windows API not available here: the tab listeners still cover it.
}

initAccount();
refresh();
