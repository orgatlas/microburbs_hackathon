# Fit score v1: how the panel scores a home

**Status: draft v1, Saturday 7 November 2026.** The team's original scoring table did not arrive, so this v1 was drafted on the day. This document and the `TABLE` constant in `extension/panel/score.js` are written from the same draft table, and `tests/score.test.js` checks the code against it. If the document and the code ever disagree, treat it as a bug and record the fix in §11.

Every threshold below is a judgement call made for a one-day build. None of them has been fitted to outcome data. The score is indicative only. It is not financial, legal or tenancy advice, and the panel footer says so: "Microburbs estimates, not advice".

Sections are numbered so the report can cite them (for example "SCORING.md §5.3").

---

## 1. Purpose

The panel answers one question for one person: does this home fit *me*?

1. The proxy fetches facts about the matched property from the Microburbs API (§3).
2. The panel combines those facts with the user's profile, which is stored only in their browser (§2).
3. Six dimensions are each scored from 0 to 100 (§5). A weighted average of the scored dimensions is the total shown on the meter (§6).
4. Strong dimensions are listed as **Halos** and weak ones as **Failos** (§7). Each item carries the raw fact, the endpoint it came from and its as-of date, so the user can check every number.

The score measures fit against one person's budget and priorities. It is not a valuation, and it says nothing about the home's condition, the landlord or the agent.

## 2. The profile, and why the profile (not the listing) decides rent or buy

The profile is stored in `chrome.storage.local` under the key `mbx.profile.v1`. It is pre-filled with a persona, Sarah, and the user can edit it in one tap:

```json
{
  "version": 1,
  "name": "Sarah", "about": "19 · casual retail",
  "budget": { "mode": "rent", "max_rent_week": 250, "max_price": null },
  "income_week": 600,
  "work_address": "188 Pitt Street, Sydney NSW 2000",
  "priorities": ["cheap", "close_to_work", "safe"]
}
```

| Field | Meaning |
| --- | --- |
| `budget.mode` | The single rent/buy toggle. `"rent"` scores the home as a rental against `max_rent_week`. `"buy"` scores it as a purchase against `max_price`. |
| `budget.max_rent_week` | Maximum rent in AUD per week (rent mode). |
| `budget.max_price` | Maximum purchase price in AUD (buy mode). |
| `income_week` | Weekly income in AUD, as the user enters it. |
| `work_address` | Free text. This is the only profile field that leaves the browser: it goes to the proxy, which geocodes it to locate the workplace. |
| `priorities` | Zero to three of the six priorities below. Each picked priority doubles the weight of one dimension (§6). |

| Priority key | Label | Dimension it doubles |
| --- | --- | --- |
| `cheap` | Cheap | Affordability |
| `close_to_work` | Close to work | Commute |
| `safe` | Safe | Safety |
| `lively` | Lively | Liveliness |
| `quiet` | Quiet | Quiet |
| `negotiable` | Negotiable | Negotiability |

**Why the toggle decides rent or buy.** The content script reads only the listing's address (from the page title, the `h1` or JSON-LD). It does not read the asking rent or price, whether the page is a rental or a sale listing, or any other listing text or photos. That is a project rule. So the scorer cannot tell from the page whether the home is for rent or for sale. The user's toggle says how they want it scored. On a sale listing with the toggle on rent, the panel scores what renting that home would cost, using Microburbs rent facts. On a rental listing with the toggle on buy, it scores buying it, using the Microburbs valuation.

**Where scoring runs.** Scoring runs in the panel (`extension/panel/score.js`), not on the proxy. Income, budget and priorities never leave the browser.

## 3. Facts

The proxy (`proxy/profile-facts.js`) fetches the facts for the matched `gnaf_id` once the address match has succeeded (`blob.status === "ok"`). `GET /lookup` attaches them as `blob.facts`, or `null` when there is no match. Property endpoints take the `gnaf_id`. Suburb endpoints take the exact API suburb name from the match (for example `Surry Hills` or `Waterloo (NSW)`), URL-encoded.

**Absent-data rule.** If an endpoint returns `data: null`, an upstream error, or a value the proxy cannot interpret, that fact's key is **left out**. It is never set to 0, and never set to `null` in place of a number. `facts.missing[key]` gives a short reason, for example `no_data:<api reason>`, `upstream_error:502`, `mesh_block_unknown`, `not_requested` or `outside_coverage`.

