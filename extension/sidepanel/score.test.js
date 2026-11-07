// Unit tests for score.js, written independently from the README scoring model
// (README "Scoring model" table, with the numeric thresholds agreed in the build brief).
// Run from the repo root:  node --test extension/sidepanel/score.test.js
//
// Every expected number below is hand-computed; the arithmetic sits beside it.
// Model used for the hand computation:
//   signal score s in 0..100
//   signal weight sw = 1; parking / nightlife: 0.5 when the profile flag is absent,
//                      1 when true, not counted when false
//   dimension  = round( sum(s * sw) / sum(sw) ) over SCORED signals, null if none
//   Fit        = round( sum(w_d * dim_d) / sum(w_d) ) over SCORED dimensions, null if none
//   halo rank  = s         * w_d * sw / sum(sw in that dimension), only s >= 70, top 3
//   failo rank = (100 - s) * w_d * sw / sum(sw in that dimension), only s <= 30, top 3
//   bands: failo 0-30, meh 31-69, halo 70-100
// Fixtures are ADAPTER OUTPUT objects (what adapter.js hands score.js), written inline.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreListing, scoreSignal, bandFor } from "./score.js";
import { adapt } from "./adapter.js";
import { normalizeProfile } from "./profile.js";

// ---------------------------------------------------------------- helpers

const AS_OF = "2026-11-07";

const UNITS = {
  transit_walk: "m", work_distance: "km", cbd_distance: "km", parking: "spaces", road_noise: "level",
  crime_vs_benchmark: "%", livability_vs_benchmark: "vs benchmark", hazards_on_property: "level",
  social_housing: "level", daily_needs: "of 3", nightlife: "venues", green_space: "m",
  rent_weekly: "AUD/week", avm: "AUD", value_vs_comps: "%", running_costs: "vs suburb",
  development_pressure: "level", negotiating_room: "level",
};

// An available signal, shaped like adapter.js output.
function on(key, value, extra = {}) {
  return {
    available: true, value, unit: UNITS[key], display: `${value} ${UNITS[key]}`,
    label: `label:${key}`, source: `source:${key}`, asOf: AS_OF, ...extra,
  };
}
// An unavailable signal, shaped like adapter.js output.
function off(key, reason = "not provided by the backend") {
  return { available: false, label: `label:${key}`, source: `source:${key}`, reason };
}

function listing(facts = {}, over = {}) {
  return {
    status: "matched",
    query: "105/8 Sam Sing Street, Waterloo NSW 2017",
    fetchedAt: "2026-11-07T01:45:00.000Z",
    message: null,
    matched: {
      gnaf_id: "GANSW710352293",
      display_name: "Unit 105, 8 Sam Sing Street, Waterloo (NSW)",
      suburb: "Waterloo (NSW)",
      confidence: "exact",
      candidates: [],
    },
    // parking_count null so nothing can leak into commute.parking behind the fixture's back
    property: { dwelling_type: "Unit", bed_count: 1, bath_count: 1, parking_count: null, land_area_sqm: null },
    facts: { commute: {}, safety: {}, lifestyle: {}, price: {}, ...facts },
    outsideCoverage: false,
    backend: null,
    extras: [],
    ...over,
  };
}

// README Contract 1 default, verbatim.
function sarah(over = {}) {
  return {
    name: "Sarah", mode: "rent", budgetWeekly: 250, incomeWeekly: 600, workAddress: "Broadway, Ultimo NSW",
    weights: { commute: 0.35, safety: 0.25, lifestyle: 0.15, price: 0.25 },
    ...over,
  };
}
// Same weights as Sarah, but earns $3,000/wk.
function priya(over = {}) {
  return sarah({ name: "Priya", budgetWeekly: 700, incomeWeekly: 3000, ...over });
}

const dim = (r, k) => r.dimensions.find((d) => d.key === k);
const dimScore = (r, k) => {
  const d = dim(r, k);
  return d && d.score !== undefined ? d.score : null;
};
// The derived affordability signal may be keyed by the derived name or by its raw fact.
const ALIAS = { rent_weekly: "rent_affordability", avm: "buy_affordability" };
const id = (it) => `${String(it.dimension).toLowerCase()}.${ALIAS[it.key] || it.key}`;

// Score one signal alone in its dimension: that dimension's score IS the signal score
// (independent of scoreSignal's return shape).
function only(dimension, key, signal, profile = sarah()) {
  const r = scoreListing(listing({ [dimension]: { [key]: signal } }), profile);
  return dimScore(r, dimension);
}
// scoreSignal may return a number|null or an object carrying .score; accept both.
function sigScore(dimension, key, signal, profile = sarah()) {
  const r = scoreSignal(dimension, key, signal, profile);
  if (r === null || r === undefined) return null;
  if (typeof r === "number") return r;
  return r.score === undefined ? null : r.score;
}

function assertInvariants(r) {
  assert.equal(r.dimensions.length, 4);
  assert.deepEqual(r.dimensions.map((d) => d.key), ["commute", "safety", "lifestyle", "price"]);
  assert.ok(r.halos.length <= 3, "at most three halos");
  assert.ok(r.failos.length <= 3, "at most three failos");
  for (const h of r.halos) assert.ok(h.score >= 70, `halo ${h.key} scores ${h.score} < 70`);
  for (const f of r.failos) assert.ok(f.score <= 30, `failo ${f.key} scores ${f.score} > 30`);
}

// ---------------------------------------------------------------- (1) a listing that halos

