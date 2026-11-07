// Address extraction for realestate.com.au and domain.com.au listing pages.
//
// PRIVACY (README hard rule 1): this file reads ONLY the listing's address,
// from two places, in order: JSON-LD address fields (PostalAddress parts or a
// plain "address" string), then the address h1. If neither yields an address,
// extractAddress resolves null and the panel asks the user to type it. It
// never reads the page title, body text, prices, photos or agent details, and
// every non-address JSON-LD field is discarded as soon as it is parsed. The
// tab's URL path is used only to rank candidates already found, never as an
// address source. Nothing is stored (no localStorage, no chrome.storage) and
// nothing is sent from here; content.js hands the address string to the
// service worker.
globalThis.MBX = globalThis.MBX || {};

(function (MBX) {
  'use strict';

  const POLL_MS = 300;

  // ---------------------------------------------------------------- pages

  // realestate.com.au: /property-<type>-<state>-<suburb+slug>-<id>
  // (buy, rent and sold listings all use this shape; /sold/ prefix tolerated)
  const REA_LISTING = /^\/(?:sold\/|rent\/|buy\/)?property-[a-z0-9+%-]+-(?:nsw|vic|qld|wa|sa|tas|act|nt)-[a-z0-9+%.'-]+-\d{5,}\/?$/i;
  // domain.com.au: /<address-slug>-<id of 6+ digits>, or /property-profile/<slug>
  const DOMAIN_LISTING = /^\/[a-z0-9][a-z0-9-]*-\d{6,}\/?$/i;
  const DOMAIN_PROFILE = /^\/property-profile\/[a-z0-9][a-z0-9-]+\/?$/i;

  MBX.isListingPage = function isListingPage(url) {
    let u;
    try {
      u = new URL(String(url || ''));
    } catch {
      return false;
    }
    const host = u.hostname.toLowerCase();
    const p = u.pathname;
    if (host === 'www.realestate.com.au' || host === 'realestate.com.au') return REA_LISTING.test(p);
    if (host === 'www.domain.com.au' || host === 'domain.com.au') return DOMAIN_LISTING.test(p) || DOMAIN_PROFILE.test(p);
    return false;
  };

  // ------------------------------------------------------------ validation

  const REJECT = [
    /address\s+(?:is\s+)?(?:available|provided|disclosed|supplied)?\s*(?:on|upon|by)\s+(?:request|application|enquiry)/i,
    /\b(?:address|location)\s+(?:withheld|undisclosed|hidden|confidential)\b/i,
    /\bcontact\s+(?:the\s+)?agents?\b/i,
    /\bunder\s+(?:offer|contract)\b/i,
    /\bprice\s+(?:on|upon)\s+application\b/i,
    /\bexpressions?\s+of\s+interest\b/i,
    /\bauction\b/i,
    /\bfor\s+(?:sale|rent|lease)\b/i,
    /\bopen\s+(?:home|house|for\s+inspection)\b/i,
    /\bsearch\s+results?\b/i,
    /\bproperties\s+(?:for|in)\b/i,
    /\b(?:just\s+)?(?:sold|leased)\b\s*$/i,
  ];

  const STREET_WORD = new RegExp(
    '\\b(?:street|st|road|rd|avenue|ave|av|lane|ln|place|pl|parade|pde|drive|dr|crescent|cres|cr|way|close|cl|' +
      'court|ct|terrace|tce|boulevard|blvd|bvd|highway|hwy|square|sq|walk|mews|row|grove|gr|circuit|cct|esplanade|esp|' +
      'loop|plaza|quay|rise|wharf|broadway|wynd|alley|arcade|concourse|promenade|ridge|vista|gardens|gdns|green|' +
      'link|mall|path|strand|crossing|cove|corso|circle|cir|bend|approach|crest|glade|gate|heights|hts|junction|' +
      'outlook|retreat|reserve|track|trail|view)\\b\\.?',
    'i'
  );
  // a street number: "12", "12A", "5/12", "5-7", "Unit 5, 12", "Lot 3", and
  // lettered or dotted units: "G05/12", "C501/2", "B1203/8", "PH1/12", "3.01/12"
  const STREET_NUMBER = /(?:^|[\s,(])(?:(?:unit|apt|apartment|suite|shop|lot|level|villa|townhouse)\s*)?[a-z]{0,2}\d+(?:\.\d+)?[a-z]?(?:\s*[/\-–]\s*\d+[a-z]?)*\s*,?\s+[a-z]/i;
  const COMMA_SUBURB = /,\s*[a-z][a-z' .-]{2,}/i;

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[  -​  　]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .trim();
  }

  MBX.looksLikeAddress = function looksLikeAddress(text) {
    const t = clean(text);
    if (t.length < 6 || t.length > 160) return false;
    for (const re of REJECT) if (re.test(t)) return false;
    if (!STREET_NUMBER.test(t)) return false;
    return STREET_WORD.test(t) || COMMA_SUBURB.test(t);
  };

  // --------------------------------------------------------------- JSON-LD

  // Subtrees that describe the agent / agency / site, never the home.
  // (also catches EducationalOrganization, School, LocalBusiness, RealEstateAgent...)
  const SKIP_TYPES = /(?:organization|organisation|agent|agency|business|corporation|school|person|website|webpage|breadcrumblist|brand|imageobject|searchaction)$/i;
  const SKIP_KEYS = /^(?:seller|offeredby|provider|author|publisher|agent|agents|brand|broker|organizer|performer|creator|contactpoint|employee|member|founder|sponsor|potentialaction|image|logo|breadcrumb)$/i;

  function typesOf(o) {
    const t = o && o['@type'];
    return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
  }

  function str(v) {
    return typeof v === 'string' ? clean(v) : typeof v === 'number' ? String(v) : '';
  }

  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // True when the street text already ends with ", <locality>" (optionally
  // followed by state/postcode). A street named after its suburb
  // ("150 Glebe Point Road" in Glebe) does not count.
  function hasLocalityPart(street, locality) {
    return new RegExp(',\\s*' + esc(locality) + '(?=\\s*(?:,|$|\\d{4}\\b|(?:nsw|vic|qld|wa|sa|tas|act|nt)\\b))', 'i').test(street);
  }

  // "streetAddress, addressLocality addressRegion postalCode", without repeating
  // parts the streetAddress already carries.
  function composePostal(a) {
    const street = str(a.streetAddress);
    if (!street) return '';
    const locality = str(a.addressLocality);
    const region = str(a.addressRegion);
    const postcode = str(a.postalCode);
    let tail = [];
    if (locality && !hasLocalityPart(street, locality)) tail.push(locality);
    if (region && !new RegExp('\\b' + region.replace(/[^a-z]/gi, '') + '\\b', 'i').test(street)) tail.push(region);
    if (postcode && !street.includes(postcode)) tail.push(postcode);
    tail = tail.join(' ');
    return tail ? street.replace(/,\s*$/, '') + ', ' + tail : street;
  }

  // Walks one parsed JSON-LD document and returns address strings only.
  function addressesIn(root) {
    const found = [];
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typesOf(node).some((t) => SKIP_TYPES.test(t))) return;
      if (typeof node.streetAddress === 'string') {
        const s = composePostal(node);
        if (s) found.push(s);
      }
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.test(key)) continue;
        const v = node[key];
        if (key === 'address' && typeof v === 'string') found.push(clean(v));
        else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(root, 0);
    return found;
  }

  function fromJsonLd() {
    const out = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(script.textContent || '');
      } catch {
        continue;
      }
      for (const a of addressesIn(parsed)) out.push(a);
      parsed = null; // discard everything else immediately
    }
    return out;
  }

  // -------------------------------------------------------------------- h1

  // Site-specific address headings first, then the first h1 on the page.
  const H1_SELECTORS = [
    // realestate.com.au
    'h1.property-info-address',
    '[class*="property-info-address"] h1',
    'h1[class*="address" i]',
    // domain.com.au
    '[data-testid="listing-details__button-copy-wrapper"] h1',
    'h1[data-testid="listing-details__summary-title"]',
    'h1[data-testid*="address" i]',
    '[data-testid*="address" i] h1',
  ];

  function fromH1() {
    const out = [];
    for (const sel of H1_SELECTORS) {
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch {
        el = null;
      }
      if (el) out.push(clean(el.textContent));
    }
    const first = document.querySelector('h1');
    if (first) out.push(clean(first.textContent));
    return out;
  }

  // Prefer the candidate that shares the most words with the URL slug
  // (Domain slugs carry the whole address, REA slugs carry the suburb).
  function urlScore(addr) {
    let path = '';
    try {
      path = decodeURIComponent(location.pathname).toLowerCase();
    } catch {
      path = String(location.pathname).toLowerCase();
    }
    const tokens = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
    const words = addr.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    return words.reduce((n, w) => n + (tokens.has(w) ? 1 : 0), 0);
  }

  function pick(candidates) {
    const valid = [];
    for (const c of candidates) {
      const a = clean(c);
      if (MBX.looksLikeAddress(a) && !valid.includes(a)) valid.push(a);
    }
    if (!valid.length) return null;
    let best = valid[0];
    let bestScore = urlScore(best);
    for (const a of valid.slice(1)) {
      const s = urlScore(a);
      if (s > bestScore) {
        best = a;
        bestScore = s;
      }
    }
    return best;
  }

  // JSON-LD first, then the h1. There is deliberately no third page source:
  // when both miss, the user types the address (content.js: need_address).
  const SOURCES = [
    ['json-ld', fromJsonLd],
    ['h1', fromH1],
  ];

  function tryOnce() {
    for (const [source, read] of SOURCES) {
      let address = null;
      try {
        address = pick(read());
      } catch {
        address = null;
      }
      if (address) return { address, source };
    }
    return null;
  }

  MBX.extractAddress = function extractAddress(opts) {
    const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000;
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const last = Date.now() - started + POLL_MS > timeoutMs;
        const hit = tryOnce();
        if (hit) return resolve(hit);
        if (last) return resolve(null);
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
  };

})(globalThis.MBX);