Each fact also carries identity fields: `gnaf_id`, `suburb` (the exact API name), `property_type` (`"unit"`, `"house"`, another API string, or `null`) and `fetched_at` (ISO-8601 time of the lookup).

| Fact key | Endpoint template | Field(s) read | As-of source | When absent or partial |
| --- | --- | --- | --- | --- |
| `location` | `/v1/properties/{gnaf_id}/surroundings/properties`; fallback the centre point of `transport/nearby` or `amenities/nearby` (`location.via` lists the endpoint actually used) | The row with `is_subject: true`: `lat`, `lng`, and `mb` as `mesh_block` (the ABS mesh block, or census block). The fallback centre point gives `lat` and `lng` only, with no mesh block. | None in the response; the lookup time `fetched_at` applies. | Key absent: Commute falls back to transit only, and the busy-road distance cannot be measured. Only `mesh_block` absent: crime, vacancy and rent estimate fall back to suburb figures. |
| `rent_advert` | `/v1/properties/{gnaf_id}/rent-history-latest` | `price` (weekly rent, AUD) as `weekly_rent`; `date`. | `date`, the date of the latest advert. | `data: null` (no rent record): key absent. |
| `rent_estimate` | `/v1/suburbs/{suburb_name}/market/rent-map?property_type=unit` (or `house`); fallback `/v1/suburbs/{suburb_name}/market/median-rent` | rent-map: the `microburbs[]` row whose `mb` equals `location.mesh_block`, `weekly_rent`, with basis `mesh_block`. median-rent: the `unit` or `house` figure, with basis `suburb`. | `as_of` of the endpoint used. | A block with too little rental signal is absent from rent-map, not zero; the suburb median is used instead. Both missing: key absent. |
| `transport` | `/v1/properties/{gnaf_id}/transport/nearby?radius_m=2000` | `radius_m`; `nearest.train`, `nearest.tram`, `nearest.bus`, `nearest.ferry`, each with `distance_m` and `label`. | None; `fetched_at`. | A mode with no stop within 2 km is left out of `nearest`. It is not 0 m. No data: key absent. |
| `crime` | `/v1/suburbs/{suburb_name}/crime/by-mesh-block` and `/v1/suburbs/{suburb_name}/crime/summary` | by-mesh-block: `mesh_blocks[<mesh_block>]` as `rate`, with basis `mesh_block`. summary: `suburb_median`, `national_median`, `verdict`, `unit`. | The fixed label `"2020-22 model"`: the model is trained on incidents averaged over 2020 to 2022. | Block not in the map: `rate` is omitted and basis becomes `suburb`. Summary missing: no `national_median`, so Safety is blank. |
| `amenities` | `/v1/properties/{gnaf_id}/amenities/nearby` (default radius 1,000 m) | `radius_m`; `counts.restaurant`, `counts.supermarket`, `counts.green_spaces`; the first rows of `results[]` (nearest first) as `nearest`. | None; `fetched_at`. | A category missing from a present `counts` object counts as 0 (the endpoint looked and found none). No data: key absent, so Liveliness is blank. |
| `busy_road` | `/v1/suburbs/{suburb_name}/shapes/busy-roads?geojson=true` | `geojson.features[]` (LineString or MultiLineString) with `properties.road_class`. The proxy computes `nearest_m`, the shortest point-to-segment distance from `location` (equirectangular projection), and `segments`, the number of features. | None; `fetched_at`. | `segments: 0`: `nearest_m` is absent and Quiet scores 90. No data, an error or no `location`: see §8. |
| `flood` | `/v1/properties/{gnaf_id}/risks/flood` | The `Flood` row: `on_property`; `nearest_distance_m` as `nearest_m`. | None; `fetched_at`. | `[]` means no flood overlay within 1 km, read as `on_property: false`. No data: key absent, so there is no flood penalty and no flood failo. |
| `vacancy` | `/v1/suburbs/{suburb_name}/market/vacancy-map` and `/v1/suburbs/{suburb_name}/market/vacancy-rate` | vacancy-map: the `mbs[]` row whose `mb` equals `location.mesh_block`; `vacancy_pct` is already a percent, used as `block_pct`. vacancy-rate: `unit.value` or `house.value` is a decimal fraction; ×100 gives `suburb_pct`. | vacancy-rate `as_of`. | Block not in the map: `block_pct` absent. Both absent: key absent. |
| `avm` | `/v1/properties/{gnaf_id}/valuation/avm` | `predicted_price`, `predicted_price_low`, `predicted_price_high`, `confidence_score` (may be `null`, then absent). | `prediction_date`. | `data: null`: key absent, so Affordability is blank in buy mode. |
| `work` | `/v1/geocode/address` for `profile.work_address`, filtered to the 29 City of Sydney suburbs; coordinates come from a property endpoint for the work `gnaf_id`. `work.via` lists both. | `display_name`; `lat`, `lng`. | None. | No work address: `missing.work = "not_requested"`. Outside the 29 suburbs: `"outside_coverage"`. Commute then uses transit only. |