// Priya renting at $650/wk on $3,000/wk, Sarah's weights, no flags.
const haloListing = () => listing({
  commute: {
    transit_walk: on("transit_walk", 250),     // 250 m < 400              -> 100
    work_distance: off("work_distance"),        // not provided             -> skipped
    cbd_distance: on("cbd_distance", 3.1),     // 3.1 km in 2..5           -> 50
  },
  safety: {
    crime_vs_benchmark: on("crime_vs_benchmark", -32, { note: "vs suburb benchmark" }), // -32 <= -20 -> 100
    livability_vs_benchmark: on("livability_vs_benchmark", 1),                          // above      -> 100
    hazards_on_property: on("hazards_on_property", 0),                                   // none       -> 100
    social_housing: off("social_housing", "no source wired in this build"),              //            -> skipped
  },
  lifestyle: {
    green_space: on("green_space", 180),       // 180 m < 500              -> 100
  },
  price: {
    rent_weekly: on("rent_weekly", 650, { display: "$650/wk" }), // 650 / 3000 = 0.217 <= 0.30 -> 100
    avm: on("avm", 1240000, { display: "$1.24M" }),               // rent mode: raw fact, not scored
    development_pressure: on("development_pressure", 1),         // some     -> 50
  },
});

describe("(1) listing that halos", () => {
  test("dimensions, fit 85, band halo", () => {
    const r = scoreListing(haloListing(), priya());
    assertInvariants(r);
    assert.equal(r.mode, "rent");
    assert.equal(dimScore(r, "commute"), 75);    // (100 + 50) / 2 = 75
    assert.equal(dimScore(r, "safety"), 100);    // (100 + 100 + 100) / 3 = 100
    assert.equal(dimScore(r, "lifestyle"), 100); // 100 / 1
    assert.equal(dimScore(r, "price"), 75);      // (100 + 50) / 2 = 75 (avm not scored in rent mode)
    // Fit = 0.35*75 + 0.25*100 + 0.15*100 + 0.25*75 = 26.25 + 25 + 15 + 18.75 = 85
    assert.equal(r.fit, 85);
    assert.equal(r.band, "halo");
    assert.deepEqual(r.dimensions.map((d) => d.label), ["Commute", "Safety", "Lifestyle", "Price"]);
  });

  test("three halos, capped, ordered by weighted contribution; no failos", () => {
    const r = scoreListing(haloListing(), priya());
    // transit  100 * 0.35 * 1/2 = 17.5
    // green    100 * 0.15 * 1/1 = 15
    // rent     100 * 0.25 * 1/2 = 12.5
    // crime / livability / hazards 100 * 0.25 * 1/3 = 8.33 each -> cut by the cap of three
    assert.deepEqual(r.halos.map(id), ["commute.transit_walk", "lifestyle.green_space", "price.rent_affordability"]);
    assert.equal(r.failos.length, 0); // nothing <= 30: cbd 50, development 50
  });

  test("halo items carry value, unit, source, as-of and contribution", () => {
    const r = scoreListing(haloListing(), priya());
    const h = r.halos[0];
    assert.equal(h.key, "transit_walk");
    assert.equal(h.dimension, "commute");
    assert.equal(h.score, 100);
    assert.equal(h.value, 250);
    assert.equal(h.unit, "m");
    assert.equal(h.source, "source:transit_walk");
    assert.equal(h.asOf, AS_OF);
    assert.ok(Math.abs(h.contribution - 17.5) < 0.01, `contribution ${h.contribution} != 17.5 (100*0.35*1/2)`);
  });

  test("coverage counts scored signals; missing lists the unavailable ones", () => {
    const r = scoreListing(haloListing(), priya());
    // scored: transit, cbd, crime, livability, hazards, green, rent affordability, development = 8
    assert.equal(r.coverage.scored, 8);
    const miss = r.missing.map((m) => `${m.dimension}.${m.key}`);
    assert.ok(miss.includes("commute.work_distance"), `missing = ${miss}`);
    assert.ok(miss.includes("safety.social_housing"), `missing = ${miss}`);
    for (const m of r.missing) assert.equal(typeof m.reason, "string");
  });

  test("weights not summing to 1 are normalised (same needle for 35/25/15/25)", () => {
    const r = scoreListing(haloListing(), priya({ weights: { commute: 35, safety: 25, lifestyle: 15, price: 25 } }));
    // Fit = (35*75 + 25*100 + 15*100 + 25*75) / 100 = 8500 / 100 = 85
    assert.equal(r.fit, 85);
    const w = r.dimensions.map((d) => d.weight);
    [0.35, 0.25, 0.15, 0.25].forEach((x, i) => assert.ok(Math.abs(w[i] - x) < 1e-9, `weight ${i} = ${w[i]}`));
    assert.deepEqual(r.halos.map(id), ["commute.transit_walk", "lifestyle.green_space", "price.rent_affordability"]);
  });

  test("personalisation: a lifestyle-heavy profile reorders the halos", () => {
    const r = scoreListing(haloListing(), priya({ weights: { commute: 0.15, safety: 0.05, lifestyle: 0.5, price: 0.3 } }));
    // Fit = 0.15*75 + 0.05*100 + 0.5*100 + 0.3*75 = 11.25 + 5 + 50 + 22.5 = 88.75 -> 89
    assert.equal(r.fit, 89);
    // green 100*0.5*1/1 = 50; rent 100*0.3*1/2 = 15; transit 100*0.15*1/2 = 7.5; safety ones 100*0.05/3 = 1.67
    assert.deepEqual(r.halos.map(id), ["lifestyle.green_space", "price.rent_affordability", "commute.transit_walk"]);
  });
});

