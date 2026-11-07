// Run with: node extension/address.test.js
// Tests the extractor the manifest actually ships (src/extract.js, loaded before src/content.js):
// JSON-LD first, then the h1, otherwise null (the user types the address). No other page text.
const assert = require("node:assert");

globalThis.MBX = {};
require("./src/extract.js");
const { MBX } = globalThis;

// A minimal fake page: JSON-LD scripts, a few h1 selectors and a URL path. Nothing else is readable.
function fakePage({ jsonLd = [], h1 = null, path = "/" }) {
  globalThis.location = { pathname: path, href: `https://www.domain.com.au${path}` };
  globalThis.document = {
    querySelectorAll: (sel) => (sel.includes("ld+json") ? jsonLd.map((obj) => ({ textContent: JSON.stringify(obj) })) : []),
    querySelector: (sel) => (h1 !== null && sel.includes("h1") ? { textContent: h1 } : null),
  };
}

(async () => {
  // Pages
  assert.equal(MBX.isListingPage("https://www.domain.com.au/17-young-street-redfern-nsw-2016-17875055"), true);
  assert.equal(MBX.isListingPage("https://www.domain.com.au/rent/redfern-nsw-2016/"), false);
  assert.equal(MBX.isListingPage("https://www.realestate.com.au/property-unit-nsw-surry+hills-143160680"), true);
  assert.equal(MBX.isListingPage("https://example.com/17-young-street-redfern-nsw-2016-17875055"), false);

  // Address shape
  assert.equal(MBX.looksLikeAddress("5/26 Tudor St, Surry Hills, NSW 2010"), true);
  assert.equal(MBX.looksLikeAddress("17 Young Street, Redfern NSW 2016"), true);
  assert.equal(MBX.looksLikeAddress("Properties for sale in Sydney"), false);

  // h1 (the archived Domain rental's heading)
  fakePage({ h1: "  17 Young Street,\n Redfern NSW 2016 ", path: "/17-young-street-redfern-nsw-2016-17875055" });
  let hit = await MBX.extractAddress({ timeoutMs: 50 });
  assert.equal(hit?.address, "17 Young Street, Redfern NSW 2016");
  assert.equal(hit?.source, "h1");

  // JSON-LD wins over the h1
  fakePage({
    jsonLd: [{ "@type": "Residence", address: { streetAddress: "26 Tudor Street", addressLocality: "Surry Hills", addressRegion: "NSW", postalCode: "2010" } }],
    h1: "Something else entirely",
    path: "/26-tudor-street-surry-hills-nsw-2010-2019999999",
  });
  hit = await MBX.extractAddress({ timeoutMs: 50 });
  assert.equal(hit?.source, "json-ld");
  assert.match(hit?.address || "", /^26 Tudor Street, Surry Hills/);

  // No address on the page: null, so the panel asks the user to type it
  fakePage({ h1: "Properties for rent in Redfern", path: "/rent/redfern-nsw-2016/" });
  hit = await MBX.extractAddress({ timeoutMs: 50 });
  assert.equal(hit, null);

  console.log("address tests passed (src/extract.js): 12 assertions");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