Notes:

- **Units.** Rents are AUD per week. Crime is predicted incidents per 100,000 residents per year. `block_pct` and `suburb_pct` are both **percent** (2.4 means 2.4%). vacancy-map already returns a percent; vacancy-rate returns a fraction and is multiplied by 100.
- **Unit or house.** rent-map, median-rent and vacancy-rate are read for `unit` or `house` according to `property_type`. When the type is unknown, `unit` is used (most inner-city homes are units), and the proxy records that it assumed this.
- **Why geocode is not enough for work.** Geocode candidates are not guaranteed to carry coordinates (the schema is open, and the published example has none), so the work location takes a second call.
- **`via` strings** are endpoint templates such as `/v1/properties/{gnaf_id}/risks/flood`. The panel shortens them for display.
- **Facts carried but not scored:** `crime.verdict`, `amenities.nearest`, `flood.nearest_m`, the AVM range and `confidence_score`, and the transport `label`s. They are there for context and display only.

## 4. Scoring mechanics

- **Interpolation.** `interpolate(anchors, x)` takes `[x, score]` pairs in ascending `x`. Between two anchors the score is a straight line. Below the first anchor it is the first anchor's score, and above the last anchor it is the last anchor's score. In the tables below, "≤" on the first row and "≥" on the last row show this flat extension. Values between rows are interpolated.
- **Rounding and clamping.** Each dimension is computed from the interpolated value plus its modifiers, clamped to 0–100, and rounded once with `Math.round` to an integer. Every modifier is a whole number, so rounding earlier would give the same integer.
- **Blank.** A dimension whose facts are absent scores `null` (blank), never 0 (§8).
- **Fast stop** means a train, tram (light rail) or ferry stop. A bus stop is not a fast stop.

## 5. The six dimensions

| # | Dimension | Priority | Metric | Modifiers | Halo label | Failo label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Affordability | `cheap` | Rent mode: rent as a share of income, and rent ÷ max rent. Buy mode: valuation ÷ max price, and valuation ÷ annual income. The lower sub-score wins. | none | Affordable | Unaffordable |
| 2 | Commute | `close_to_work` | Straight-line km to work. With no work location: metres to the nearest fast stop. | With work: +10 for a fast stop ≤ 800 m, else +5 for a bus ≤ 300 m; cap 100. | Close to work (no work: Good transit) | Long commute (no work: Poor transit) |
| 3 | Safety | `safe` | Crime rate ÷ national median (the block rate, else the suburb median). | +10 or −10 against the suburb median (block basis only); −20 if a flood overlay covers the property. | Lower crime | Higher crime |
| 4 | Liveliness | `lively` | restaurants + 3 × supermarkets + 2 × green spaces, within 1 km. | none | Lively | Few amenities |
| 5 | Quiet | `quiet` | Metres to the nearest busy-road segment. | −10 if the road is a motorway or trunk road under 150 m away. No segment in the suburb: 90. | Quiet street | Busy road nearby |
| 6 | Negotiability | `negotiable` | Rental vacancy % in the property's block, else in the suburb. | +10 if the block is ≥ 1.25 × the suburb; −10 if it is ≤ 0.75 × the suburb. | Room to negotiate | Tight market |

### 5.1 Affordability (priority `cheap`)

**Rent mode.** The rent used, R, is chosen in this order:

1. `rent_advert.weekly_rent`, if `rent_advert.date` is within 18 months of now;
2. otherwise `rent_estimate.weekly_rent` (the mesh-block median, else the suburb median);
3. otherwise the older `rent_advert`;
4. none of these: blank ("No rent data").