// ---------------------------------------------------------------- (2) fails affordability for Sarah

const unaffordable = () => listing({
  commute: {
    transit_walk: on("transit_walk", 350),     // 350 m < 400      -> 100
    work_distance: on("work_distance", 2.6),   // 2.6 km in 2..6   -> 50
  },
  safety: {
    crime_vs_benchmark: on("crime_vs_benchmark", 4), // +4 % in -20..+20 -> 50
    hazards_on_property: on("hazards_on_property", 0), // none           -> 100
  },
  lifestyle: { green_space: on("green_space", 420) }, // 420 m < 500   -> 100
  price: { rent_weekly: on("rent_weekly", 820, { display: "$820/wk" }) },
  // Sarah: 820 / 600 = 1.367 > 0.40 -> 0
});

describe("(2) listing that fails affordability for Sarah", () => {
  test("price 0, fit 60 meh, affordability is the only failo", () => {
    const r = scoreListing(unaffordable(), sarah());
    assertInvariants(r);
    assert.equal(dimScore(r, "commute"), 75);    // (100 + 50) / 2
    assert.equal(dimScore(r, "safety"), 75);     // (50 + 100) / 2
    assert.equal(dimScore(r, "lifestyle"), 100);
    assert.equal(dimScore(r, "price"), 0);       // only price signal: 1.367 -> 0
    // Fit = 0.35*75 + 0.25*75 + 0.15*100 + 0.25*0 = 26.25 + 18.75 + 15 + 0 = 60
    assert.equal(r.fit, 60);
    assert.equal(r.band, "meh");
    // failo share (100 - 0) * 0.25 * 1/1 = 25; nothing else <= 30 (work 50, crime 50)
    assert.deepEqual(r.failos.map(id), ["price.rent_affordability"]);
    assert.equal(r.failos[0].score, 0);
    assert.equal(typeof r.failos[0].source, "string");
    assert.ok(r.failos[0].source.length > 0, "the affordability failo must show a source");
  });

  test("halos for Sarah: transit, green, hazards", () => {
    const r = scoreListing(unaffordable(), sarah());
    // transit 100*0.35*1/2 = 17.5; green 100*0.15*1/1 = 15; hazards 100*0.25*1/2 = 12.5
    assert.deepEqual(r.halos.map(id), ["commute.transit_walk", "lifestyle.green_space", "safety.hazards_on_property"]);
  });

  test("same listing, different needle: Priya on $3,000/wk can afford it", () => {
    const r = scoreListing(unaffordable(), priya());
    // 820 / 3000 = 0.273 <= 0.30 -> 100; price = 100
    assert.equal(dimScore(r, "price"), 100);
    // Fit = 26.25 + 18.75 + 15 + 0.25*100 = 85
    assert.equal(r.fit, 85);
    assert.equal(r.band, "halo");
    assert.equal(r.failos.length, 0);
    // rent 100*0.25*1/1 = 25; transit 17.5; green 15 (hazards 12.5 cut)
    assert.deepEqual(r.halos.map(id), ["price.rent_affordability", "commute.transit_walk", "lifestyle.green_space"]);
  });
});

// ---------------------------------------------------------------- (3) missing signals

