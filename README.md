# Fit — does this home fit *you*?

**Microburbs Hackathon · Task 3 (Chrome extension) · Saturday 7 November 2026 · City of Sydney**

A Chrome side panel that sits beside any realestate.com.au or domain.com.au listing and answers one question at a glance: **how well does this home fit me?** A speedo gives a 0–100 fit score. Under it, the halos and failos — the three facts pulling the needle up and the three pulling it down, each with its number and where it came from. Under that, four sliders: **Commute, Safety, Lifestyle, Price.**

Everyone gets a different needle for the same listing because the weights are theirs. A six-question onboarding quiz turns answers into weights: a workaholic's needle swings on the walk to the station, a partier's on bars within ten minutes, a 19-year-old on a casual wage sees affordability first. Same Microburbs facts, personalised. That's the clever step.

**Who it's for:** anyone browsing inner-Sydney listings who isn't the median buyer the portals assume. Our persona is **Sarah** — 19, casual retail at ~$600/week, parents moving her out, looking for somewhere she can actually afford that gets her to work.

---

## For any AI agent building this: read everything below before writing code

### Hard rules (breaking one loses points or gets us excluded)
1. **Read ONLY the listing's address from the page.** JSON-LD, then `h1`, then the user types it. No screenshots, no transcription, no listing text, no photos, no asking price. Nothing else leaves the page.
2. **The API key never reaches the browser.** It lives in `proxy/.env` (gitignored). The extension talks only to the local proxy.
3. **Nothing supplied goes in the repo.** No `.env`, no `data/*.csv`, no raw API output, no hidden judging data. `.gitignore` already covers these; check `git status` before every commit.
4. **Coverage is the City of Sydney's 29 suburbs.** Anything else returns `403` → show a calm "outside the City of Sydney trial area" state.
5. **No data is still HTTP 200** with `{"data": null, "available": false, ...}`. Treat as "no figure", never as zero. A score is built from the signals that *are* available.
6. **Estimates, not advice.** Footer on the panel: "Microburbs estimates, indicative only — not a valuation or financial advice", with an as-of date.
7. **Every number on screen shows its source.** Judges check facts against the correct home. The speedo is a summary; the halos/failos are the evidence.

### API
- Base `https://api-ht.microburbs.com.au`, header `Authorization: Bearer $MICROBURBS_API_KEY`
- OpenAPI spec and try-it: https://api-ht.microburbs.com.au/docs — **use any endpoint in the spec that serves a signal.** The endpoints named below are starting points, not a limit.
- ~10 req/s per key. Back off on `429`. Cache by `gnaf_id` and by suburb in the proxy.
- `GET /v1/geocode/address` returns up to 10 candidates nationwide → keep only the 29 suburbs before trusting the top hit.
- Demo code (MIT): https://github.com/David-Mib/microburbs-hackathon-demos

### Architecture
```
extension/                 Manifest V3. Fixed 360px right column injected on listing pages (or Side Panel API if already built that way — don't rebuild).
  content.js               hostname dispatch → extract/*.js → address → background → proxy → panel
  extract/domain.js        domain.com.au address only
  extract/realestate.js    realestate.com.au address only
  background.js            messaging, calls proxy, caches per tab
  panel/                   speedo, halos/failos, four sliders, matched-address header, profile reader
  onboarding/              six-question quiz → writes profile to chrome.storage.local (owned by the questionnaire builder)
proxy/                     Node + Express on localhost:3000, holds the key, matcher, facts fan-out, cache
tests/                     unit tests for scoring, e2e on real listings, findings.md
docs/SCORING.md            the scoring model in words — becomes a section of report.html
```

### Contract 1 — the profile (written by onboarding, read by the panel)
`chrome.storage.local` key `profile`. If missing, the panel uses this exact default (Sarah):
```json
{
  "name": "Sarah",
  "mode": "rent",
  "budgetWeekly": 250,
  "incomeWeekly": 600,
  "workAddress": "Broadway, Ultimo NSW",
  "weights": { "commute": 0.35, "safety": 0.25, "lifestyle": 0.15, "price": 0.25 }
}
```
`mode` is `"rent"` or `"buy"`. For `buy`, `budgetWeekly` is replaced by `budgetPrice`. Weights sum to 1.

### Contract 2 — the proxy response (written by the proxy, read by the panel)
`GET http://localhost:3000/lookup?address=<text>&work=<text>` returns:
```json
{
  "matched": {
    "gnaf_id": "GANSW710352293",
    "display_name": "Unit 105, 8 Sam Sing Street, Waterloo (NSW)",
    "suburb": "Waterloo (NSW)",
    "confidence": "exact | building | guess",
    "candidates": [{ "gnaf_id": "...", "display_name": "..." }]
  },
  "facts": {
    "commute":   { "<signal>": { "value": 0.4, "unit": "km", "label": "Nearest light rail", "source": "/v1/properties/{id}/amenities/nearest-transport", "asOf": "2026-11-07", "available": true } },
    "safety":    { },
    "lifestyle": { },
    "price":     { }
  },
  "outsideCoverage": false
}
```
Every signal has the same shape. Unavailable signals are present with `available: false` and no `value`. The panel must render correctly with any subset missing.

### Scoring model (the panel's `score.js`; documented in `docs/SCORING.md`)
Each **signal** maps to 0–100 by thresholds. Each **dimension** is the mean of its available signals. **Fit = Σ weight × dimension**, rounded. Halos = the three available signals scoring ≥ 70 with the highest weighted contribution; failos = the three scoring ≤ 30. Sliders show each dimension's 0–100.

