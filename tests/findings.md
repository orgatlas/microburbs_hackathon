# E2E findings

Written by `node tests/e2e/run.mjs`. Re-running overwrites this file.

- Run: 07/11/2026, 12:17:52 (Australia/Sydney), 22 s, Chromium headed, fresh temp profile, unpacked `extension/`
- Proxy mode: **mock** (no MICROBURBS_API_KEY in proxy/.env, so MOCK=1; every lookup returns the 26 Tudor Street, Surry Hills fixture), 127.0.0.1:8787
- Panel build: new panel (`.mbx-body` present)
- Pages: archived markup served at the real listing URL. Both sites block automated Chromium (domain: Akamai "Access Denied", realestate: Kasada 429); the harness does not try to get past that.

## Profiles used

Set through the extension service worker (`chrome.storage.local["mbx.profile.v1"]`) before each listing.

- Rentals: Sarah (the DEFAULT): `{"version":1,"name":"Sarah","about":"19 · casual retail","budget":{"mode":"rent","max_rent_week":250,"max_price":null},"income_week":600,"work_address":"188 Pitt Street, Sydney NSW 2000","priorities":["cheap","close_to_work","safe"]}`
- Sales: Sarah's priorities, budget buy up to $1,200,000, income $2,500/wk: `{"version":1,"name":"Sarah","about":"buyer test profile","budget":{"mode":"buy","max_rent_week":null,"max_price":1200000},"income_week":2500,"work_address":"188 Pitt Street, Sydney NSW 2000","priorities":["cheap","close_to_work","safe"]}`
- Applied: ok for every listing (service worker)

## Listings

| # | kind | site | suburb | source | page address (h1) | panel query | matched address | check verdict | total / band | blank dimensions | screenshot |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rent-1 | rent | domain | Redfern | archived:20251210010234 | 17 Young Street, Redfern NSW 2016 | 17 Young Street, Redfern NSW 2016 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 17 differs from matched 26 · Street "Young Street" differs from matched "Tudor Street" · Suburb Redfern differs from matched Surry Hills · skipped 1 higher-ranked result outside the City of Sydney | 60 / meh | none | tools/shots/e2e-rent-1.png |
| rent-2 | rent | realestate | Ultimo | archived:20250501142733 | 504/349-355 Bulwara Road, Ultimo, NSW 2007 | 504/349-355 Bulwara Road, Ultimo NSW 2007 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 349-355 differs from matched 26 · Unit 504 is not in the matched address · Street "Bulwara Road" differs from matched "Tudor Street" · Suburb Ultimo differs from matched Surry Hills · skipped 1 higher-ranked result outside the City of Sydney | 60 / meh | none | tools/shots/e2e-rent-2.png |
| rent-3 | rent | domain | Zetland | archived:20251219094851 | 59 Portman Street, Zetland NSW 2017 | 59 Portman Street, Zetland NSW 2017 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 59 differs from matched 26 · Street "Portman Street" differs from matched "Tudor Street" · Suburb Zetland differs from matched Surry Hills · skipped 1 higher-ranked result outside the City of Sydney | 60 / meh | none | tools/shots/e2e-rent-3.png |
| sale-1 | sale | realestate | Surry Hills | archived:20250506010259 | 8/342 Bourke Street, Surry Hills, NSW 2010 | 8/342 Bourke Street, Surry Hills NSW 2010 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 342 differs from matched 26 · Unit 8 is not in the matched address · Street "Bourke Street" differs from matched "Tudor Street" · skipped 1 higher-ranked result outside the City of Sydney | 70 / halo | none | tools/shots/e2e-sale-1.png |
| sale-2 | sale | realestate | Pyrmont | archived:20250428103616 | 801/8 Darling Island Road, Pyrmont, NSW 2009 | 801/8 Darling Island Road, Pyrmont NSW 2009 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 8 differs from matched 26 · Unit 801 is not in the matched address · Street "Darling Island Road" differs from matched "Tudor Street" · Suburb Pyrmont differs from matched Surry Hills · skipped 1 higher-ranked result outside the City of Sydney | 70 / halo | none | tools/shots/e2e-sale-2.png |
| sale-3 | sale | domain | Glebe | archived:20260316120623 | 110/11 Wigram Lane, Glebe NSW 2037 | 110/11 Wigram Lane, Glebe NSW 2037 | 26 Tudor Street, Surry Hills | weak: Weak match: check this is the right home · Street number 11 differs from matched 26 · Unit 110 is not in the matched address · Street "Wigram Lane" differs from matched "Tudor Street" · Suburb Glebe differs from matched Surry Hills · skipped 1 higher-ranked result outside the City of Sydney | 70 / halo | none | tools/shots/e2e-sale-3.png |

