// Run with: node extension/address.test.js
const assert = require("node:assert");
const { findAddress, looksLikeAddress } = require("./src/address.js");

const page = (text) => ({ querySelector: () => ({ textContent: text }) });

assert.equal(findAddress("www.domain.com.au", page("  26 Tudor Street,\n Surry Hills NSW 2010 ")), "26 Tudor Street, Surry Hills NSW 2010");
assert.equal(findAddress("www.realestate.com.au", page("Properties for sale in Sydney")), null);
assert.equal(findAddress("example.com", page("26 Tudor Street, Surry Hills NSW 2010")), null);
assert.equal(looksLikeAddress("5/26 Tudor St, Surry Hills, NSW 2010"), true);
console.log("address tests passed");