| Dimension | Signal | 100 | 50 | 0 | Starting-point endpoints (use anything better in the spec) |
|---|---|---|---|---|---|
| Commute | Walk to nearest train / light rail / bus | < 400 m | 400–900 m | > 1.2 km | nearest transport by mode |
| Commute | Distance to work address (haversine, geocode the work address) | < 2 km | 2–6 km | > 10 km | geocode + coordinates |
| Commute | Distance to CBD (Town Hall −33.8731, 151.2069) | < 2 km | 2–5 km | > 8 km | coordinates |
| Commute | Parking on title | ≥ 1 space (if profile wants a car) | — | 0 | basics/all `parking_count` |
| Commute | Peak-hour road noise / busy road frontage | none | nearby | fronting | busy-road segments, noise-map regions |
| Safety | Block crime vs suburb benchmark | ≥ 20 % below | within ±20 % | ≥ 20 % above | crime rate per census block, suburb vs benchmark |
| Safety | Livability score vs regional benchmark | above | at | below | livability scores + benchmark |
| Safety | Hazards **on this property** (flood, landslide, HV line, contamination) | none | nearby only | on property | property risk overlays (`on_property` true only) |
| Safety | Estimated social-housing share, building level, neutral wording, labelled an estimate | low | mid | high | supplied flags file joined on address id |
| Lifestyle | Supermarket + gym + café within 10 min walk | all three | two | ≤ one | nearby amenities, places in the suburb |
| Lifestyle | Nightlife within 10 min (weighted up only if the quiz says so) | ≥ 3 venues | 1–2 | 0 | places (pubs, bars) |
| Lifestyle | Park / beach / tree cover | park < 500 m | < 1 km | none | nearest beach, tree canopy, lifestyle summary |
| Price | Affordability — rent (`mode: rent`): latest rent advert or rent estimate ÷ `incomeWeekly` | ≤ 30 % | 30–40 % | > 40 % | rent-history-latest, rental valuation, median weekly rent by bedrooms |
| Price | Affordability — buy (`mode: buy`): AVM vs `budgetPrice` | ≤ budget | within +10 % | > +10 % | valuation/avm |
| Price | Value: AVM vs 3 closest comparable sales | at or below comps | within +5 % | > +5 % above | valuation/avm, comparables |
| Price | Running costs: council rates, strata levies | below suburb avg | at | above | average council rates, strata levies |
| Price | Development pressure: recent DAs / construction on the block | low (quiet, stable) | some | heavy (noise now, supply later) | construction activity per block, DA count/list |
| Price | Negotiating room: rental vacancy per block / days on market | high | mid | tight | rental vacancy per census block, median days on market |

The quiz sets `weights`; it may also set flags like `hasCar` and `nightlife` that switch signals on. If a flag is absent, parking and nightlife are weighted at half.

### Ownership — nobody edits another owner's directory
| Owner | Directory | Deliverable by 13:45 |
|---|---|---|
| Carl | `extension/` (except `onboarding/`) | Panel renders on a real listing from the proxy contract: speedo, halos/failos with sources, four sliders, matched-address header with "Not this one?" picker and type-it box, reads profile with Sarah default |
| Teammate 2 | `proxy/`, `tests/` | `/lookup` returns Contract 2 with as many signals as the spec supports, matcher handles "105/8", "Unit 105, 8", "Level 3", "8–10"; e2e on 3 rental + 3 sale listings; `tests/findings.md` |
| Teammate 3 | `extension/onboarding/`, `docs/SCORING.md` quiz section | Six MCQs → profile JSON (Contract 1); "I'm Sarah" one-tap preset |

Until the proxy is live, the panel runs on `proxy/fixtures/lookup.sample.json`, which must match Contract 2 exactly.

### Git protocol
- `git pull --rebase` then `git push` **every 20 minutes**, on the hour, :20 and :40. The repo is the submission; a laptop dying at 14:50 must not cost the entry.
- One commit per working piece, message `<dir>: what it does`. No "wip".
- `git status` before every commit: no `.env`, no `data/`, no API output.
- Conflicts can only happen in shared files — there are none. If one appears, the owner of the directory wins.

### Timeboxes
- **13:00** handshake: quiz writes profile → panel reads it → needle moves. Proxy returns a real listing's facts.
- **13:45** feature freeze. Only fixes after this.
- **13:45–14:15** videos: `pitch.mp4` ≤ 45 s opening on Sarah, `demo.mp4` ≤ 3 min on real listings, both < 95 MB.
- **14:15–14:45** `report.html` (model from `docs/SCORING.md`, what worked, what didn't, held-out address-match rate on listings we didn't tune on), README "what we built" rewritten from this file.
- **14:45** final push. **15:00** close.

### How to run
```bash
cd proxy && cp .env.example .env   # paste the team key
npm install && npm start           # http://localhost:3000
# Chrome → chrome://extensions → Developer mode → Load unpacked → ./extension
# Open any City of Sydney listing on domain.com.au or realestate.com.au
```

### Data credits
Microburbs API (© Microburbs, estimates indicative only) · Open G-NAF © Geoscape Australia, licensed by the Commonwealth · ABS Census © Commonwealth of Australia, CC BY 4.0 · City of Sydney open data where used.
