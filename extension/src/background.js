import { API_BASE } from "./config.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: "onboarding/index.html" });
});

async function requestMatch(tabId, body) {
  const key = `tab:${tabId}`;
  await chrome.storage.session.set({ [key]: { status: "loading", query: body.address } });
  let result;
  try {
    const { profile } = await chrome.storage.local.get("profile");
    const response = await fetch(`${API_BASE}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, profile: profile || null }),
    });
    result = await response.json();
  } catch {
    result = { status: "error", message: "Could not reach MicroMatch." };
  }
  await chrome.storage.session.set({ [key]: result });
  const score = result.status === "matched" ? String(result.match.overall) : "";
  await chrome.action.setBadgeText({ tabId, text: score });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "listing-address" && sender.tab) {
    if (message.address) requestMatch(sender.tab.id, { address: message.address });
    else chrome.storage.session.remove(`tab:${sender.tab.id}`);
  }
  // Sent by the side panel for typed addresses and "which unit?" choices.
  if (message.type === "manual-match") requestMatch(message.tabId, message.body);
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab:${tabId}`));