Income share, s = R ÷ `income_week`:

| Rent as share of weekly income | Score |
| --- | --- |
| ≤ 25% | 100 |
| 30% | 80 |
| 40% | 45 |
| 50% | 20 |
| ≥ 70% | 0 |

Budget ratio, b = R ÷ `budget.max_rent_week`:

| Rent ÷ max rent | Score |
| --- | --- |
| ≤ 0.90 | 100 |
| 1.00 | 70 |
| 1.15 | 35 |
| ≥ 1.40 | 0 |

**Score** = the lower of the sub-scores whose inputs are set (a positive number). If neither income nor budget is set, the dimension is blank ("Set a budget or income"). Display: `$780/wk · 130% of income`. `via` and `as_of` come from the rent fact used.

The 30% row follows the common rule of thumb that rent above 30% of income is housing stress.

**Buy mode.** P = `avm.predicted_price`. No valuation: blank ("No valuation").

Budget ratio, b = P ÷ `budget.max_price`: the same rows as the rent budget ratio above (≤ 0.90 → 100, 1.00 → 70, 1.15 → 35, ≥ 1.40 → 0).

Income multiple, m = P ÷ (`income_week` × 52):

| Price ÷ annual income | Score |
| --- | --- |
| ≤ 4× | 100 |
| 6× | 75 |
| 9× | 40 |
| 12× | 10 |
| ≥ 15× | 0 |

**Score** = the lower of the available sub-scores. If neither max price nor income is set, the dimension is blank ("Set a budget or income"; the v1 table names this message only for rent mode, and the same rule is applied here). Display: `Est. $1.13m · 36x income`. `via` and `as_of` come from `avm`.

### 5.2 Commute (priority `close_to_work`)

**With `facts.work` and `facts.location`.** d = haversine distance in km (Earth radius 6,371 km):

| Straight-line distance to work | Score |
| --- | --- |
| ≤ 1.5 km | 100 |
| 3 km | 85 |
| 6 km | 60 |
| 10 km | 35 |
| 20 km | 10 |
| ≥ 30 km | 0 |

Then +10 if the nearest fast stop is ≤ 800 m away; otherwise +5 if the nearest bus stop is ≤ 300 m away. Cap at 100. If `transport` is absent, there is no bonus. Display: `2.1 km to 188 Pitt St · train 640 m` (the matched workplace, first part of its `display_name` with the street type abbreviated, so the user can see which workplace was located; `work` when it has no name). Labels: halo "Close to work", failo "Long commute".

**Without work (or without location).** This uses the nearest fast stop's distance in metres:

| Nearest train, tram or ferry stop | Score |
| --- | --- |
| ≤ 300 m | 90 |
| 800 m | 75 |
| 1,500 m | 50 |
| ≥ 3,000 m | 25 |

- No fast stop within the radius, but a bus stop ≤ 300 m: **45**.
- `transport` present but no stop at all: **20**. A bus stop further than 300 m with no fast stop is read the same way, as 20 (the v1 table does not name this case).
- `transport` absent: blank.

Transport is fetched with a 2,000 m radius, so a fast stop beyond 2 km is reported as no stop. In practice the lowest interpolated fast-stop score is about 42, at 2,000 m. Display: `Train 640 m · bus 80 m`. Labels: halo "Good transit", failo "Poor transit".

### 5.3 Safety (priority `safe`)

rate = `crime.rate` (basis `mesh_block`), else `crime.suburb_median` (basis `suburb`). c = rate ÷ `crime.national_median`. If `national_median` is missing, the dimension is blank.

| Crime rate ÷ national median | Score |
| --- | --- |
| ≤ 0.5× | 100 |
| 1.0× | 80 |
| 2.0× | 55 |
| 4.0× | 25 |
| ≥ 8.0× | 0 |

Modifiers:

- **Within-suburb**, applied only when the basis is `mesh_block` and `suburb_median` is present. If rate ÷ `suburb_median` is ≤ 0.8: +10. If it is ≥ 1.25: −10.
- **Flood**: if `flood.on_property === true`: −20.
- Clamp to 0–100.

Display: `Crime 1.8x national · 0.7x suburb`. Labels: halo "Lower crime", failo "Higher crime".

### 5.4 Liveliness (priority `lively`)

