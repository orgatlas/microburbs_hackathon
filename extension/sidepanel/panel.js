// TODO(Hrithik): this is the bare flow. Design the real panel on top of it.
const view = document.getElementById("view");

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderMatched(result) {
  view.append(
    element("div", "muted", `Matched: ${result.property.address}`),
    element("div", "score", result.match.overall),
    element("div", "", result.match.label),
    element("p", "muted", result.match.summary),
  );
  for (const pillar of result.match.pillars) {
    const block = element("details", "pillar");
    block.append(element("summary", "", `${pillar.label}: ${pillar.score}`), element("div", "muted", pillar.summary));
    for (const factor of pillar.factors) {
      block.append(element("div", "factor", `${factor.label}: ${factor.value}. ${factor.detail}`));
    }
    view.append(block);
  }
}

function renderCandidates(result) {
  view.append(element("p", "", "Which home is this?"));
  for (const candidate of result.candidates) {
    const button = element("button", "candidate", candidate.address);
    button.onclick = async () => {
      chrome.runtime.sendMessage({
        type: "manual-match",
        tabId: await activeTabId(),
        body: { gnaf_id: candidate.gnaf_id, address: candidate.address },
      });
    };
    view.append(button);
  }
}

async function render() {
  const tabId = await activeTabId();
  const stored = await chrome.storage.session.get(`tab:${tabId}`);
  const result = stored[`tab:${tabId}`];
  view.replaceChildren();
  if (!result) view.append(element("p", "muted", "Open a listing on realestate.com.au or domain.com.au."));
  else if (result.status === "loading") view.append(element("p", "muted", `Checking ${result.query}…`));
  else if (result.status === "matched") renderMatched(result);
  else if (result.status === "ambiguous") renderCandidates(result);
  else if (result.status === "no_match") view.append(element("p", "", "We couldn't find that address."));
  else view.append(element("p", "", result.message));
}

document.getElementById("manual").addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = document.getElementById("address").value.trim();
  if (address) chrome.runtime.sendMessage({ type: "manual-match", tabId: await activeTabId(), body: { address } });
});

chrome.storage.session.onChanged.addListener(render);
chrome.tabs.onActivated.addListener(render);
chrome.tabs.onUpdated.addListener(render);
render();