describe("(3) missing signals", () => {
  test("a whole dimension missing renormalises the fit over the scored ones", () => {
    const a = listing({
      commute: { transit_walk: on("transit_walk", 250), work_distance: on("work_distance", 2.6) }, // (100 + 50)/2 = 75
      safety: {
        crime_vs_benchmark: off("crime_vs_benchmark"),
        livability_vs_benchmark: off("livability_vs_benchmark"),
        hazards_on_property: off("hazards_on_property"),
        social_housing: off("social_housing"),
      },
      lifestyle: { green_space: on("green_space", 700) },  // 700 m in 500..1000 -> 50
      price: { rent_weekly: on("rent_weekly", 150) },      // 150 / 600 = 0.25 -> 100
    });
    const r = scoreListing(a, sarah());
    assertInvariants(r);
    assert.equal(dimScore(r, "safety"), null);
    // Fit = (0.35*75 + 0.15*50 + 0.25*100) / (0.35 + 0.15 + 0.25) = 58.75 / 0.75 = 78.33 -> 78
    // (treating safety as 0 would give 58.75 -> 59, a different band)
    assert.equal(r.fit, 78);
    assert.equal(r.band, "halo");
  });

  test("everything missing: fit null, band null, no halos or failos", () => {
    const a = listing({
      commute: { transit_walk: off("transit_walk"), work_distance: off("work_distance"), cbd_distance: off("cbd_distance") },
      safety: { crime_vs_benchmark: off("crime_vs_benchmark"), social_housing: off("social_housing") },
      lifestyle: { green_space: off("green_space") },
      price: { rent_weekly: off("rent_weekly"), avm: off("avm") },
    });
    const r = scoreListing(a, sarah());
    assertInvariants(r);
    assert.equal(r.fit, null);
    assert.equal(r.band, null);
    for (const d of r.dimensions) assert.equal(d.score, null, `${d.key} should be null`);
    assert.equal(r.halos.length, 0);
    assert.equal(r.failos.length, 0);
    assert.equal(r.coverage.scored, 0);
  });

  test("empty facts: fit null", () => {
    const r = scoreListing(listing(), sarah());
    assertInvariants(r);
    assert.equal(r.fit, null);
    assert.equal(r.band, null);
  });

  test("unparseable and unprovided signals are skipped, not zeroed", () => {
    const a = listing({
      commute: {
        transit_walk: on("transit_walk", 300), // -> 100
        work_distance: { available: false, label: "label:work_distance", source: "source:work_distance", reason: "could not read value about 2ish km", raw: "about 2ish km" },
        cbd_distance: off("cbd_distance"),
      },
    });
    const r = scoreListing(a, sarah());
    // commute = 100 / 1 = 100 (zeroing the two missing ones would give 33)
    assert.equal(dimScore(r, "commute"), 100);
    assert.equal(r.fit, 100); // only commute scored
    const miss = r.missing.map((m) => `${m.dimension}.${m.key}`);
    assert.ok(miss.includes("commute.work_distance"), `missing = ${miss}`);
    assert.ok(miss.includes("commute.cbd_distance"), `missing = ${miss}`);
  });

  test("defensive: available:true with a null value is skipped, not read as 0", () => {
    const a = listing({
      safety: {
        crime_vs_benchmark: { ...on("crime_vs_benchmark", null), display: "" }, // malformed -> skipped
        livability_vs_benchmark: on("livability_vs_benchmark", 1),               // -> 100
      },
    });
    const r = scoreListing(a, sarah());
    // skipped: safety = 100; read as 0 %: (50 + 100) / 2 = 75
    assert.equal(dimScore(r, "safety"), 100);
  });

  test("defensive: absent dimension objects still yield four dimensions", () => {
    const r = scoreListing(listing({}, { facts: { commute: { transit_walk: on("transit_walk", 250) } } }), sarah());
    assertInvariants(r);
    assert.equal(dimScore(r, "commute"), 100);
    assert.equal(dimScore(r, "price"), null);
    assert.equal(r.fit, 100);
  });

  test("rent mode with no income: affordability not scored", () => {
    const noIncome = sarah();
    delete noIncome.incomeWeekly;
    const a = listing({ commute: { transit_walk: on("transit_walk", 250) }, price: { rent_weekly: on("rent_weekly", 650) } });
    const r = scoreListing(a, noIncome);
    assert.equal(dimScore(r, "price"), null);
    assert.equal(r.fit, 100); // commute only: 100
    const r2 = scoreListing(a, sarah({ incomeWeekly: null }));
    assert.equal(dimScore(r2, "price"), null);
    assert.equal(r2.fit, 100);
  });

  test("rent mode with no rent figure: affordability not scored", () => {
    const a = listing({ commute: { transit_walk: on("transit_walk", 250) }, price: { rent_weekly: off("rent_weekly") } });
    const r = scoreListing(a, sarah());
    assert.equal(dimScore(r, "price"), null);
    assert.equal(r.fit, 100);
  });

  test("rent mode never scores the AVM, even with a stray budgetPrice", () => {
    const a = listing({ price: { rent_weekly: on("rent_weekly", 650), avm: on("avm", 1240000) } });
    const r = scoreListing(a, priya({ budgetPrice: 500000 }));
    // rent 650/3000 = 0.217 -> 100; avm/budget = 2.48 would be 0 if (wrongly) scored -> 50
    assert.equal(dimScore(r, "price"), 100);
  });

  describe("buy mode: avm / budgetPrice (budget $1,000,000)", () => {
    const ben = (over = {}) => sarah({ name: "Ben", mode: "buy", budgetPrice: 1000000, budgetWeekly: undefined, ...over });
    // rent_weekly 820 is present and income 600: scoring it in buy mode would add a 0 (820/600 = 1.37)
    const buy = (avm) => listing({ price: { avm: on("avm", avm), rent_weekly: on("rent_weekly", 820) } });
    const cases = [
      [990000, 100],   // 0.99 <= 1.00            -> 100
      [1000000, 100],  // 1.00 <= 1.00            -> 100
      [1050000, 50],   // 1.05 in 1.00..1.10      -> 50
      [1100000, 50],   // 1.10 in 1.00..1.10      -> 50 (exactly +10 % is "within +10 %")
      [1200000, 0],    // 1.20 > 1.10             -> 0
    ];
    for (const [avm, want] of cases) {
      test(`avm ${avm} -> price ${want}`, () => {
        const r = scoreListing(buy(avm), ben());
        assert.equal(r.mode, "buy");
        assert.equal(dimScore(r, "price"), want);
        assert.equal(r.fit, want); // only price scored
      });
    }
    test("buy mode with no budgetPrice or no avm: not scored", () => {
      const noBudget = ben();
      delete noBudget.budgetPrice;
      assert.equal(dimScore(scoreListing(buy(990000), noBudget), "price"), null);
      const noAvm = listing({ price: { avm: off("avm"), rent_weekly: on("rent_weekly", 820) } });
      assert.equal(dimScore(scoreListing(noAvm, ben()), "price"), null);
    });
  });
});

// ---------------------------------------------------------------- (4) half-weight flags