A = `counts.restaurant` + 3 × `counts.supermarket` + 2 × `counts.green_spaces`. A category missing from a present `counts` object counts as 0. If `amenities` is absent, the dimension is blank.

| Weighted amenity count A (within 1 km) | Score |
| --- | --- |
| 0 | 0 |
| 5 | 25 |
| 15 | 55 |
| 30 | 80 |
| ≥ 50 | 100 |

Display: `38 food & drink · 3 supermarkets · 6 parks in 1 km`. Labels: halo "Lively", failo "Few amenities".

### 5.5 Quiet (priority `quiet`)

D = `busy_road.nearest_m`.

| Distance to nearest busy-road segment | Score |
| --- | --- |
| 0 m | 0 |
| 25 m | 10 |
| 50 m | 30 |
| 100 m | 55 |
| 200 m | 80 |
| ≥ 400 m | 100 |

Special cases:

- If `road_class` is `motorway` or `trunk` and D < 150 m: −10, clamped at 0.
- `busy_road` present with `segments === 0`: **90** ("No busy road mapped in the suburb").
- `busy_road` absent: blank.
- `busy_road` present with segments but no `nearest_m` (the property location is unknown): blank. The v1 table leaves this case implicit.

Display: `Busy road 45 m (primary)`. Labels: halo "Quiet street", failo "Busy road nearby".

### 5.6 Negotiability (priority `negotiable`)

V = `vacancy.block_pct` (percent), else `vacancy.suburb_pct`.

| Rental vacancy | Score |
| --- | --- |
| ≤ 0.5% | 10 |
| 1.0% | 30 |
| 2.0% | 55 |
| 3.0% | 75 |
| ≥ 5.0% | 100 |

Modifier, applied only when both `block_pct` and `suburb_pct` are present: block ÷ suburb ≥ 1.25 gives +10, and ≤ 0.75 gives −10. Clamp to 0–100.

The same metric is used in **buy mode**. Here rental slack is a proxy for softer investor competition. It is a weaker signal for buyers than for renters (§10).

Display: `Vacancy 2.4% here · 1.6% suburb`. Labels: halo "Room to negotiate", failo "Tight market".

## 6. Weights, bands, total and coverage

- **Weights.** Each dimension has weight 1. A dimension whose priority the profile picked has weight 2. At most three priorities can be picked, so with all six dimensions scored the weights sum to between 6 and 9.
- **Total.** `total = Math.round( Σ(w × s) ÷ Σ(w) )`, taken over the **scored** dimensions only, using their rounded integer scores. If no dimension is scored, the total is `null`: there is no reading to show, and it is never shown as 0.
- **Coverage.** `coverage = { scored, of: 6 }`. It is shown so a total built from two dimensions is not mistaken for one built from six.
- **Bands.** The same bands apply to dimensions and to the total:

| Score | Band (meter label) |
| --- | --- |
| 0–39 | Failo |
| 40–69 | Meh |
| 70–100 | Halo |

## 7. Halos, failos and the verdict sentence

- **Halos** are the scored dimensions with a score of 70 or more. Picked priorities come first, then the rest by score, highest first.
- **Failos** are the scored dimensions with a score below 40. Picked priorities come first, then the rest by score, lowest first. After them comes one extra failo, key `flood`, label "Flood overlay on property", whenever `facts.flood.on_property === true`. (The flood also costs Safety 20 points, §5.3.)
- Dimensions in the Meh band (40–69) and blank dimensions appear in neither list. The panel shows Meh dimensions in a third, smaller group under the failos (label = the dimension name, same number, via and date), only when there are any: they count toward the total, and on a sale listing scored in buy mode a Meh Affordability is the only place the valuation appears. Blank dimensions are listed in one line with the reason (`blank_reason`, e.g. "set a budget or income").
- Each item shows a short label (the halo or failo label from §5), the number (the display string), `via {endpoint}` and the as-of date. Transport, amenities, busy roads and flood carry no as-of date in the API response, so for those the only date available is `fetched_at`, the time of the lookup.
- Ties keep the table order: affordability, commute, safety, liveliness, quiet, negotiability. `score.js` sorts this way.

**Verdict sentence.** There is one sentence under the meter. It is built only from the **top halo** (`halos[0]`) and the **top failo** (`failos[0]`), each with its display number. `extension/panel/meter.js` generates the wording:

