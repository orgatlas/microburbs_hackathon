# Microburbs Hackathon — Saturday 7 November 2026

## Mission
One-day build. Key arrives 11:00, submissions close **15:00 sharp**. The hand-in is this PUBLIC GitHub repo.
Organisers' own words: "A clever, non-obvious step beats polish. A toy or demo is fine. We do not expect a finished application."
Working > pretty. Ship the core loop first, then nothing else until it works end to end on a real address.

## Fill in at 10:15
- TASK: [ AR app (Task 2) | Chrome extension (Task 3) ]
- TEAM NAME: ______ (lowercase, hyphens only, e.g. `data-wranglers` — used for any filenames)
- MEMBERS / ROLES: ______

## API
- Base URL: `https://api-ht.microburbs.com.au`
- Auth header: `Authorization: Bearer $MICROBURBS_API_KEY`
- Interactive docs (try-it with the key): https://api-ht.microburbs.com.au/docs
- Demo apps, MIT, copy freely: https://github.com/David-Mib/microburbs-hackathon-demos
- Live showcase with every call shown: https://microburbs-api-demos.vercel.app/

### Rules that will bite
- The key lives ONLY in an env var / gitignored `.env` / gitignored `Secrets.xcconfig`. NEVER in source. NEVER committed. If the app runs in a browser, the key stays on a server.
- Coverage is the City of Sydney's 29 suburbs only. Anything outside returns **403**.
- "No data" is still HTTP **200**: body is `{"data": null, "available": false, "reason": ..., "message": ...}`. Always check `data` before using it.
- Rate limit ~10 requests/sec per key. On **429**: back off and retry.
- Estimates are automated and indicative. Say so in the UI.

### Endpoints we'll lean on (exact paths from the task briefs — check the docs for query params)
- `GET /v1/suburbs/list` — the 29 suburbs
- `GET /v1/geocode/address` — address text → up to 10 candidates, best first, each with `id` (gnaf_id, e.g. `GANSW710352293`), `display_name`, `property_type`. Candidates come from the WHOLE COUNTRY — filter to City of Sydney suburbs before trusting the top hit.
- `GET /v1/properties/{gnaf_id}/basics/all` — `bed_count`, `bath_count`, `parking_count`, `dwelling_type`, `land_area_sqm`
- `GET /v1/properties/{gnaf_id}/valuation/avm` — `predicted_price`, `predicted_price_low`, `predicted_price_high`, `prediction_date`, `confidence_score`
- `GET /v1/properties/{gnaf_id}/comparables/recent-sales-nearby` — each has `address`, `price`, `date_sold`, `dist_km`, `bedrooms`. Keep the 3 closest.
- `GET /v1/properties/{gnaf_id}/rent-history-latest` — latest rent advert with date
- `GET /v1/properties/{gnaf_id}/profile` — the one-page property profile
- `GET /v1/suburbs/{suburb_name}/development/da-list` — recent DAs: `date`, `category`, `description`
- `GET /v1/suburbs/{suburb_name}/market/all` — suburb market bundle
- Suburb names use the API's form, e.g. `Surry Hills`, `Waterloo (NSW)` — copy from `/v1/suburbs/list`.

### Supplied files (arrive with the key at 11:00 — use on the day only, DO NOT commit, DO NOT republish)
- `addresses-city-of-sydney.csv` — public address list with coordinates and suburb. This is the matching table.
- `public-housing-homes-city-of-sydney.csv` — estimated flags.
Keep them in `data/` and add `data/` to `.gitignore` before the first commit.

## Hand-in contract (repo root, complete by 15:00)
- `README.md` — what we built, who it helps, the data, the clever step, how to run it. Credit every data source (Microburbs, Open G-NAF © Geoscape, ABS, anything else).
- `report.html` — data, method, what worked, what didn't, our own held-out check. For AR / Chrome: compare existing apps or extensions that do something similar, show what they display, explain why our chosen facts add value, and explain how we matched the address and checked the facts.
- `pitch.mp4` — ≤ 45 seconds. What we made and why it matters. An AI first pass picks up to 25 pitches to play to the room at 15:10 — this video is the whole ballgame.
- `demo.mp4` — ≤ 3 minutes. Show the data and the thing working. AR: outdoors, on a phone, at a real City of Sydney building. Chrome: beside real listings.
- Every video under **95 MB**. No key, no supplied CSVs, no API output in the repo.
- Format to copy: https://www.microburbs.com.au/p/hackathon-example-rent-report

## If TASK = AR app (Task 2)
- Stack: SwiftUI + ARKit (camera feed) + CoreLocation (GPS + `CLHeading` compass). **No computer vision.**
- The clever step: load `addresses-city-of-sydney.csv`, filter to ~300 m of the user, score each address by angular distance from compass heading (±15° cone) and by metres away → show the **top 3 candidates** with distance, user taps to confirm. GPS drifts 10–30 m in the CBD and the compass is noisy near buildings, so never present a single confident answer.
- After confirm: `basics/all` + `valuation/avm` + `comparables/recent-sales-nearby` + suburb `development/da-list`. Overlay shows: value + range, bed/bath/parking, 3 nearest sales, 1–2 DAs nearby. That's the whole app.
- Judges will try it OUTDOORS on a real building using OUR phone. It must run on device. Build to the iPhone over USB; Developer Mode on.
- Key path: `Secrets.xcconfig` (gitignored) → `Info.plist` → read at runtime. Commit `Secrets.example.xcconfig` with a placeholder.
- Test outside the venue (Ultimo Rd / Harris St, both inside the City of Sydney) by 12:30.

## If TASK = Chrome extension (Task 3)
- Manifest V3. Content script reads ONLY the listing's address from realestate.com.au / domain.com.au (page title, `h1`, or JSON-LD). Do NOT read, copy or store any other listing text or photos.
- The key must never reach the page: content script → tiny proxy (Vercel function / Cloudflare Worker) that holds the key → Microburbs API. Deploy the proxy by 11:30.
- Address → `geocode/address` → filter to City of Sydney → show the matched `display_name` at the top of the panel so a buyer can see it matched the right home.
- Panel facts, buyer-facing: value + range + confidence, bed/bath/parking, 3 nearest sales, latest rent, 1 nearby DA. Nothing else.
- Judges open several REAL listings and check each matched address. Test on ≥ 5 listings across different suburbs before 14:00. Use playwright-cli to open listings and snapshot the DOM when hunting for the address selector.

## Working rules
1. Core loop first: match → facts on screen for one real address. No second feature until that works.
2. Commit and push every 30 minutes. The repo IS the submission; a laptop dying at 14:50 must not cost us the entry.
3. Mock nothing. If `data` is null, show "no data" honestly.
4. Timeboxes: core loop by 12:30, outdoor/real-listing test by 13:00, feature freeze 13:45, videos 13:45–14:15, final push 14:45.
5. If something isn't working by 13:00, cut it and write it up under "what didn't work" in report.html — that's worth points, a half-built feature isn't.