describe("(4) hasCar / nightlife flags", () => {
  const car = () => listing({ commute: { transit_walk: on("transit_walk", 300), parking: on("parking", 0) } });
  // transit 300 m -> 100 (sw 1); parking 0 spaces -> 0

  test("hasCar absent: parking at half weight", () => {
    const r = scoreListing(car(), sarah());
    // (100*1 + 0*0.5) / (1 + 0.5) = 66.67 -> 67
    assert.equal(dimScore(r, "commute"), 67);
    assert.equal(r.fit, 67);
    const p = dim(r, "commute").signals.find((s) => s.key === "parking");
    assert.equal(p.signalWeight, 0.5);
  });
  test("hasCar true: parking at full weight", () => {
    const r = scoreListing(car(), sarah({ hasCar: true }));
    // (100 + 0) / 2 = 50
    assert.equal(dimScore(r, "commute"), 50);
    const p = dim(r, "commute").signals.find((s) => s.key === "parking");
    assert.equal(p.signalWeight, 1);
  });
  test("hasCar false: parking not counted", () => {
    const r = scoreListing(car(), sarah({ hasCar: false }));
    // 100 / 1 = 100
    assert.equal(dimScore(r, "commute"), 100);
    assert.ok(!r.failos.some((f) => f.key === "parking"), "parking must not be a failo when not counted");
  });

  const night = () => listing({ lifestyle: { green_space: on("green_space", 300), nightlife: on("nightlife", 0) } });
  // green 300 m -> 100 (sw 1); nightlife 0 venues -> 0

  test("nightlife absent: half weight", () => {
    // (100*1 + 0*0.5) / 1.5 = 66.67 -> 67
    assert.equal(dimScore(scoreListing(night(), sarah()), "lifestyle"), 67);
  });
  test("nightlife true: full weight", () => {
    // (100 + 0) / 2 = 50
    assert.equal(dimScore(scoreListing(night(), sarah({ nightlife: true })), "lifestyle"), 50);
  });
  test("nightlife false: not counted", () => {
    // 100 / 1 = 100
    assert.equal(dimScore(scoreListing(night(), sarah({ nightlife: false })), "lifestyle"), 100);
  });

  test("half weight also halves the contribution used for halo ranking", () => {
    const a = listing({ commute: { parking: on("parking", 2), transit_walk: on("transit_walk", 300) } });
    const r = scoreListing(a, sarah());
    // transit 100*0.35*1/1.5 = 23.33; parking 100*0.35*0.5/1.5 = 11.67
    assert.deepEqual(r.halos.map(id), ["commute.transit_walk", "commute.parking"]);
    assert.ok(r.halos[0].contribution > r.halos[1].contribution);
  });
});

// ---------------------------------------------------------------- (5) threshold edges

