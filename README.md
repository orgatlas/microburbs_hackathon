# MicroMatch

**Team Microscope · Microburbs Hackathon, Task 3 (Chrome extension) · Saturday 7 November 2026 · City of Sydney**

## What we built

MicroMatch is a Chrome side panel that sits beside a realestate.com.au or domain.com.au listing and answers one question: how well does this home fit you?

1. **It reads only the address.** The content script takes the listing's address from the page (JSON-LD first, then the `h1`). It reads no other listing text, no photos and no asking price. If it can't find an address, you can type one into the panel.
2. **It matches the address to one home.** Our proxy sends the text to Microburbs `geocode/address`, keeps only candidates in the City of Sydney's 29 suburbs, and returns the G-NAF home with a confidence of `exact`, `building` or `guess`. The panel shows the matched address at the top, with a "Not this one?" picker and a box to type the address, so you can check it is the right home.
3. **It pulls live Microburbs facts through our proxy.** The proxy holds the API key and fans out to the Microburbs endpoints for commute, safety, lifestyle and price.
4. **It scores the home against your own quiz weights.** You sign up on our website and take a short quiz, and your answers become your weights. The panel shows:
   - a speedo with a 0–100 fit score
   - up to three pros and three cons, each with its number, its source endpoint and an as-of date
   - four sliders (Commute, Safety, Lifestyle, Price), each with that dimension's 0–100 score

Two people looking at the same listing get different scores because the weights are theirs. There is no default persona. Until you take the quiz, the panel shows the matched address and asks you to take it, with a button that opens http://localhost:3001. It shows no speedo and no numbers.

Every figure is a Microburbs automated estimate. It is indicative only and is not a valuation or financial advice. The panel says so.

## How to run

You need Node.js, Python 3 and Chrome (or Chromium).

1. **Add the key.** Copy `proxy/.env.example` to `proxy/.env` and set `MICROBURBS_API_KEY` to the team key. `proxy/.env` is gitignored, so never commit it. The key stays in the proxy and never reaches the browser.
2. **Start everything** from the repo root:
   ```bash
   ./run.sh
   ```
   This starts the proxy on http://localhost:3000, Django (accounts and saved quiz results) on http://localhost:8001 and the website on http://localhost:3001. On the first run it creates the Django virtualenv, runs migrations and installs the npm packages. If one of the ports is already in use, it skips that server. Press Ctrl+C to stop them all.
3. **Load the extension.** In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose the `./extension` folder.
4. **Sign up and take the quiz** at http://localhost:3001. The dashboard passes your saved profile to the extension (`extension/src/site-bridge.js` saves it to `chrome.storage.local.profile`).
5. **Open a City of Sydney listing** on realestate.com.au or domain.com.au and click the MicroMatch toolbar icon to open the side panel. You can also type an address into the panel.

If the proxy is down, the panel says "Backend offline — retry" and shows no numbers.

## Who it helps

It helps people browsing inner-Sydney listings whose priorities differ from the typical buyer the portals have in mind. One example is a 19-year-old on a casual wage, for whom rent against income matters most. Another is a commuter who cares mostly about the walk to the station, or someone who wants bars within ten minutes' walk. The portals show everyone the same facts. MicroMatch weights those facts by what this person told us matters to them.

## The data

All facts come live from the Microburbs API (`https://api-ht.microburbs.com.au`) through our proxy. Property endpoints sit under `/v1/properties/{gnaf_id}` and suburb endpoints under `/v1/suburbs/{suburb_name}`.

| Dimension | Endpoints |
|---|---|
| Matching | `/v1/geocode/address`, `/v1/suburbs/list` (filter to the 29 suburbs), plus the supplied City of Sydney address list as a matching table when the file is present locally |
| Commute | `transport/nearby`, `basics/parking-count`, `shapes/busy-roads`, property coordinates (distance to Town Hall and to your work address) |
| Safety | `crime/by-mesh-block`, `crime/summary`, `lifestyle/livability`, `risks/all`, plus the supplied estimated public-housing flags when the file is present locally |
| Lifestyle | `amenities/nearby`, `lifestyle/pois` |
| Price | `rent-history-latest`, `market/rent-map`, `market/median-rent`, `valuation/avm`, `comparables/recent-sales-nearby`, `comparables/cma-comp-set`, `market/strata-levies`, `development/council-rates`, `development/construction-activity`, `market/vacancy-map`, `market/days-on-market` |

- **Rent** comes from the home's latest rent advert where there is one. Otherwise it comes from the mesh-block or suburb rent estimate. The panel names the source it used.
- **No data is still a 200.** If a response has `data: null`, that signal counts as "no figure" and is left out of the score. It is never scored as zero.
- **The supplied hackathon files** (the address list and the estimated public-housing flags) are read by the proxy from `data/` only if they are present on the machine. We used them only on the day, and they are not in this repo (`data/` is gitignored).

## The clever step

There are two parts.