| Case | Sentence pattern |
| --- | --- |
| Both exist | `{Halo label} ({number}), but {failo label}: {number}.` |
| Only a halo | `No failos. Strongest: {halo label} ({number}).` |
| Only a failo | `No halos. Main concern: {failo label} ({number}).` |
| Neither | "Nothing stands out either way for this profile." |
| Total is `null` | "Not enough data to score this home yet." |

If a sentence is too long for the panel, meter.js drops the numbers, one at a time. Leading words of a number that its label already says are dropped ("busy road nearby: 45 m (primary)", not "busy road nearby: Busy road 45 m (primary)").

Picked priorities sort first, so the verdict talks about what the user said matters. The flood item is appended last, so it is the top failo only when no dimension is a failo.

## 8. Blanks: absent never means zero

A missing fact means "we do not know", not "zero". Scoring a missing fact as 0 would punish a home for a gap in the data. So:

- A dimension whose required facts are absent is **blank** (`null`). It is shown as blank with its reason, taken from `facts.missing` or from the messages in §5.
- Blank dimensions are left out of **both** the top and the bottom of the total's weighted average, and `coverage.scored` drops by one.
- Inside a dimension, a missing optional input removes only that input. Two examples: Affordability takes the lower of the sub-scores that can be computed, and Safety skips the within-suburb modifier when `suburb_median` is missing.

When each dimension is blank:

| Dimension | Blank when |
| --- | --- |
| Affordability | Rent mode: no `rent_advert` and no `rent_estimate` ("No rent data"), or neither income nor max rent set ("Set a budget or income"). Buy mode: no `avm` ("No valuation"), or neither income nor max price set. |
| Commute | `transport` absent and (`work` or `location` absent). With work and location but no transport, it is scored on distance with no bonus. |
| Safety | `crime` absent; or no `national_median`; or neither a block `rate` nor a `suburb_median`. |
| Liveliness | `amenities` absent. |
| Quiet | `busy_road` absent; or segments > 0 with no `nearest_m`. |
| Negotiability | `vacancy` absent, or neither `block_pct` nor `suburb_pct`. |

The extra flood failo and the Safety flood penalty apply only when `flood.on_property === true`. A missing flood fact adds neither.

## 9. Worked example: Sarah and a $780/wk unit in Surry Hills

**The inputs are illustrative.** They are round numbers in the shape the API returns, not a copy of API output (the hand-in rules keep API output out of the repo). Scoring time: 7 November 2026.

**Profile:** Sarah. `mode: "rent"`, max rent $250/wk, income $600/wk, work at 188 Pitt Street, Sydney, priorities `cheap`, `close_to_work` and `safe`.

**Facts:**

| Fact | Value |
| --- | --- |
| `rent_advert` | $780/wk, dated 2026-09-14 |
| `rent_estimate` | $690/wk, basis `mesh_block` (not used, see step 1) |
| `location` | −33.8890, 151.2140, mesh block known |
| `work` | 188 Pitt Street, Sydney: −33.8710, 151.2078 |
| `transport` | tram 380 m, train 1,050 m, bus 90 m (radius 2,000 m) |
| `crime` | block rate 5,040; suburb median 5,600; national median 2,800 (per 100,000 residents per year) |
| `amenities` | 14 restaurants, 2 supermarkets, 4 green spaces within 1 km |
| `busy_road` | nearest 45 m, `road_class` primary, 31 segments |
| `flood` | `on_property: false`, nearest 410 m |
| `vacancy` | block 2.4%; suburb 0.016 from vacancy-rate, × 100 = 1.6% |

**Step 1: Affordability (picked, weight 2).**
The advert is dated 2026-09-14. That is 54 days before scoring, within 18 months, so R = 780 and the $690 estimate is not used.
Income share s = 780 ÷ 600 = 1.30. This is past the last anchor (0.70), so the sub-score is 0.
Budget ratio b = 780 ÷ 250 = 3.12. This is past the last anchor (1.40), so the sub-score is 0.
Score = min(0, 0) = **0**. Failo: "Unaffordable", `$780/wk · 130% of income`.

For scale: at exactly her $250 budget the score would be min(interp(250 ÷ 600 = 0.417) = 40.8, interp(1.00) = 70) = **41** (Meh). Sarah's income, not her budget, is the binding limit. She reaches Halo (70 or more after rounding) only at about $198/wk or less, and leaves Failo (40 or more) only at about $253/wk or less.