describe("(5) threshold edges", () => {
  const edges = [
    // [dimension, key, value, expected dimension score (signal alone), arithmetic]
    ["commute", "transit_walk", 399, 100, "399 < 400"],
    ["commute", "transit_walk", 400, 50, "400 in 400..900"],
    ["commute", "transit_walk", 900, 50, "900 in 400..900"],
    ["commute", "transit_walk", 1000, 33, "50 - 50*(1000-900)/300 = 33.3 -> 33"],
    ["commute", "transit_walk", 1050, 25, "50 - 50*(1050-900)/300 = 25"],
    ["commute", "transit_walk", 1200, 0, "50 - 50*(1200-900)/300 = 0"],
    ["commute", "transit_walk", 1500, 0, "> 1200"],
    ["commute", "work_distance", 1.9, 100, "< 2"],
    ["commute", "work_distance", 2, 50, "2 in 2..6"],
    ["commute", "work_distance", 6, 50, "6 in 2..6"],
    ["commute", "work_distance", 8, 25, "50 - 50*(8-6)/4 = 25"],
    ["commute", "work_distance", 10, 0, "50 - 50*(10-6)/4 = 0"],
    ["commute", "work_distance", 12, 0, "> 10"],
    ["commute", "cbd_distance", 1.9, 100, "< 2"],
    ["commute", "cbd_distance", 2, 50, "2 in 2..5"],
    ["commute", "cbd_distance", 5, 50, "5 in 2..5"],
    ["commute", "cbd_distance", 6.5, 25, "50 - 50*(6.5-5)/3 = 25"],
    ["commute", "cbd_distance", 8, 0, "50 - 50*(8-5)/3 = 0"],
    ["commute", "cbd_distance", 9, 0, "> 8"],
    ["commute", "road_noise", 0, 100, "none"],
    ["commute", "road_noise", 1, 50, "nearby"],
    ["commute", "road_noise", 2, 0, "fronting"],
    ["safety", "crime_vs_benchmark", -25, 100, "-25 <= -20"],
    ["safety", "crime_vs_benchmark", -20, 100, "-20 <= -20"],
    ["safety", "crime_vs_benchmark", -19, 50, "-19 in -20..+20"],
    ["safety", "crime_vs_benchmark", 0, 50, "0 in -20..+20"],
    ["safety", "crime_vs_benchmark", 19, 50, "19 in -20..+20"],
    ["safety", "crime_vs_benchmark", 20, 0, "+20 >= +20"],
    ["safety", "crime_vs_benchmark", 25, 0, "+25 >= +20"],
    ["safety", "livability_vs_benchmark", 1, 100, "above"],
    ["safety", "livability_vs_benchmark", 0, 50, "at"],
    ["safety", "livability_vs_benchmark", -1, 0, "below"],
    ["safety", "hazards_on_property", 0, 100, "none"],
    ["safety", "hazards_on_property", 1, 50, "nearby only"],
    ["safety", "hazards_on_property", 2, 0, "on property"],
    ["lifestyle", "daily_needs", 3, 100, "all three"],
    ["lifestyle", "green_space", 499, 100, "< 500"],
    ["lifestyle", "green_space", 500, 50, "500 in 500..1000"],
    ["lifestyle", "green_space", 900, 50, "900 in 500..1000"],
    ["lifestyle", "green_space", 1500, 0, "none within 1 km"],
    ["price", "value_vs_comps", -3, 100, "-3 <= 0"],
    ["price", "value_vs_comps", 0, 100, "0 <= 0"],
    ["price", "value_vs_comps", 3, 50, "3 in 0..5"],
    ["price", "value_vs_comps", 5, 50, "5 in 0..5"],
    ["price", "value_vs_comps", 6, 0, "6 > 5"],
    ["price", "running_costs", -1, 100, "below suburb avg"],
    ["price", "running_costs", 0, 50, "at"],
    ["price", "running_costs", 1, 0, "above"],
    ["price", "development_pressure", 0, 100, "low"],
    ["price", "development_pressure", 1, 50, "some"],
    ["price", "development_pressure", 2, 0, "heavy"],
    ["price", "negotiating_room", 2, 100, "high"],
    ["price", "negotiating_room", 1, 50, "mid"],
    ["price", "negotiating_room", 0, 0, "tight"],
  ];
  for (const [d, k, v, want, why] of edges) {
    test(`${d}.${k} ${v} -> ${want} (${why})`, () => {
      assert.equal(only(d, k, on(k, v)), want);
    });
  }

  // flagged signals with the flag on (full weight; alone in the dimension anyway)
  const flagged = [
    ["commute", "parking", 0, 0, { hasCar: true }, "0 spaces"],
    ["commute", "parking", 1, 100, { hasCar: true }, ">= 1 space"],
    ["commute", "parking", 2, 100, { hasCar: true }, ">= 1 space"],
    ["lifestyle", "nightlife", 0, 0, { nightlife: true }, "0 venues"],
    ["lifestyle", "nightlife", 1, 50, { nightlife: true }, "1..2"],
    ["lifestyle", "nightlife", 2, 50, { nightlife: true }, "1..2"],
    ["lifestyle", "nightlife", 3, 100, { nightlife: true }, ">= 3"],
  ];
  for (const [d, k, v, want, flags, why] of flagged) {
    test(`${d}.${k} ${v} -> ${want} (${why})`, () => {
      assert.equal(only(d, k, on(k, v), sarah(flags)), want);
    });
  }

  // rent affordability ratio edges for Sarah (income $600/wk), rent alone in price
  const ratios = [
    [180, 100, "180/600 = 0.30 <= 0.30"],
    [210, 50, "210/600 = 0.35 in 0.30..0.40"],
    [240, 50, "240/600 = 0.40 in 0.30..0.40"],
    [246, 0, "246/600 = 0.41 > 0.40"],
    [820, 0, "820/600 = 1.37 > 0.40"],
  ];
  for (const [rent, want, why] of ratios) {
    test(`rent $${rent}/wk for Sarah -> ${want} (${why})`, () => {
      assert.equal(only("price", "rent_weekly", on("rent_weekly", rent)), want);
    });
  }

  // daily_needs: count of supermarket / gym / cafe found; `reported` = categories the backend reported
  // (adapter.js field). Unreported is unknown, never absent: score only when every possible count
  // lands in the same band (3 -> 100, 2 -> 50, <= 1 -> 0).
  const ALL3 = ["supermarket", "gym", "cafe"];
  const needs = [
    [2, ALL3, 50, "2 of 3, all reported"],
    [1, ALL3, 0, "1 of 3, all reported"],
    [0, ALL3, 0, "0 of 3, all reported"],
    [2, ["supermarket", "gym"], null, "2 found, cafe unknown: 2 or 3 -> 50 or 100, undeterminable"],
    [1, ["supermarket", "gym"], null, "1 found, cafe unknown: 1 or 2 -> 0 or 50, undeterminable"],
    [0, ["supermarket", "gym"], 0, "0 found, cafe unknown: 0 or 1 -> both <= 1 -> 0"],
    [0, ["supermarket"], null, "0 found, two unknown: 0..2 -> 0 or 50, undeterminable"],
    [3, ALL3, 100, "all three"],
  ];
  for (const [count, reported, want, why] of needs) {
    test(`lifestyle.daily_needs ${count} reported [${reported}] -> ${want} (${why})`, () => {
      assert.equal(only("lifestyle", "daily_needs", on("daily_needs", count, { reported })), want);
    });
  }

  test("scoreSignal agrees on a few direct cases", () => {
    assert.equal(sigScore("commute", "transit_walk", on("transit_walk", 1050)), 25); // 50 - 50*150/300
    assert.equal(sigScore("commute", "transit_walk", on("transit_walk", 250)), 100);
    assert.equal(sigScore("safety", "crime_vs_benchmark", on("crime_vs_benchmark", -20)), 100);
    assert.equal(sigScore("safety", "crime_vs_benchmark", on("crime_vs_benchmark", 20)), 0);
    assert.equal(sigScore("lifestyle", "green_space", on("green_space", 700)), 50);
    assert.equal(sigScore("commute", "work_distance", off("work_distance")), null); // unavailable -> not scored
  });
});

// ---------------------------------------------------------------- (6) halos / failos ordering and cap

