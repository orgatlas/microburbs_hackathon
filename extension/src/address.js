// Finds the listing's address and nothing else. The brief forbids collecting any
// other listing text or photos, so never widen these selectors to read more.
// TODO(Hrithik): confirm these selectors against live listings on both sites.
const ADDRESS_SELECTORS = {
  "www.realestate.com.au": ["h1.property-info-address", "h1"],
  "www.domain.com.au": ['[data-testid="listing-details__button-copy-wrapper"] h1', "h1"],
};

function looksLikeAddress(text) {
  return /\d/.test(text) && /\b(NSW|\d{4})\b/.test(text);
}

function cleanAddress(text) {
  return text.replace(/\s+/g, " ").trim();
}

function findAddress(hostname, doc) {
  for (const selector of ADDRESS_SELECTORS[hostname] || []) {
    const text = cleanAddress(doc.querySelector(selector)?.textContent || "");
    if (looksLikeAddress(text)) return text;
  }
  return null;
}

if (typeof module !== "undefined") module.exports = { findAddress, looksLikeAddress, cleanAddress };