**Step 2: Commute (picked, weight 2).**
d = haversine((−33.8890, 151.2140), (−33.8710, 151.2078)) = 2.082 km.
This falls between the 1.5 km (100) and 3 km (85) anchors: 100 + (2.082 − 1.5) ÷ (3 − 1.5) × (85 − 100) = 100 − 0.388 × 15 = 94.18.
The nearest fast stop is the tram at 380 m, which is ≤ 800 m, so +10: 104.18. The cap at 100 gives **100**.
Halo: "Close to work", `2.1 km to 188 Pitt St · tram 380 m`.

**Step 3: Safety (picked, weight 2).**
c = 5,040 ÷ 2,800 = 1.80. This falls between 1.0× (80) and 2.0× (55): 80 + (1.80 − 1.0) ÷ (2.0 − 1.0) × (55 − 80) = 80 − 20 = 60.
Within-suburb: 5,040 ÷ 5,600 = 0.90. That is neither ≤ 0.8 nor ≥ 1.25, so there is no modifier.
The flood overlay is not on the property, so there is no penalty. Score **60**, Meh: `Crime 1.8x national · 0.9x suburb`.

**Step 4: Liveliness (weight 1).**
A = 14 + 3 × 2 + 2 × 4 = 28. This falls between 15 (55) and 30 (80): 55 + (28 − 15) ÷ (30 − 15) × (80 − 55) = 55 + 21.67 = 76.67, rounded to **77**.
Halo: "Lively", `14 food & drink · 2 supermarkets · 4 parks in 1 km`.

**Step 5: Quiet (weight 1).**
D = 45 m. This falls between 25 m (10) and 50 m (30): 10 + (45 − 25) ÷ (50 − 25) × (30 − 10) = 10 + 16 = 26.
The road is primary, not motorway or trunk, so there is no modifier. Score **26**.
Failo: "Busy road nearby", `Busy road 45 m (primary)`.

**Step 6: Negotiability (weight 1).**
V = block 2.4%. This falls between 2.0% (55) and 3.0% (75): 55 + (2.4 − 2.0) ÷ (3.0 − 2.0) × (75 − 55) = 55 + 8 = 63.
Block ÷ suburb = 2.4 ÷ 1.6 = 1.50, which is ≥ 1.25, so +10. Score **73**.
Halo: "Room to negotiate", `Vacancy 2.4% here · 1.6% suburb`.

**Total.**

| Dimension | Score | Weight | w × s |
| --- | --- | --- | --- |
| Affordability (Cheap, picked) | 0 | 2 | 0 |
| Commute (Close to work, picked) | 100 | 2 | 200 |
| Safety (Safe, picked) | 60 | 2 | 120 |
| Liveliness | 77 | 1 | 77 |
| Quiet | 26 | 1 | 26 |
| Negotiability | 73 | 1 | 73 |
| **Sum** | | **9** | **496** |

total = round(496 ÷ 9) = round(55.11) = **55**, which is **Meh**. Coverage: 6 of 6.

- **Halos**, in order: Close to work (100, picked), Lively (77), Room to negotiate (73).
- **Failos**, in order: Unaffordable (0, picked), Busy road nearby (26). There is no flood item, because `on_property` is false.
- **Verdict**, built from the top halo and the top failo: "Close to work (2.1 km to 188 Pitt St · tram 380 m), but unaffordable: $780/wk · 130% of income."

**Cross-check.** These inputs were run through `extension/panel/score.js` and `meter.js` on 7 Nov 2026 with a throwaway script that is not committed. Every dimension score, display string, weight, the total (55, Meh), the halo and failo order and the verdict matched this section. So did the what-if figures: 41 at $250/wk, the $198 and $253 break-evens, 56 with no priorities, 59 with Quiet blank, and 0 in the buy-mode aside.

**What the weights did.** With no priorities picked, the total would be (0 + 100 + 60 + 77 + 26 + 73) ÷ 6 = 336 ÷ 6 = **56**. Doubling Affordability (0) pulls the total down. Doubling Commute (100) and Safety (60) pulls it back up by almost as much.

**What "absent never means zero" does.** Suppose the busy-roads call had failed. Quiet would then be blank, and the total would be round((496 − 26) ÷ (9 − 1)) = round(58.75) = **59**, with coverage 5 of 6. Scoring the missing fact as 0 instead would give round(470 ÷ 9) = 52, a 7-point penalty for a gap in the data.