describe("(6) halos / failos ordering and cap", () => {
  const grim = () => listing({
    commute: { transit_walk: on("transit_walk", 1500), cbd_distance: on("cbd_distance", 3) }, // 0, 50 -> 25
    safety: { crime_vs_benchmark: on("crime_vs_benchmark", 35) },                             // +35 >= +20 -> 0
    lifestyle: { green_space: on("green_space", 1500) },                                       // none within 1 km -> 0
    price: { rent_weekly: on("rent_weekly", 300), value_vs_comps: on("value_vs_comps", 9) },  // 300/600 = 0.5 -> 0; +9 % -> 0
  });

  test("fit 9, band failo, no halos", () => {
    const r = scoreListing(grim(), sarah());
    assertInvariants(r);
    assert.equal(dimScore(r, "commute"), 25); // (0 + 50) / 2
    assert.equal(dimScore(r, "safety"), 0);
    assert.equal(dimScore(r, "lifestyle"), 0);
    assert.equal(dimScore(r, "price"), 0);    // (0 + 0) / 2
    // Fit = 0.35*25 + 0 + 0 + 0 = 8.75 -> 9
    assert.equal(r.fit, 9);
    assert.equal(r.band, "failo");
    assert.equal(r.halos.length, 0); // nothing >= 70
  });

  test("five failo candidates, top three by (100 - score) x weighted share", () => {
    const r = scoreListing(grim(), sarah());
    // crime   100 * 0.25 * 1/1 = 25
    // transit 100 * 0.35 * 1/2 = 17.5
    // green   100 * 0.15 * 1/1 = 15
    // rent    100 * 0.25 * 1/2 = 12.5  (cut)
    // comps   100 * 0.25 * 1/2 = 12.5  (cut)
    assert.deepEqual(r.failos.map(id), ["safety.crime_vs_benchmark", "commute.transit_walk", "lifestyle.green_space"]);
  });

  test("a meh signal (50) is neither a halo nor a failo", () => {
    const r = scoreListing(grim(), sarah());
    assert.ok(!r.halos.some((h) => h.key === "cbd_distance"));
    assert.ok(!r.failos.some((f) => f.key === "cbd_distance"));
  });
});

// ---------------------------------------------------------------- (8) profile shapes

describe("(8) quiz-shape profile from onboarding", () => {
  // Contract 1 note: the onboarding page may store the backend quiz shape instead. It must read as
  // mode "buy", budgetPrice = budget_max, weights = commute 0.25 + lifestyle/price/safety scaled to
  // the remaining 0.75 by their quiz proportions.
  const quiz = (weights) => ({
    version: 1, buyer_type: "first_home", budget_max: 1000000, household: "single", min_bedrooms: 1,
    vibe: "quiet", commute_modes: ["train"], must_haves: [], weights,
  });
  const cases = [
    // safety 0.75*20/100 = 0.15; lifestyle 0.75*50/100 = 0.375; price 0.75*30/100 = 0.225
    [{ lifestyle: 50, price: 30, safety: 20 }, [0.25, 0.15, 0.375, 0.225]],
    // sum 200: safety 0.75*60/200 = 0.225; lifestyle 0.75*80/200 = 0.3; price 0.75*60/200 = 0.225
    [{ lifestyle: 80, price: 60, safety: 60 }, [0.25, 0.225, 0.3, 0.225]],
  ];
  for (const [qw, want] of cases) {
    test(`quiz weights ${JSON.stringify(qw)} -> [commute, safety, lifestyle, price] = ${want}`, () => {
      const r = scoreListing(listing({ price: { avm: on("avm", 990000) } }), quiz(qw));
      assert.equal(r.mode, "buy");
      assert.equal(dimScore(r, "price"), 100); // 990000 / 1000000 = 0.99 <= 1.00 -> 100
      assert.equal(r.fit, 100);                // only price scored
      const w = r.dimensions.map((d) => d.weight);
      want.forEach((x, i) => assert.ok(Math.abs(w[i] - x) < 1e-9, `weight ${r.dimensions[i].key} = ${w[i]}, want ${x}`));
    });
  }
});

// ---------------------------------------------------------------- (7) bands

describe("(7) bandFor", () => {
  test("edges 30 / 31 / 69 / 70", () => {
    assert.equal(bandFor(30), "failo");
    assert.equal(bandFor(31), "meh");
    assert.equal(bandFor(69), "meh");
    assert.equal(bandFor(70), "halo");
  });
  test("ends and null", () => {
    assert.equal(bandFor(0), "failo");
    assert.equal(bandFor(100), "halo");
    assert.equal(bandFor(null), null);
  });
});

// ---------------------------------------------------------------- (9) adapter.js on README Contract 2
// These run the REAL path the panel runs: a proxy GET /lookup answer (README Contract 2) -> adapt() ->
// scoreListing(). TEST DATA ONLY: every value below is invented for these tests (the address, the
// gnaf_id and every number); none is copied from the live Microburbs API or the proxy.

const sig = (value, extra = {}) => ({ value, unit: "test-unit", label: "Test signal", source: "test:source", asOf: "2026-01-01", available: true, ...extra });
function c2(facts = {}, over = {}) {
  return {
    contract: 2,
    query: "7 Fixture Lane, Testville NSW 2999",
    matched: { gnaf_id: "GATEST000000001", display_name: "7 Fixture Lane, Testville", suburb: "Testville", confidence: "exact", candidates: [] },
    facts: { commute: {}, safety: {}, lifestyle: {}, price: {}, ...facts },
    outsideCoverage: false,
    ...over,
  };
}