Listing URLs: [rent-1](https://www.domain.com.au/17-young-street-redfern-nsw-2016-17875055), [rent-2](https://www.realestate.com.au/property-apartment-nsw-ultimo-426000942), [rent-3](https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853), [sale-1](https://www.realestate.com.au/property-apartment-nsw-surry+hills-147399572), [sale-2](https://www.realestate.com.au/property-apartment-nsw-pyrmont-143367376), [sale-3](https://www.domain.com.au/110-11-wigram-lane-glebe-nsw-2037-2020659759).

## Address mismatches

Page address (h1) vs the panel's matched name, both normalised (case, punctuation, street type, state, postcode) and compared as unit / number / street / suburb.
Mock mode: the mock geocoder always answers 26 Tudor Street, Surry Hills, so every listing is expected to mismatch here. This only proves the comparison runs; it says nothing about the matcher.

- rent-1 (domain, Redfern): "17 Young Street, Redfern NSW 2016" vs "26 Tudor Street, Surry Hills": number 17 vs 26; street "young st" vs "tudor st"; suburb redfern vs surry hills
  - proxy check (weak): Street number 17 differs from matched 26; Street "Young Street" differs from matched "Tudor Street"; Suburb Redfern differs from matched Surry Hills
- rent-2 (realestate, Ultimo): "504/349-355 Bulwara Road, Ultimo, NSW 2007" vs "26 Tudor Street, Surry Hills": unit 504 on the page, none in the match; number 349-355 vs 26; street "bulwara rd" vs "tudor st"; suburb ultimo vs surry hills
  - proxy check (weak): Street number 349-355 differs from matched 26; Unit 504 is not in the matched address; Street "Bulwara Road" differs from matched "Tudor Street"; Suburb Ultimo differs from matched Surry Hills
- rent-3 (domain, Zetland): "59 Portman Street, Zetland NSW 2017" vs "26 Tudor Street, Surry Hills": number 59 vs 26; street "portman st" vs "tudor st"; suburb zetland vs surry hills
  - proxy check (weak): Street number 59 differs from matched 26; Street "Portman Street" differs from matched "Tudor Street"; Suburb Zetland differs from matched Surry Hills
- sale-1 (realestate, Surry Hills): "8/342 Bourke Street, Surry Hills, NSW 2010" vs "26 Tudor Street, Surry Hills": unit 8 on the page, none in the match; number 342 vs 26; street "bourke st" vs "tudor st"
  - proxy check (weak): Street number 342 differs from matched 26; Unit 8 is not in the matched address; Street "Bourke Street" differs from matched "Tudor Street"
- sale-2 (realestate, Pyrmont): "801/8 Darling Island Road, Pyrmont, NSW 2009" vs "26 Tudor Street, Surry Hills": unit 801 on the page, none in the match; number 8 vs 26; street "darling island rd" vs "tudor st"; suburb pyrmont vs surry hills
  - proxy check (weak): Street number 8 differs from matched 26; Unit 801 is not in the matched address; Street "Darling Island Road" differs from matched "Tudor Street"; Suburb Pyrmont differs from matched Surry Hills
- sale-3 (domain, Glebe): "110/11 Wigram Lane, Glebe NSW 2037" vs "26 Tudor Street, Surry Hills": unit 110 on the page, none in the match; number 11 vs 26; street "wigram ln" vs "tudor st"; suburb glebe vs surry hills
  - proxy check (weak): Street number 11 differs from matched 26; Unit 110 is not in the matched address; Street "Wigram Lane" differs from matched "Tudor Street"; Suburb Glebe differs from matched Surry Hills

## Blank dimensions

Dimensions: affordability, commute, safety, liveliness, quiet, negotiability. Read from `.mbx-body[data-blank]`; reasons from any blank rows the panel renders.

- rent-1 (domain, Redfern): none blank
  - halos: commute, safety, liveliness · failos: affordability, quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but unaffordable: $820/wk · 137% of income."
  - scored but not shown (neither halo nor failo, not blank): none
- rent-2 (realestate, Ultimo): none blank
  - halos: commute, safety, liveliness · failos: affordability, quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but unaffordable: $820/wk · 137% of income."
  - scored but not shown (neither halo nor failo, not blank): none
- rent-3 (domain, Zetland): none blank
  - halos: commute, safety, liveliness · failos: affordability, quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but unaffordable: $820/wk · 137% of income."
  - scored but not shown (neither halo nor failo, not blank): none
- sale-1 (realestate, Surry Hills): none blank
  - halos: commute, safety, liveliness · failos: quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but busy road nearby: 59 m (primary)."
  - scored but not shown (neither halo nor failo, not blank): none
- sale-2 (realestate, Pyrmont): none blank
  - halos: commute, safety, liveliness · failos: quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but busy road nearby: 59 m (primary)."
  - scored but not shown (neither halo nor failo, not blank): none
- sale-3 (domain, Glebe): none blank
  - halos: commute, safety, liveliness · failos: quiet · verdict: "Close to work (1.8 km to 188 Pitt St · tram 382 m), but busy road nearby: 59 m (primary)."
  - scored but not shown (neither halo nor failo, not blank): none

## Panel checks

Read from the panel's shadow root on first render. Four screenshots per listing: `e2e-<kind>-<n>.png` is the listing at 1440x900 with the panel as first shown; `-bottom` is the same view with the panel body scrolled to its end; `-tall` is the listing on a 1440-wide viewport just tall enough for the whole panel; `-panel` is that panel cropped.

- rent-1 (domain, Redfern): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 2 / Meh 1 · profile collapsed: "SCORED FOR | Sarah, 19 · casual retail | Edit | Renting · max $250/wk · income $600/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1326 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: page 0 px, panel 117 px (reset to 0 for the shots)
  - screenshots: tools/shots/e2e-rent-1.png, tools/shots/e2e-rent-1-bottom.png, tools/shots/e2e-rent-1-tall.png, tools/shots/e2e-rent-1-panel.png
- rent-2 (realestate, Ultimo): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 2 / Meh 1 · profile collapsed: "SCORED FOR | Sarah, 19 · casual retail | Edit | Renting · max $250/wk · income $600/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1326 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: none
  - screenshots: tools/shots/e2e-rent-2.png, tools/shots/e2e-rent-2-bottom.png, tools/shots/e2e-rent-2-tall.png, tools/shots/e2e-rent-2-panel.png
- rent-3 (domain, Zetland): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 2 / Meh 1 · profile collapsed: "SCORED FOR | Sarah, 19 · casual retail | Edit | Renting · max $250/wk · income $600/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1326 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: none
  - screenshots: tools/shots/e2e-rent-3.png, tools/shots/e2e-rent-3-bottom.png, tools/shots/e2e-rent-3-tall.png, tools/shots/e2e-rent-3-panel.png
- sale-1 (realestate, Surry Hills): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 1 / Meh 2 · profile collapsed: "SCORED FOR | Sarah, buyer test profile | Edit | Buying · max $1.2m · income $2,500/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1309 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: none
  - screenshots: tools/shots/e2e-sale-1.png, tools/shots/e2e-sale-1-bottom.png, tools/shots/e2e-sale-1-tall.png, tools/shots/e2e-sale-1-panel.png
- sale-2 (realestate, Pyrmont): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 1 / Meh 2 · profile collapsed: "SCORED FOR | Sarah, buyer test profile | Edit | Buying · max $1.2m · income $2,500/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1326 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: none
  - screenshots: tools/shots/e2e-sale-2.png, tools/shots/e2e-sale-2-bottom.png, tools/shots/e2e-sale-2-tall.png, tools/shots/e2e-sale-2-panel.png
- sale-3 (domain, Glebe): footer "Microburbs estimates, not advice" + "Automated, indicative figures · Data: Microburbs · Open G-NAF © Geoscape" · shell footer hidden · badge "Mock data" · lists: Halos 3 / Failos 1 / Meh 2 · profile collapsed: "SCORED FOR | Sarah, buyer test profile | Edit | Buying · max $1.2m · income $2,500/wk | Work: 188 Pitt Street, Sydney | Cheap | Close to work | Safe" · panel body shows 744 of 1326 px, footer reachable by scrolling · drawn outside the panel: nothing · text cut short: nothing · scroll before the first shot: none
  - screenshots: tools/shots/e2e-sale-3.png, tools/shots/e2e-sale-3-bottom.png, tools/shots/e2e-sale-3-tall.png, tools/shots/e2e-sale-3-panel.png

## Result: PASS

PASS = every listing reaches `result:ok` with a meter total, the new panel's footer reads "Microburbs estimates, not advice" and can be scrolled into view, and the profile starts collapsed. (Address mismatches only fail the run in live mode.)

- Plumbing (one panel, a state, a query, a screenshot): 6/6 listings; states: result:ok, result:ok, result:ok, result:ok, result:ok, result:ok

## Visual review

> Carried over by the harness from the previous findings.md. The screenshots and tables above were regenerated at 07/11/2026, 12:17:52: re-check this review against them before relying on it.

Hand-written after the run above (started 07/11/2026 12:04:42 AEDT: mock proxy, headed Chromium, archived markup, no `--live-first`). I opened all 24 screenshots (`e2e-<kind>-<n>.png`, `-bottom`, `-tall`, `-panel` for the 6 listings) and checked each panel against its listing. The same content showed in the earlier runs today at 11:56, 11:59 and 12:02.

| # | listing address (page h1) | panel "Listing:" line | matched home | meter | halos / failos | profile (collapsed) | footer |
|---|---|---|---|---|---|---|---|
| rent-1 | Domain: 17 Young Street, Redfern NSW 2016 | 17 Young Street, Redfern NSW 2016 · from JSON-LD | 26 Tudor Street, Surry Hills (mock), amber "Weak match" | 60 Meh, needle in Meh | Close to work, Lower crime, Lively / Unaffordable, Busy road nearby | Sarah, 19 · casual retail · Renting · max $250/wk · income $600/wk · Work: 188 Pitt Street · Cheap, Close to work, Safe · Edit | present |
| rent-2 | realestate: 504/349-355 Bulwara Road, Ultimo, NSW 2007 | 504/349-355 Bulwara Road, Ultimo NSW 2007 · from JSON-LD | same mock home, Weak match (lists unit 504 and the number range) | 60 Meh | same as rent-1 | same as rent-1 | present |
| rent-3 | Domain: 59 Portman Street, Zetland NSW 2017 | 59 Portman Street, Zetland NSW 2017 · from JSON-LD | same mock home, Weak match | 60 Meh | same as rent-1 | same as rent-1 | present |
| sale-1 | realestate: 8/342 Bourke Street, Surry Hills, NSW 2010 | 8/342 Bourke Street, Surry Hills NSW 2010 · from JSON-LD | same mock home, Weak match (no suburb line: both Surry Hills) | 70 Halo, needle in Halo | Close to work, Lower crime, Lively / Busy road nearby | Sarah, buyer test profile · Buying · max $1.2m · income $2,500/wk · same work and tags · Edit | present |
| sale-2 | realestate: 801/8 Darling Island Road, Pyrmont, NSW 2009 | 801/8 Darling Island Road, Pyrmont NSW 2009 · from JSON-LD | same mock home, Weak match | 70 Halo | same as sale-1 | same as sale-1 | present |
| sale-3 | Domain: 110/11 Wigram Lane, Glebe NSW 2037 | 110/11 Wigram Lane, Glebe NSW 2037 · from JSON-LD | same mock home, Weak match | 70 Halo | same as sale-1 | same as sale-1 | present |

Verdicts: rentals "Close to work (1.8 km to work · tram 382 m), but unaffordable: $820/wk · 137% of income."; sales "Close to work (1.8 km to work · tram 382 m), but busy road nearby: Busy road 59 m (primary)." Each halo/failo row has a short label, the number, "via <endpoint>" and a date ("fetched 7 Nov 2026", "as of Aug 2026", "as of 2020-22 model"), and the rows for Sarah's priorities carry a "Your priority" tag. The MOCK DATA badge sits in the header, and the "Sample figures from fixtures, not this property." banner shows on every panel.

What I found, most important first:

1. **The address match can't be judged in mock mode.** The mock geocoder answers 26 Tudor Street, Surry Hills for every query, so all 6 panels show the wrong home. The panel is honest about it: an amber "Weak match: check this is the right home" line names each differing part, plus the MOCK badge and banner. The extraction half does pass. On all 6 listings the panel's "Listing:" line matches the address the page shows, including units (8/, 801/, 110/, 504/) and the 349-355 number range. The matcher on real listings needs a run with the key.
2. **At 1440x900 only the top of the panel is visible.** The panel body shows 744 px of 1131-1200 px of content. The first view shows the address block, the meter, the verdict and the first two halos. Failos, the profile and the "Microburbs estimates, not advice" footer all need a scroll inside the panel (the `-bottom` shots; the footer does scroll fully into view). The weak-match line alone takes about 110 px (6 lines). A smaller laptop viewport shows even less. Owner: extension/src/panel.js and extension/panel/panel.css (e.g. shorten or fold the check line, tighten the meter), or halos.js (lead with failos).
3. **Middle-band dimensions get no row.** A dimension that scores between Failo and Halo is neither a halo nor a failo, so nothing shows for it, yet it still moves the total. Rentals: negotiability (53). Sales: affordability (44) and negotiability (53). So on all 3 sale listings the valuation (mock AVM $1,125,000, range $985,000-$1,270,000, confidence 68) appears nowhere in the panel, even though Cheap is a picked priority at 2x weight. Owner: extension/panel/halos.js and score.js (e.g. a third "Meh" group, or one "Also scored" line). The harness now lists these as "scored but not shown" under Blank dimensions.
4. **The "Lower crime" halo contradicts itself.** It reads "Crime 1.2x national · 0.8x suburb": the label says lower, but the first number says above the national rate. Lead with the suburb ratio or relabel it (e.g. "Safer than the suburb"). This ties in with the calibration risk the integrator raised (City of Sydney crime is about 5x the national median). Owner: score.js labels.
5. **The verdict repeats itself (cosmetic):** "Close to work (1.8 km to work · ...)" and "busy road nearby: Busy road 59 m (primary)". Owner: meter.js verdict.
6. **The rent shown is Microburbs' latest advert, not the asking rent.** The Unaffordable row says $820/wk (via /rent-history-latest, as of Aug 2026) next to listings whose own asking rents (deliberately not recorded here) were much higher. Here that is the mock fixture. Live, it is the matched home's latest advert, by design, because the extension must not read listing text. A stale advert can still disagree with the price on the page. The "as of" date is shown, which is the right mitigation.
7. **Layout: nothing inside the panel is clipped or overlapping.** No element is drawn outside the panel box, no text is truncated (both checked in the DOM), and every row wraps cleanly. Outside the panel, the fixed 360 px overlay covers the page's right column: Domain's agent card and its View/Contact/Apply buttons, realestate's agent card and "Get in touch" button, and on rent-3 the end of Domain's breadcrumb ("...Zetland NSW 201"). That is expected for an overlay, and the collapse button gives the page back.
8. **Harness, not product.** In the 12:02 run, 4 of the 6 first-view shots had the page and/or the panel scrolled, by different amounts on each listing (e.g. sale-2: panel at its bottom, page down 35 px). The 11:56 run's shots had no scroll, the 12:04 run measured none, and scroll can't carry across navigations. That points to stray wheel input on the headed window, not the extension. The harness now records any offset and then resets page and panel to the top before shooting ("scroll before the first shot": none in this run).

Blank dimensions: none on any listing. That is expected, because the mock fixture has all 11 fact keys and `missing` is {}, so it says nothing about live data. When a real fact comes back as data:null, its dimension goes blank, and the harness now records the panel's blank note (`.mbx-halos__blank`) as the reason.

Not checked visually in this run: the "Not this one?" picker and type-it box when open (the link shows under the check line on every panel; the integrator's tools/shots/integrated-rent-1-picker.png shows it open), the collapsed pill, profile editing, and anything live.

Proof screenshot: `tools/shots/proof-rental.png` is a copy of `tools/shots/e2e-rent-1-tall.png`: Domain, 17 Young Street, Redfern, with the whole panel beside the listing (mock data).

## Fixes applied

Fixer pass, 7 Nov 2026 12:10-12:21 AEDT. The tables above come from the re-run at 12:17:52 (mock proxy, headed Chromium, all 6 listings): **PASS 6/6**. The re-run happened after every code change below. Unit tests: `node --test tests/score.test.js` 33/33, `npm test` in proxy/ 24/24. Visual review items 3 and 5 above are fixed. Item 4 is unchanged (see Skipped).

Fixed:

1. **A slow workplace no longer wipes out every fact (high).** `proxy/profile-facts.js` now locates the workplace from `transport/nearby` first, which is a small answer, and falls back to `surroundings/properties` only when that fails. Once the property's own calls are back, `getFacts` waits at most 6 s more for the workplace (a real timer, `workWaitMs`). After that only `work` is marked `upstream_error:timeout`. Test: `proxy/test/fixer.test.js`.
2. **The listing site can't read the profile figures (high).** The panel's shadow root is now **closed** (`extension/src/panel.js`), so `host.shadowRoot` is `null` in the page's own scripts. It stays open only when `chrome.storage.local["mbx.dev"] === true` (read in `content.js` before the first panel is built) or when the dev preview asks for it. The harness sets `mbx.dev` together with the profile (`tests/e2e/run.mjs`). I checked the real-user path in a separate run without the flag: the panel rendered and `document.getElementById('mbx-root').shadowRoot` was `null` (`tools/shots/fixer-closed-shadow.png`).
3. **The work geocode must agree with what was typed (medium).** The proxy only accepts an in-coverage candidate whose street matches and whose suburb doesn't contradict the typed address, using the listing matcher's own `checkMatch`. Otherwise `missing.work` is `outside_coverage` or `no_match:work_street_or_suburb_differs`, and Commute falls back to transit and says so. "10 George Street, Parramatta" no longer becomes 10 George Street, Redfern. The commute number now names the workplace that was matched: "1.8 km to 188 Pitt St · tram 382 m". This also removes the repeated "to work" in the verdict.
4. **Duplicate upstream calls (medium, partial).** `createApp` wraps the client once in `shareClient`. An identical GET (same path and query) that is still in flight, or got a 200 within the last 60 s, goes upstream only once. That saves `valuation/avm` and `rent-history-latest` on every cold lookup. I did not remove `basics/all`, `comparables` or `da-list` from the lookup (see Skipped).
5. **The whole response fits under the extension's 28 s abort (low).** The facts timeout is now `min(15 s, 24 s - lookup time)`, with a 1 s floor (`proxy/src/app.js`).
6. **Amenities with no counts are absent, not zeros (low).** `buildAmenities` marks `amenities` as missing (`no_data:no_counts`) when the answer has no counts object, or none of restaurant, supermarket or green_spaces is a number. `score.js` is unchanged, because the TABLE scores a present counts object with gaps as 0.
7. **No needle when nothing is scored (low).** `meter.js` hides the needle and removes `aria-valuenow` when the total is null.
8. **The panel says why a dimension is blank (low).** It now passes `{key, reason}`, so the note reads e.g. "Not scored: Affordability (set a budget or income)" instead of "(no data)".
9. **Verdict wording (low and cosmetic).** The one-sided cases now read "No failos. Strongest: ..." and "No halos. Main concern: ...". Words the label already says are dropped from the number: "busy road nearby: 59 m (primary)".
10. **"Not this one?" checks the home it lands on (low).** `content.js` keeps the picked candidate's `gnaf_id`. If the home the proxy lands on is a different one, the check line starts with "You picked X; closest match is Y" and an exact verdict drops to partial.
11. **Middle-band dimensions now get a row (e2e product finding).** `halos.js` shows an optional third group, **Meh**, under the failos. It uses the same row format (dimension name, number, via, date) and only appears when a dimension is in the Meh band. The valuation now shows on sale listings: "Affordability · Est. $1.13m · 8.7x income · via /valuation/avm · as of Oct 2026". Every scored dimension in the total is now visible ("scored but not shown: none" on all 6). `docs/SCORING.md` §5.2, §7, §10 and §11 (v1.1) are updated. No threshold, anchor or weight changed.

Skipped:

- **Address mismatches (6/6).** They come from the mock geocoder, which answers 26 Tudor St for every query. They can't be fixed or judged without `proxy/.env`. Extraction matches the page address on 6/6.
- **"Lower crime" reads "Crime 1.2x national · 0.8x suburb" (Visual review item 4).** That label and number format are exactly what the TABLE specifies, and the TABLE wins. The real issue is crime calibration for the City of Sydney, which has to be checked live.
- **Affordability uses the Microburbs rent advert, not the listing's asking rent.** This is deliberate: the privacy rule says to read only the address from the page.
- **Removing `basics/all`, `comparables` and `da-list` from the lookup.** The user asked to keep the proxy as built, and the review made this conditional on their agreement.
- **Returning partial facts when the app-level timeout fires.** The review marked this optional. Fixes 1 and 5 already keep the workplace and a slow lookup from emptying the facts.
- **Panel height at 1440x900 (Visual review item 2).** Not changed. In mock mode the weak-match box is 5-6 lines; a live exact match is one line. The new Meh group adds about 70-130 px. The footer still scrolls into view, and the harness checks that.