**Buy-mode aside.** Suppose Sarah flipped the toggle to buy and left max price empty, with an AVM of $1,130,000. Only the income multiple applies: m = 1,130,000 ÷ (600 × 52) = 1,130,000 ÷ 31,200 = 36.2×. That is past the last anchor (15×), so Affordability = **0**, `Est. $1.13m · 36x income`.

## 10. Limitations

- **Block-level crime is modelled, not recorded.** The rate is a model's prediction for the mesh block. The model was trained on QLD Police mesh-block incidents averaged over 2020–2022 and applied to every Australian mesh block. It is not NSW recorded crime, and it is not current. Rates are per 100,000 *residents*, so blocks with few residents and many visitors (shopping strips, nightlife) can look worse than daily life there feels.
- **Busy roads are clipped to the suburb.** A busy road just across the suburb boundary is not in the data, so `nearest_m` can be overstated, and Quiet overscored, for homes near a boundary. Only mapped busy-road segments count. Rail lines, flight paths, venues and construction noise are not included.
- **There is no per-property rent estimate.** The API has none. `rent_estimate` is the median advertised rent for the property type in the home's mesh block (`basis: "mesh_block"`), else the suburb median (`basis: "suburb"`). A large or renovated home in a cheap block will look more affordable than it is. The latest advert can also be old, which is why an advert more than 18 months old is ranked below the estimate.
- **The commute is straight-line.** It is haversine distance, not travel time, and it ignores fares, frequencies and whether a line goes anywhere near work. The transit bonus only checks that a stop is close. A work address outside the 29 City of Sydney suburbs cannot be located, so Commute falls back to transit only. The proxy accepts a geocoded workplace only when its street agrees with what was typed and its suburb does not contradict it (`missing.work = "no_match:work_street_or_suburb_differs"` otherwise), so "10 George Street, Parramatta" never becomes 10 George Street, Redfern.
- **Vacancy is a proxy for negotiability.** It measures rental slack. For renters, higher vacancy plausibly means more room to negotiate. In buy mode it stands in for softer investor competition, which is a weaker and less direct link to sale-price negotiability.
- **Amenities are a curated list.** Only supermarkets, green spaces and restaurants or cafes within 1 km are counted. A count says nothing about quality or opening hours.
- **Flood is a modelled overlay.** Only `on_property` affects the score. A nearby overlay (a returned row with `on_property: false`) has no effect.
- **Freshness varies.** Transport, amenities, busy roads and flood return no as-of date. Crime is a 2020–22 model. Rent and vacancy dates come from the API (§3).
- **The thresholds are judgement calls.** The anchors, modifiers and weights were set by the team on the day and have not been fitted or validated against renter or buyer outcomes. The total is a weighted average, so a strong dimension can hide a fatal one. That is why failos are listed separately, picked priorities first, and why the verdict always names the top failo.
- **The profile decides rent or buy, not the listing.** By design (§2), a sale listing can be scored as a rental and the reverse. The panel scores what the user asked for, not what the page is advertising.

## 11. Status and change log

- **v1 (7 Nov 2026), draft.** The user's original scoring table was not received. This v1 was drafted on the day from the six dimensions, the bands and the priority weighting described in the brief, and all thresholds are provisional. Every number in §5 and §6 lives in one exported `TABLE` constant in `extension/panel/score.js`, so a replacement table can be swapped in without touching the scoring logic. If it is replaced, update this document, the constant and `tests/score.test.js` together.
- Cases where the v1 table is silent, filled in here as `score.js` implements them:
  - In Commute without work, a bus beyond 300 m with no fast stop scores 20 (§5.2).
  - In Quiet, segments with no `nearest_m` score blank, with the reason "Busy-road distance unknown" (§5.5).
  - In buy mode, the "Set a budget or income" blank applies (§5.1).
  - Ties in halos and failos keep the table order (§7).
- **v1.1 (7 Nov 2026, fixer pass).** No threshold, anchor or weight changed. Commute display names the matched workplace (§5.2); the panel shows Meh dimensions and blank reasons (§7); verdict wording for the one-sided cases (§7); the proxy reports `amenities` absent (not a row of zeros) when the answer has no usable counts (§8).