describe("(9) adapter.js -> score.js on a synthetic README Contract 2 answer", () => {
  test("matched exact: Sarah, fit 60 meh, parking the only halo, no failos", () => {
    // commute: transit 0.45 km -> 450 m -> 50 (w1), parking 1 -> 100 (w0.5) -> (50 + 50) / 1.5 = 66.7 -> 67
    // safety: block crime +4% -> 50; lifestyle and price: nothing available -> not scored
    // fit = (0.35 * 66.7 + 0.25 * 50) / 0.60 = 59.7 -> 60
    const adapted = adapt(c2({ commute: { nearestTransport: sig(0.45), parking: sig(1) }, safety: { blockCrime: sig(4) } }));
    assert.equal(adapted.status, "matched");
    assert.equal(adapted.matched.confidence, "exact");
    assert.equal(adapted.matched.gnaf_id, "GATEST000000001");
    assert.equal(adapted.matched.display_name, "7 Fixture Lane, Testville");
    assert.equal("mock" in adapted, false);
    const r = scoreListing(adapted, sarah());
    assert.equal(r.fit, 60);
    assert.equal(r.band, "meh");
    assert.deepEqual(r.halos.map((h) => h.key), ["parking"]);
    assert.deepEqual(r.failos, []);
    assert.deepEqual(r.dimensions.map((d) => d.score), [67, 50, null, null]);
  });

  test("confidence missing from the proxy is computed from the query", () => {
    const body = c2();
    delete body.matched.confidence;
    assert.equal(adapt(body).matched.confidence, "exact");
    body.matched.display_name = "9 Other Road, Testville";
    assert.equal(adapt(body).matched.confidence, "guess");
  });

  test("unit conversions: km -> m, vacancy levels, livability band, daily needs reportedCount", () => {
    const facts = (over) => adapt(c2(over)).facts;
    const f = facts({ commute: { nearestTransport: sig(0.45), workDistance: sig(3.2) }, lifestyle: { greenSpace: sig(1.2), dailyAmenities: sig(2) } });
    assert.equal(f.commute.transit_walk.value, 450);
    assert.equal(f.commute.transit_walk.display, "450 m");
    assert.equal(f.commute.work_distance.value, 3.2);
    assert.equal(f.lifestyle.green_space.value, 1200);
    assert.equal(f.lifestyle.green_space.display, "1.2 km");
    assert.equal(f.lifestyle.daily_needs.value, 2);
    assert.equal(f.lifestyle.daily_needs.reportedCount, 3);
    assert.deepEqual(f.lifestyle.daily_needs.missing, []);
    assert.equal(f.lifestyle.daily_needs.display, "2 of 3 within 800 m");
    assert.equal(facts({ lifestyle: { dailyAmenities: sig(7) } }).lifestyle.daily_needs.value, 3); // clamped to 0..3
    // vacancy: under 1% tight (0), 1-3% mid (1), over 3% high (2)
    const vac = (v) => facts({ price: { negotiatingRoom: sig(v) } }).price.negotiating_room.value;
    assert.deepEqual([0.5, 1, 3, 3.5].map(vac), [0, 1, 1, 2]);
    // livability: within ±5 points of the benchmark counts as at it
    const liv = (v) => facts({ safety: { livability: sig(v) } }).safety.livability_vs_benchmark.value;
    assert.deepEqual([8, 5, 0, -5, -6].map(liv), [1, 0, 0, 0, -1]);
  });

  test("unavailable and skipped signals are never scored as zero", () => {
    const adapted = adapt(c2({
      commute: { nearestTransport: sig(null, { available: false }) },
      safety: { socialHousing: sig(1) },
      price: { runningCosts: sig(1000), developmentPressure: sig(2), rentAffordability: sig("n/a") },
    }));
    const f = adapted.facts;
    assert.equal(f.commute.transit_walk.available, false);
    assert.equal(f.commute.transit_walk.reason, "no data from Microburbs for this home");
    assert.equal(f.safety.social_housing.available, false);
    assert.equal(f.price.running_costs.available, false);
    assert.equal(f.price.development_pressure.available, false);
    assert.equal(f.price.rent_weekly.available, false);
    assert.equal(f.commute.cbd_distance.available, false); // absent from the answer: not provided
    const r = scoreListing(adapted, sarah());
    assert.equal(r.fit, null);
    assert.ok(r.missing.length > 0);
  });

  test("outsideCoverage -> out_of_area; matched null -> no_match; error -> error", () => {
    const out = adapt({ contract: 2, matched: null, facts: {}, outsideCoverage: true });
    assert.equal(out.status, "out_of_area");
    assert.equal(adapt({ matched: null, facts: {}, outsideCoverage: true }).status, "out_of_area"); // bare shape
    assert.equal(adapt(c2({}, { matched: null })).status, "no_match");
    const err = adapt(c2({}, { matched: null, error: { code: "upstream_429", message: "Test error message" } }));
    assert.equal(err.status, "error");
    assert.equal(err.code, "upstream_429");
    assert.equal(err.message, "Test error message");
    for (const a of [out, err]) assert.equal(scoreListing(a, sarah()).fit, null);
  });

  test("background's offline record is an error with no facts", () => {
    const a = adapt({ status: "error", code: "offline", message: "Backend offline" });
    assert.equal(a.status, "error");
    assert.equal(a.code, "offline");
    assert.equal(a.message, "Backend offline");
    assert.equal(scoreListing(a, sarah()).fit, null);
  });

  test("any other shape (an old backend or mock answer) is an error, never data", () => {
    const a = adapt({ status: "matched", property: { gnaf_id: "GATEST000000002", address: "1 Old Shape Street" }, match: { overall: 99, pillars: [] } });
    assert.equal(a.status, "error");
    assert.equal(a.message, "Unexpected answer from the proxy");
    assert.equal(a.matched, null);
    assert.equal(scoreListing(a, sarah()).fit, null);
  });
});