1. **Address matching you can check.** Portals write addresses many ways ("105/8 Sam Sing St", "Unit 105, 8 Sam Sing Street", "Level 3", "8–10 …"). Geocode candidates come from the whole country. The proxy normalises the text, drops candidates outside the 29 suburbs and labels the match:
   - `exact`: this unit
   - `building`: right building, unit not confirmed
   - `guess`: best remaining candidate

   The panel always shows the matched address and lets you pick another candidate or type the address, so it never presents a guess as certain.
2. **Per-user weights from the quiz, with no default persona.** The quiz saves weights for safety, lifestyle and price (0–100). The panel keeps commute at 0.25 and splits the remaining 0.75 between the other three in proportion to those weights. The same Microburbs facts produce a different score for each account, and no score appears until you have taken the quiz.

## Scoring model

This is the model in `extension/sidepanel/score.js`, described in words in `docs/SCORING.md`.

- Each **signal** maps to 0–100 using the thresholds below.
- A missing signal is skipped, never scored 0.
- Each **dimension** is the weighted mean of its scored signals.
- **Fit = Σ weight × dimension**, rounded.
- **Pros** are up to three signals scoring ≥ 70 with the largest weighted contribution. **Cons** are up to three scoring ≤ 30.
- Signals gated on a quiz flag (`hasCar`, `nightlife`) count fully when the flag is true, at half weight when it is absent, and not at all when it is false.

| Dimension | Signal | 100 | 50 | 0 |
|---|---|---|---|---|
| Commute | Walk to nearest train / light rail / bus | < 400 m | 400–900 m | > 1.2 km |
| Commute | Distance to work address (haversine) | < 2 km | 2–6 km | > 10 km |
| Commute | Distance to CBD (Town Hall −33.8731, 151.2069) | < 2 km | 2–5 km | > 8 km |
| Commute | Parking on title (if you have a car) | ≥ 1 space | — | 0 |
| Commute | Busy-road frontage | none | nearby | fronting |
| Safety | Mesh-block crime vs suburb benchmark | ≥ 20 % below | within ±20 % | ≥ 20 % above |
| Safety | Suburb livability vs regional benchmark | above | at | below |
| Safety | Hazards on this property (flood, landslide, HV line, contamination) | none | nearby only | on property |
| Safety | Estimated social-housing share in the building (an estimate, only when the supplied flags file is present locally) | low | mid | high |
| Lifestyle | Supermarket, gym and café within 10 min walk | all three | two | one or none |
| Lifestyle | Nightlife within 10 min | ≥ 3 venues | 1–2 | 0 |
| Lifestyle | Nearest park, beach or green space (straight line) | < 500 m | 500 m – 1 km | > 1 km |
| Price | Rent affordability (rent ÷ weekly income) | ≤ 30 % | 30–40 % | > 40 % |
| Price | Buy affordability (AVM vs budget) | ≤ budget | within +10 % | > +10 % |
| Price | Value: AVM vs closest comparable sales | at or below | within +5 % | > +5 % |
| Price | Running costs: council rates, strata levies | below suburb average | at | above |
| Price | Development pressure: construction on the block | low | some | heavy |
| Price | Negotiating room: rental vacancy, days on market | high | mid | tight |

Between the 50 and 0 thresholds, distance and ratio signals fall linearly from 50 to 0.

## Layout

```
extension/   Manifest V3 side panel ("MicroMatch")
  src/         content.js + extract.js (address only), background.js (calls the proxy), site-bridge.js (website → chrome.storage.local.profile)
  sidepanel/   speedo, pros/cons, sliders, matched-address header, score.js (scoring model)
proxy/       Node + Express on :3000. Holds the key, matches the address, fetches the facts, caches by gnaf_id and suburb
backend/     Django on :8001. Accounts and saved quiz results
frontend/    Next.js on :3001. Sign-up / log-in, quiz, dashboard
docs/        SCORING.md, API_CONTRACT.md
tests/       proxy tests, e2e checks on real listings, findings.md
run.sh       starts the proxy, Django and the website together
```

## Honest limits

- **Coverage:** the City of Sydney's 29 suburbs only. Any other address gets a 403 from the API, and the panel says the home is outside the trial area.
- **Estimates:** every value, rent and score is an automated estimate, indicative only.
- **Transport:** some transport results come back without stop names, so the panel can show the mode and distance but not always which stop it is.
- **Rent by bedrooms:** the rent estimates do not always split by bedroom count. Where a figure is not for this home's bedroom count, it is an approximation.
- **Address misses:** some listing addresses do not geocode to the right home. The confidence label, the candidate picker and the type-it box are there for those cases.
- **Local only:** the stack runs on localhost. The extension calls `localhost:3000` and `localhost:8001`.

## Data credits

- **Microburbs API**: property, suburb, market, crime, transport, amenity and development data. © Microburbs. Automated estimates, indicative only.
- **Open G-NAF**: address identifiers (`gnaf_id`). © Geoscape Australia, licensed by the Commonwealth of Australia under the Open G-NAF End User Licence Agreement.
- **Australian Bureau of Statistics**: Census and mesh-block geography behind block-level figures. © Commonwealth of Australia, CC BY 4.0.
- **City of Sydney**: the 29-suburb coverage area, and City of Sydney open data where used.
- **Microburbs hackathon demo apps** (MIT): https://github.com/David-Mib/microburbs-hackathon-demos
